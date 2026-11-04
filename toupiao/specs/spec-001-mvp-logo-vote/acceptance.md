# Acceptance — spec-001 MVP Logo 投票

- 验收时间：2026-11-04 12:41（Asia/Shanghai）
- 验收环境：macOS，Node v24.20.0，npm 11.19.0，Docker 29.7.2，系统 Chrome（Playwright `channel: 'chrome'`）
- 验收方式：独立反例脚本 + 独立浏览器断言 + Docker 实跑；所有临时实例使用临时
  `DATA_DIR` / `ICONS_DIR` / 空闲端口，未读写仓库现有 `data/`，未修改业务代码或其它文档（仅写入本验收文件）
- 结论：**PASS**

## Result

**PASS**

## Spec Coverage

| 验收项 | 结果 | 实际证据 |
|---|---|---|
| A1 未登录浏览与登录入口 | 通过 | 独立 UI：20 张卡片、总票数 0、点卡片弹出 `role=dialog` 登录框、显示“开发模式”；E2E A1/A3 同样通过 |
| A2 钉钉参数、state、回调、next、缺配置 | 通过（契约级） | 302 Location 的 `redirect_uri=https://vote.example.test/api/auth/callback`、`client_id`、`response_type=code`、`scope=openid`、`prompt=consent`、`state`、`corpId` 全部逐项断言通过；state cookie 为 HttpOnly/SameSite=Lax；错误/缺失 state 均回 `?auth_error=STATE_INVALID` 且无会话；缺 code 回 `CODE_MISSING`；`next=//evil.example`、`https://evil.example`、`/\evil`、`/%2F%2Fevil` 均回退 `/`；注入 fetch 模拟 token/userinfo，成功回调建立会话并回 `/admin`；缺 AppKey/AppSecret/PUBLIC_BASE_URL 三种情况进程均非 0 退出且 stderr 点名缺失变量 |
| A3 mock 登录与 dingtalk 下禁用 | 通过 | mock 姓名登录成功、页面“开发模式”标识；`AUTH_MODE=dingtalk` 下 `POST /api/auth/mock` 返回 404；E2E mock 登录通过 |
| A4 会话保持与退出 | 通过 | E2E 刷新后仍为同一用户且 5 票仍在；独立重启实例后旧 cookie 仍可读用户/票；独立登出测试：员工 `POST /api/auth/logout` 后 `/api/state` 的 user 为 null、投票 401；管理员 `POST /api/admin/logout` 后 admin state 401 |
| B1 最多 5 个不同图标、第 6 个 409 | 通过 | E2E 第 6 票显示“最多投 5 个”且数据不变；独立 API 确认第 6 个不同图标 409 |
| B2 同图标不重复、重复 PUT 幂等 | 通过 | 重复 `PUT /api/votes/01` 返回 200 且 `myVotes` 仍 5；DB 直查 `GROUP BY user_id, icon_id HAVING COUNT(*)>1` 为 0 |
| B3 取消与改投 | 通过 | 取消 03 后 `totalVotes=4`，改投 06 后 `totalVotes=5`、myVotes 正确；DELETE 未投过图标幂等 200 |
| B4 并发上限 | 通过 | 新用户同时发 8 个 PUT（01–06，含重复）：状态仅 200/409；DB 中该用户恰好 5 条，无 `COUNT(*)>5`、无同图标重复 |
| B5 关闭后冻结 | 通过 | 关闭后新增与取消均 403 `VOTING_CLOSED`，前后 `totalVotes`/`myVotes` 完全一致；前台关闭横幅、20 个卡片进入 blocked 态；E2E 再次验证 |
| B6 重启持久化 | 通过 | 独立 API：重启后旧员工会话、5 票、关闭状态、管理员会话全部保留；Docker：`restart` 后 `totalVotes=1`、`votingOpen=false`、昵称与 `myVotes` 仍在 |
| C1 管理员口令与限流 | 通过 | 连续 10 次错误口令均 401；第 11 次（即使口令正确）429 且 `Retry-After` 为有效正整数；重启后正确口令 200 |
| C2 后台总览 | 通过 | 独立 `/api/admin/state` 含 `votingOpen/totalVotes/votersCount/userCount/iconCount/icons/recentVotes/iconsAvailable/authMode/publicBaseUrl`；E2E 后台总票数/参与人数/明细显示正确 |
| C3 投票人明细与前台隐私 | 通过 | E2E 后台投票人表含姓名与 5 个图标；独立公开 `/api/state` 原文不含两位投票人姓名、不含 unionId/voters 字段，未登录 `user=null`、`myVotes=[]` |
| C4 开关立即生效 | 通过 | 管理员 PUT `votingOpen:false` 后前台 API 立即为 false；E2E 关闭后前台冻结、重开后恢复 |
| C5 CSV | 通过 | 原始字节 BOM `EF BB BF`；表头 `姓名,图标编号,图标名称,投票时间`；`=2+2` 导出为 `'=2+2`；`含逗号,引号"名字` 正确转义为 `"含逗号,引号""名字"`；行数=表头+2 且逐行与 DB 对账一致；`Content-Disposition: attachment; filename="toupiao-YYYY-MM-DD.csv"`；时间格式 `YYYY-MM-DD HH:mm:ss` |
| C6 重置 | 通过 | 缺 `confirm`、`reset`、`Reset` 均 400；`RESET` 返回 200、`totalVotes=0`；DB votes=0、users 保留；公开统计归零 |
| D1 桌面/移动布局 | 通过 | 独立浏览器 1440px 与 375px `scrollWidth <= innerWidth+1`；20 张图全部 `naturalWidth>0`；375px 两列；`/admin` 375px 无横向滚动；截图见 `/tmp/toupiao-acceptance/ui-*.png` |
| D2 票数/已选/满 5 状态 | 通过（有一处非阻塞语义问题） | 5/5、剩余 0、5 张 `aria-pressed=true`、未选 15 张显示“已满 5 票，先取消一个”；第 6 票被拒且计数不变。注：卡片按钮未设置 HTML `disabled`/`aria-disabled`，见 Issues 1 |
| D3 轮询/隐藏暂停/即时更新 | 通过 | 独立轮询测试 3/3：页面无刷新 5 秒内从 0→1；`document.hidden` 覆盖后 6.5 秒仍为 1；恢复可见触发 `visibilitychange` 后立即变 2；E2E 投票后用响应即时更新 |
| D4 关闭/空图标/错误文案 | 通过 | 关闭横幅“投票已结束”、空图标页“尚未上传候选图标”、后台警告、错误 toast 均有可读中文；空目录实例不崩 |
| E1 构建与测试 | 通过 | `npm ci` 成功；`npm run build` 成功；`npm test` 39/39；`npm run test:e2e` 17/17 步 |
| E2 Docker | 通过 | `docker compose build` + `up -d`，healthy；页面/API 可用；restart 后数据与开关保留；`id -u=1000`；镜像层无 `/app/node_modules`、无 `/app/.env`、无 PNG；`down` 清理 |
| E3 密钥与忽略 | 通过 | `git add -n toupiao` 70 个文件，不含 `.env`/`data/`/`assets/icons/*.png`/`client/dist`/`node_modules`/`e2e/artifacts`；源码扫描只有 README/docs 的占位示例，无真实 Secret；`.env` 被根 `.gitignore` 忽略 |
| E4 结构、端口、CI/CD、登记 | 通过 | FULL 结构齐全（AGENTS/README/constitution/specs/_template/.ai/docs/tests/e2e）；`deploy/ports.md` 登记 3001/3100；`ci.yml` 有 toupiao 构建+测试+镜像校验；`cd.yml` 下拉含 toupiao；根 README 与 AGENTS 均有 toupiao 行。注：状态文案仍为“MVP 实施中”，见 Issues 3 |
| E5 图标缺失 | 通过 | 目录缺失与空目录两种实例均启动成功、`/api/health` 200、`iconsAvailable=false`、`icons=[]`、图片请求 404；重复编号只保留一个并输出“编号重复”警告；中文文件名 URL 200 `image/png` |

