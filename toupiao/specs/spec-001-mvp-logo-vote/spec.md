# Spec — spec-001 MVP Logo 投票

- 状态：**已验收（PASS，2026-11-04）**（关键决策已由用户 2026-11-04 确认）
- 档位：FULL
- 项目模式：NEW
- 关联：`constitution/mission.md`、`constitution/tech-stack.md`

## 背景

Esonitro（深圳君柔科技）需要在 20 个 Logo 候选稿中收集员工偏好。当前靠群里发图、
聊天回复统计，存在漏人、重复、无法核对的问题。需要一个内部投票站：钉钉登录、
一人最多 5 票、可取消、实时公开票数，管理员能查看明细并导出结果。

## 目标

1. 员工用钉钉登录后，对 20 个候选图标投票，每人最多 5 个不同图标，可随时取消/改投。
2. 前台实时展示每个图标的票数与排名；不展示投票人身份。
3. 管理员用独立口令登录后台，查看总览与投票人明细，开关投票，导出 CSV，重置投票。
4. 单容器 Docker 可部署，SQLite 持久化，图标以只读目录提供（不入库）。
5. 本地无钉钉凭据时可用 mock 登录完整走通流程，且 mock 在界面上有明确标识。

## 非目标

- 不做匿名/游客投票；不做多问题问卷、多轮投票、加权计票。
- 不做图标在线上传/删除/排序（由运维放目录、重启生效）。
- 不做 WebSocket 实时推送（5 秒轮询即可）。
- 不做钉钉工作台免登（`dd.requestAuthCode`）；本期用扫码 OAuth2。
- 不做多租户、国际化、评论、分享、通知。
- 本期不接线真实服务器/域名/HTTPS；只准备 Docker 单元、端口登记与操作文档。

## 当前行为

项目不存在。根目录 `image/` 下有 20 张 277×191 的 PNG Logo 候选稿，
已迁移到 `toupiao/assets/icons/`，按要求不纳入 git。

## 目标行为

### 员工视角

1. 打开站点，看到标题、投票规则、20 个候选图标（编号+名称）、实时票数与排名。
2. 未登录可以浏览；点击投票时出现登录入口：钉钉模式跳转钉钉授权，mock 模式输入姓名。
3. 登录后回到原页面，右上角显示自己的钉钉昵称与头像（mock 显示姓名）。
4. 点击卡片投票，卡片变为已选；顶部/侧栏显示“已投 x/5”。
5. 第 6 票被拒绝并提示“最多投 5 个，请先取消一个”，数据不变。
6. 点击已选卡片取消，票数立即减少，可以改投其它图标。
7. 管理员关闭投票后，页面显示“投票已结束”，所有投票/取消按钮禁用，票数继续可看。

### 管理员视角

1. `/admin` 输入管理口令登录；错误口令提示，连续失败被限流。
2. 总览：总票数、参与人数、图标数、投票开关状态、最近投票、每个图标票数与排名/占比。
3. 投票明细：每个投票人的姓名、已投图标、投票时间；可按票数或时间排序（前端）。
4. 开关投票：切换后立即生效，前台下一次轮询即反映。
5. 导出 CSV：文件名带日期，UTF-8 BOM，Excel 打开中文不乱码；内容与实际数据一致。
6. 重置：必须输入 `RESET`；只清空投票，保留用户；重置后总票数为 0，不可恢复。
7. 退出登录清除管理员会话。

### 运维视角

1. `npm run build` 产出 `client/dist`；`npm start` 由 Node 同时托管页面与 API。
2. `docker compose up -d --build` 后容器 healthy，数据与图标通过卷挂载。
3. 重启容器后用户、投票、开关状态不丢。
4. 图标目录缺失/为空时服务不崩溃，页面给明确空状态，后台给警告。
5. `.env` 缺失关键配置时启动失败并给出明确错误（不静默使用默认口令）。

## 功能需求

### F1 登录与身份

- `AUTH_MODE=dingtalk`：
  - `GET /api/auth/login?next=/` → 302 到 `https://login.dingtalk.com/oauth2/auth`，
    参数含 `redirect_uri`、`response_type=code`、`client_id`(AppKey)、`scope=openid`、
    `state`、`prompt=consent`；配置了 corpId 时带 `corpId`。
  - `GET /api/auth/callback?code=&state=` 校验 state cookie；用 code 换 token；
    调钉钉用户信息接口；以 `unionId` upsert 用户；写会话 cookie；302 回 `next`。
  - state 不匹配/过期、code 缺失、钉钉报错：不建立会话，302 回首页并带可读错误码。
  - 回调成功后写入 HttpOnly 会话 cookie；`next` 只接受站内路径（单个 `/` 开头，
    拒绝 `//host`、`http(s)://`、反斜杠与控制字符），否则回退 `/`，防止开放重定向。
  - AppKey/AppSecret 缺失时启动失败（配置错误不能等用户点登录才暴露）。
- `AUTH_MODE=mock`：
  - 前台显示“开发模式”标识；`POST /api/auth/mock` 接受 `{name}`（1–20 字符，
    去首尾空格），以稳定假 unionId 建/取用户并写会话。
  - `AUTH_MODE=dingtalk` 时该接口返回 404/403，不可用。
- `POST /api/auth/logout` 清除会话。
- 会话有效期 7 天；cookie 为 HttpOnly、SameSite=Lax、HTTPS 时 Secure。

### F2 前台投票页

- 展示 20 个图标：图片、编号、名称、票数、排名（并列同名次）。
- 展示总票数、参与人数（去重投票人数）、剩余票数。
- 已登录展示“我的投票”列表（最多 5 个缩略图，可点击取消）。
- 实时刷新：每 5 秒请求 `/api/state`，页面隐藏时暂停；投票后用响应即时更新。
- 未登录可看结果；投票操作触发登录弹窗。
- 投票关闭时显示横幅并禁用操作。

### F3 投票规则（服务端强制）

- `PUT /api/votes/:iconId`：新增一票。
  - 未登录 → 401；管理员会话 → 403；投票关闭 → 403 `VOTING_CLOSED`；
    图标不存在 → 404；已有 5 票 → 409 `LIMIT_REACHED`；
    已投过该图标 → 200 幂等成功。
  - 成功返回最新 `{ myVotes, icons, totalVotes, votersCount }`。
- `DELETE /api/votes/:iconId`：取消一票；未投过 → 200 幂等成功；
  投票关闭 → 403 `VOTING_CLOSED`。
- 同一用户同一图标最多一条记录（数据库唯一约束）。

### F4 前台状态接口

`GET /api/state`（公开）返回：

```json
{
  "authMode": "mock",
  "votingOpen": true,
  "maxVotes": 5,
  "totalVotes": 12,
  "votersCount": 4,
  "user": { "nick": "张三", "avatarUrl": "" },
  "myVotes": ["01", "05"],
  "icons": [
    { "id": "01", "name": "无限连接", "url": "/icons/01_%E6%97%A0%E9%99%90%E8%BF%9E%E6%8E%A5.png", "count": 3, "rank": 1 }
  ],
  "iconsAvailable": true
}
```

- `icons` 按编号升序；`rank` 按票数降序计算，并列同名次（1,2,2,4）。
- 未登录时 `user=null`、`myVotes=[]`。
- 不返回任何投票人列表。

### F5 管理端登录

- `POST /api/admin/login` `{password}`：成功写管理员会话；失败 401。
- 恒定时间比较；每 IP 5 分钟最多 10 次失败尝试，超出 429。
- `POST /api/admin/logout` 清除会话。
- 管理接口未登录 → 401；员工会话访问 → 403。

### F6 管理端数据

- `GET /api/admin/state`：
  - `votingOpen`、`totalVotes`、`votersCount`、`userCount`、`iconCount`；
  - `icons`（含票数、排名、占比）；
  - `recentVotes`（最近 20 条：昵称、图标编号/名称、时间）；
  - `iconsAvailable`、`authMode`、`publicBaseUrl`（可选，便于排查回调）。
- `GET /api/admin/voters`：投票人列表，按最近投票时间倒序；每人含
  `nick`、`avatarUrl`、`votes[]`（iconId/iconName/createdAt）、`lastVotedAt`。
- 不返回 unionId、session、密钥。

### F7 开关与重置

- `PUT /api/admin/settings` `{votingOpen: boolean}` → 更新 `settings.voting_open`；
  返回最新状态。关闭后前后端都冻结投票操作。
- `POST /api/admin/reset` `{confirm:"RESET"}`：
  - 确认词不符 → 400；成功清空 `votes`，保留 `users`，返回 `{ok:true, totalVotes:0}`。
  - 操作日志只记录“管理员重置了投票”和时间，不记录口令。

### F8 CSV 导出

- `GET /api/admin/export.csv`：`Content-Type: text/csv; charset=utf-8`，
  `Content-Disposition: attachment; filename="toupiao-YYYY-MM-DD.csv"`。
- UTF-8 BOM 开头；表头：`姓名,图标编号,图标名称,投票时间`。
- 每条投票一行；时间用服务器本地时区 `YYYY-MM-DD HH:mm:ss`。
- 字段中的逗号、引号、换行按 RFC 4180 转义。
- 防公式注入：以 `=`、`+`、`-`、`@`、制表符或回车开头的字段，前置单引号（或等效处理），
  避免用 Excel 打开时被当作公式执行。

### F9 图标

- 启动扫描 `ICONS_DIR`，匹配 `^(\d{2})_(.+)\.png$`，按编号升序。
- `GET /icons/<文件名>` 只服务扫描白名单中的文件；设置长缓存与正确 Content-Type。
- 目录不存在/为空：服务启动成功，`iconsAvailable=false`，前台空状态，后台警告。
- 编号重复时保留第一个并打印警告（不崩溃）。

### F10 部署

- 多阶段 Dockerfile；运行阶段无 devDependencies；非 root 用户。
- `docker-compose.yml`：`3001:3001`（`HOST_PORT` 可覆盖），
  `./data:/app/data`，`./assets/icons:/app/assets/icons:ro`，healthcheck 打 `/api/health`。