## Tests

以下命令均由验收 Agent 在本轮实际执行：

| 命令 | 结果 |
|---|---|
| `npm ci` | 成功，added 38 packages，0 vulnerabilities；lockfile 可复现 |
| `npm run build` | 成功，39 modules transformed，`dist/index.html` 0.88 kB、CSS 22.63 kB、JS 140.30 kB，约 286ms |
| `npm test` | **39 通过 / 0 失败 / 0 跳过**，约 222ms |
| `npm run test:e2e` | **17/17 步通过**（mock 登录、投 5、第 6 拒、取消改投、刷新保持、375px、后台、关闭/重开、CSV、重置）；截图与 CSV 在仓库 `e2e/artifacts/`（已 gitignore） |
| `node /tmp/toupiao-acceptance/accept.mjs` | **14/14 通过**：钉钉契约/错误 state/启动失败、并发 8、幂等/取消/关闭/重启、管理员限流/鉴权、CSV 对账、重置、HTTP 安全、图标白名单/缺失/重复、登出 |
| `node /tmp/toupiao-acceptance/ui.mjs` | **7/7 通过**：20 图加载、1440/375 无横向滚动、aria/alt、登录弹窗、满 5、admin 375、RESET 禁用、关闭横幅 |
| `node /tmp/toupiao-acceptance/poll.mjs` | **3/3 通过**：5 秒轮询、隐藏暂停、恢复立即刷新 |
| `/tmp/toupiao-acceptance/docker.sh` | compose build/up 成功；首次 healthy 6s、restart 后 healthy 6s；`uid=1000`；容器与镜像内无 node_modules/.env，镜像 `assets/icons` 无 PNG；`docker compose down` 后无残留容器/镜像 |