- 端口在 `deploy/ports.md` 登记：应用 3001，对外 3100。
- CI 增加 toupiao 的构建与测试；CD 下拉增加 toupiao。

## 边界条件

- 两个同名钉钉用户（不同 unionId）各自独立计票；显示名可重复。
- 同一用户并发发 6 个投票请求：最多成功 5 条，其余 409。
- 达到 5 票后取消再投另一个：成功，总数仍为 5。
- 投票关闭瞬间的并发请求：以服务端事务/设置读取为准，不允许关闭后写入。
- 空数据库首次访问：总票数 0，所有图标票数 0，排名 1。
- 20 张图全部 0 票：全部并列第 1（或统一显示 `-`），前端需处理并列。
- 图标文件名含中文/空格：URL 必须编码，浏览器能正常显示。
- 会话过期/被篡改：视为未登录，不 500。
- 管理员重置时同时有人投票：重置后票数归零，不出现负数或半截数据。
- 数据库文件损坏/不可写：启动失败并给出明确路径与原因，不静默用内存库。
- 反向代理后 `X-Forwarded-Proto=https`：Secure cookie 与回调地址正确。
- 超长姓名（mock）、超长 JSON、畸形 JSON：400，不崩溃、不写库。

## 技术约束

- Node.js 24；后端零运行时 npm 依赖；`node:sqlite`。
- Vue 3 + Vite 7；不引入 UI 组件库与 CSS 框架。
- 单容器；不引入 Redis、Postgres、Nginx。
- 图标不入库；运行时通过 `ICONS_DIR` 提供。
- 所有密钥只从环境变量读取；仓库只提交 `.env.example`。
- 不用 TypeScript；不新增 lint/format 命令。

## 兼容性要求

- 桌面 Chrome/Edge 最新版；移动端钉钉内置浏览器、微信内置浏览器可正常浏览与投票
  （钉钉登录在钉钉内置浏览器中应可用；若受限，给出明确提示）。
- 375px 宽度无横向滚动；触控目标不小于 40px。
- Excel（Windows/macOS）能正确打开导出的 CSV（BOM）。

## 验收标准

- [ ] A1 未登录可浏览 20 个图标与实时票数；点击投票出现登录入口。
- [ ] A2 dingtalk 模式登录跳转参数正确（client_id/redirect_uri/state/scope/corpId），
      回调校验 state 并建立会话；错误 state 不建立会话；`next` 为外部地址时回退首页。
- [ ] A3 mock 模式可输入姓名登录，页面有“开发模式”标识；dingtalk 模式下 mock 接口不可用。
- [ ] A4 登录后会话在刷新后保持；退出后清除。
- [ ] B1 同一用户最多 5 个不同图标；第 6 个返回 409 且数据不变。
- [ ] B2 同一图标不能重复计票；重复请求幂等。
- [ ] B3 可取消任意已投票；取消后可改投；总数正确。
- [ ] B4 并发 6 个请求最多成功 5 个。
- [ ] B5 关闭投票后新增/取消均被拒绝，前台显示已结束。
- [ ] B6 重启服务后投票、用户、开关状态仍在。
- [ ] C1 管理员错误口令 401 且被限流；正确口令进入后台。
- [ ] C2 后台展示总票数、参与人数、各图标票数/排名、最近投票。
- [ ] C3 投票人明细含姓名、所投图标、时间；前台不泄露姓名。
- [ ] C4 开关投票立即生效。
- [ ] C5 CSV 带 BOM、字段正确、RFC 4180 转义正确、防公式注入、与数据库一致。
- [ ] C6 重置必须 `RESET`；只清投票、保留用户；重置后统计归零。
- [ ] D1 桌面 1440px 与移动 375px 布局正常，无横向滚动，图例/按钮可用。
- [ ] D2 我的票数 x/5、剩余票数、已选状态清晰；满 5 后未选卡片禁用并提示。
- [ ] D3 票数/排名 5 秒轮询更新；页面隐藏时暂停；投票后即时更新。
- [ ] D4 关闭状态、空图标、错误提示均有可读文案。
- [ ] E1 `npm run build`、`npm test` 通过；测试覆盖 A2/A3/B1–B6/C1–C6。
- [ ] E2 `docker compose build` 与 `up -d` 成功，容器 healthy，页面/API 可用。
- [ ] E3 无密钥入库；`.env` 被忽略；日志不含口令/Secret。
- [ ] E4 端口登记、CI、CD、根 README/AGENTS 已同步。
- [ ] E5 图标缺失时服务不崩、页面有明确提示。

## 待确认问题

均已确认：

- 钉钉方式：扫码 OAuth2 + 本地 mock（用户 2026-11-04）。
- 前台票数：实时公开排名与票数（同上）。
- 图标：不入库，部署时手工上传（同上）。
- 部署范围：先备 Docker/端口，域名稍后（同上）。
- 流程：FULL 完整闭环（同上）。
- 默认后台登录方式定为独立管理口令；若用户后续要求改为钉钉管理员白名单，另开 Spec。