Docker 说明：为不改动仓库现有 `.env`/`data/`，将当前源码复制到
`/tmp/toupiao-acceptance/docker-project` 执行同一份 `Dockerfile`/`docker-compose.yml`
（仅把容器名改为 `toupiao-acceptance`、镜像标签改为 `toupiao-acceptance:latest` 避免与
现有容器冲突），图标复制自仓库 `assets/icons`。`docker compose build` 的层缓存命中，
但构建上下文即当前源码。

未执行项：**真实钉钉扫码端到端登录**。原因：无真实 AppKey/AppSecret 与已备案 HTTPS
回调域名，钉钉不允许本地回调。替代验证：注入 fetch 精确断言 authorize URL、token 请求体、
userinfo 调用、state 校验、会话建立与 `next` 回跳；真实钉钉侧协议差异仍有剩余风险。

## Issues

### 阻塞

无。

### 非阻塞

1. **满 5 票与关闭状态下，卡片按钮不是 HTML 语义上的 disabled**
   - 复现：登录并投满 5 票，或管理员关闭投票；在浏览器执行
     `document.querySelector('[data-icon-id="06"] .icon-button').disabled`
     得到 `false`，`aria-disabled` 为 `null`。
   - 实际行为：卡片仅通过 `.is-blocked`（透明度/`cursor:not-allowed`）和 JS 守卫拦截，
     点击会弹“最多投 5 个”或“投票已结束” toast；服务端 409/403 兜底，**数据不会写错**。
   - 影响：视觉与功能正确，但键盘/读屏用户仍可聚焦并触发按钮，D2 的“禁用”语义不完整。
   - 建议：未选满 5/投票关闭时给按钮加 `:disabled` 或 `aria-disabled="true"`，并保留提示文案。

2. **`HEAD /api/state` 返回 405**
   - 复现：`curl -I http://127.0.0.1:<port>/api/state` → 405；而 `HEAD /` 返回 200、空 body。
   - 影响：API 只显式接受 GET，未实现 HEAD 到 GET 的映射；规范未要求 API HEAD，
     静态页 HEAD 正常。若希望统一 HEAD 语义，需要补充路由层映射。

3. **状态文案滞后**
   - `spec.md` 仍写“状态：待实施”；根 `README.md`/`AGENTS.md` 的 toupiao 行仍为“MVP 实施中”。
   - 影响：不影响运行与验收项本身（两处登记均已存在）；建议验收通过后随交付一起更新为“MVP 已完成”。

## Regression Risks

- **真实钉钉联调缺失**：token/userinfo 的 mock 契约通过，但真实钉钉返回码、网络错误、
  企业 corpId 限制与 HTTPS/Secure cookie 行为仍需真实环境回归。
- **限流为单实例内存**：多副本部署时限流按实例独立；重启后计数清零。当前单容器部署符合
  Spec，若未来扩容需改为共享存储。
- **`TRUST_PROXY` 默认 1**：直连暴露应用端口时 `X-Forwarded-For` 可被伪造绕过管理登录限流；
  文档已要求 3001 仅本机、由 Caddy 反代，部署时需保持该前提。
- **mock 模式可冒名**：站点若误开公网，任何人可输入任意姓名投票；已有页面“开发模式”标识、
  启动警告和文档提示，但仍依赖部署者确认 `AUTH_MODE=dingtalk`。
- **图标不在 git**：新机器必须手工上传 20 张 PNG；缺失时服务不崩但无法投票，属于运维步骤。
- **管理员会话与员工会话并存**：当前策略是只要存在管理员会话就拒绝投票（403），符合已知限制；
  若未来改为同浏览器双角色需重新设计。

## Required Rework

无阻塞返工项，A1–E5 全部满足。

建议的非阻塞后续（不阻塞本次 PASS）：

1. 为满 5 票/关闭状态下的卡片按钮补 `disabled` 或 `aria-disabled` 语义（Issue 1）。
2. 视需要统一 `/api/*` 的 HEAD 行为（Issue 2）。
3. 交付前更新 `spec.md` 与根 README/AGENTS 的状态文案（Issue 3）。
4. 拿到真实钉钉应用与 HTTPS 域名后补做一次真实扫码登录联调。
