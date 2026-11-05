# Spec — spec-002 钉钉配置后台化与 UI 整改

- 状态：**已验收（PASS，2026-11-04）**
- 档位：FULL
- 关联：`spec-001`、`constitution/tech-stack.md`、`.ai/decisions/002`、`.ai/decisions/003`

## 背景

MVP 的登录配置只能写在 `.env`，并保留了一个 `AUTH_MODE=mock` 的本地登录。
用户 2026-11-04 明确要求：

1. **删除开发者模式**：产品里不再有 mock 登录、开发模式标识或相关入口；
2. **在管理面板配置钉钉登录**：管理员不需要改服务器文件/重启，就能填写 AppKey、
   AppSecret、corpId 与站点地址；
3. **全量检查 UI 问题**：例如未登录状态栏里的「登录后投票」这种重复/多余入口。

## 目标

1. 只保留钉钉扫码 OAuth2 登录；移除 `AUTH_MODE`、`/api/auth/mock` 与所有 mock UI。
2. 管理后台新增“钉钉登录”配置：站点地址、AppKey、AppSecret、corpId；
   保存后立即生效，无需重启；展示回调地址并可复制。
3. AppSecret 加密落库，接口只返回“已配置”，绝不回传明文，也不写日志。
4. `.env` 只作为首次部署的**可选**引导配置；后台配置优先。
5. 未配置钉钉时不崩溃：管理员可登录后台配置；前台登录入口给出简短提示。
6. UI 清理：去掉重复入口、无意义文案、0 票仍显示排名的怪异状态，保持 375/1440 可用。

## 非目标

- 不做多个钉钉应用/多租户；一套部署只配置一个企业应用。
- 不做钉钉工作台免登（`dd.requestAuthCode`）；仍用扫码 OAuth2。
- 不做密钥轮换审计、配置历史、角色管理。
- 不做 `AUTH_MODE` 的任何兼容；升级后旧 `.env` 里的 `AUTH_MODE` 被忽略。

## 当前行为

- `AUTH_MODE=dingtalk|mock` 决定认证方式；mock 可输入任意姓名登录。
- 钉钉凭据只能来自 `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` / `DINGTALK_CORP_ID` /
  `PUBLIC_BASE_URL`；缺失时启动失败。
- 前台 `/api/state` 返回 `authMode`；登录弹窗在 mock 下显示姓名表单。
- 未登录状态栏同时有「已投 0/5」「剩余 5 票」「登录后投票」，
  右侧「我的投票」面板又有「登录参与投票」，入口重复。
- 0 票的候选卡显示「第 6 名」，与 5 个并列第 1 的卡片并列时观感奇怪。
- 管理后台只能看数据/开关/导出/重置，不能配置登录。

## 目标行为

### 管理员

1. 用 `ADMIN_PASSWORD` 登录 `/admin`。
2. 看到「钉钉登录」面板：
   - 状态：已配置 / 未配置；
   - 站点地址（如 `https://vote.example.com`）；
   - AppKey；
   - AppSecret（密码框；已保存时留空表示不修改，占位提示“已保存，留空不修改”）；
   - corpId（可选）；
   - 回调地址（只读，由站点地址 + `/api/auth/callback` 生成，可复制）；
   - 保存按钮与结果提示。
3. 保存后：
   - 配置立即生效，无需重启；
   - 前台下一次轮询即可登录；
   - AppSecret 不回显；刷新后台仍只显示“已保存”。
4. 未配置时，后台给出“钉钉登录未配置”的状态；仍可正常使用其它管理功能。

### 员工

1. 打开首页，未登录可浏览候选与票数。
2. 点击卡片或「登录参与投票」→ 登录弹窗，只有「使用钉钉登录」。
3. 钉钉登录成功后回到原页面，可投 5 票。
4. 未配置钉钉时，点击登录提示「登录暂未开放」，不跳转、不报错页面。
5. 已登录后不再出现登录入口；退出后恢复。

### 运维

1. 首次部署只需 `ADMIN_PASSWORD` 与 `SESSION_SECRET`，不再因缺少钉钉凭据启动失败。
2. 管理员在后台填好钉钉配置后即可使用；`.env` 的 `DINGTALK_*` / `PUBLIC_BASE_URL`
   仍可作为引导默认值，后台保存的值优先。
3. 改 `SESSION_SECRET` 会导致已保存的 AppSecret 无法解密：后台显示未配置，
   重新填写即可（README/docs 说明）。

## 功能需求

### F1 移除 mock / 开发者模式

- 删除 `AUTH_MODE` 配置及 `config.isMock` / `config.authMode` 的判断。
- 删除 `POST /api/auth/mock`；访问返回 404。
- 删除前端 mock 姓名表单、`authMode` 分支、开发模式徽标/横幅/提示。
- `/api/state` 删除 `authMode`，新增 `loginConfigured: boolean`。
- 仓库搜索不得再有 `AUTH_MODE` / `mock 登录` / `开发模式` 的产品入口
  （测试、历史验收记录、内部测试基址除外）。

### F2 配置存储与解析

- `settings` 表新增键：
  - `dingtalk.app_key`
  - `dingtalk.app_secret_enc`
  - `dingtalk.corp_id`
  - `dingtalk.public_base_url`
- 解析顺序：**数据库非空值 > 环境变量 > 空**。
- `configured = appKey && appSecret && publicBaseUrl`。
- 回调地址 = `publicBaseUrl + /api/auth/callback`（去除末尾斜杠）。
- 每次请求读取当前配置，保存后立即生效。
- 环境变量仍支持：`DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_CORP_ID`、
  `PUBLIC_BASE_URL`（全部可选）。

### F3 AppSecret 加密

- 使用 Node 内置 `crypto`：AES-256-GCM，密钥由 `SESSION_SECRET` 经 HKDF 派生；
  随机 12 字节 IV；存储格式带版本前缀 `v1:`。
- 数据库里不得出现明文 AppSecret；API 不返回 secret；日志不打印 secret。
- 解密失败（如换了 `SESSION_SECRET`）→ 视为未配置并打印一次警告，不崩溃。
- 保存时 AppSecret 为空/未提供 → 保留原密文；首次配置必须提供。

### F4 管理 API

- `GET /api/admin/dingtalk`（管理员）：
  ```json
  {
    "configured": true,
    "appKey": "ding...",
    "corpId": "ding...",
    "publicBaseUrl": "https://vote.example.com",
    "callbackUrl": "https://vote.example.com/api/auth/callback",
    "hasSecret": true,
    "source": "db"
  }
  ```
  `source` 为 `db` / `env` / `mixed` / `none`（便于排查，不显示 secret）。
- `PUT /api/admin/dingtalk`（管理员）`{ appKey, appSecret?, corpId, publicBaseUrl }`：
  - 校验：AppKey 1–128 字符；AppSecret 1–256 字符（若提供）；corpId ≤128；
    `publicBaseUrl` 必须是 http/https 的 origin（无路径/查询），生产要求 https，
    本地 `localhost` / `127.0.0.1` 允许 http。
  - 成功返回同 GET 结构；失败 400 带可读中文。
  - 保存操作记录日志（只记“已更新”，不记 secret）。
- 管理接口仍需管理员会话；员工会话 403。

### F5 登录流程

- `GET /api/auth/login?next=/...`：
  - 未配置 → 302 到 `/?auth_error=AUTH_NOT_CONFIGURED`（不抛 500）。
  - 已配置 → 使用当前配置拼钉钉授权 URL；state 机制不变。
- `GET /api/auth/callback`：使用当前配置换 token / 取用户；错误仍回可读错误。
- 前端 `openLogin()`：若 `loginConfigured=false`，toast「登录暂未开放」并 return；
  否则打开只有钉钉按钮的弹窗。

### F6 管理端 UI

- `AdminDashboard` 增加「钉钉登录」面板（可放在投票开关之前/之后）：
  - 状态 pill：已配置/未配置；
  - 表单（站点地址、AppKey、AppSecret、corpId）；
  - 回调地址只读 + 复制按钮；
  - 保存/保存中/成功/失败提示；
  - 窄屏单列，无横向滚动。
- AppSecret 输入框：
  - 已保存时 placeholder「已保存，留空不修改」；
  - 未保存时 placeholder「请输入 AppSecret」；
  - 不得把 secret 写进 value 或 DOM。
- 保存成功后重新拉取配置；不刷新整页。

### F7 UI 清理（全量检查的一部分）

- 未登录状态栏：删除「登录后投票」重复入口；登录入口统一放在「我的投票」面板
  与卡片点击/登录弹窗。
- 状态栏删除「剩余 X 票」（与「已投 X/5」重复）；保留「已投 X/5」。
- Hero 删除「我的票数」卡（与状态栏/侧栏重复），只保留总票数、参与人数。
- 0 票卡片不再显示「第 N 名」，只显示「0 票」；有票才显示排名。
- 管理端「投票开关」面板补状态 pill，避免只有标题+按钮的空洞布局。
- 登录弹窗只保留标题 + 「使用钉钉登录」，无解释段落。
- 全站检查：1440/375 无横向滚动；按钮/链接有 hover/focus；图片 alt；
  空图标、关闭状态、满 5 票、加载失败、登录失败文案可读；不出现开发模式文案。

## 边界条件

- 未配置钉钉：服务正常启动；管理员可登录；员工登录提示未开放。
- 只填 AppKey 不填 Secret：`configured=false`，登录仍提示未开放；保存时若已有 secret
  则保留，若没有则 400。
- 站点地址带路径/查询/锚点：400。
- 生产环境 http 地址：400；localhost/127.0.0.1 允许 http（本地调试）。
- 保存后立刻点登录：使用新配置（无缓存）。
- 环境变量有值、后台填写空：后台空值不覆盖环境变量（视为未设置），仍用 env。
- 换 `SESSION_SECRET`：secret 解密失败 → 未配置；管理员重填后恢复。
- 并发保存：后写覆盖，返回最终状态；不泄露 secret。
- 回调地址与钉钉后台不一致：钉钉报错，用户回到首页带 `LOGIN_FAILED`/`DENIED`。
- 恶意 AppSecret 含换行/超长：400 或安全存储，不打印。
- 跨源写、员工会话改配置：403。
- 未登录访问管理配置：401。

## 技术约束

- Node.js 24 内置 `crypto`；不新增运行时依赖。
- 不引入 mock 路由；E2E 用**本地假钉钉服务 + 测试专用 base URL 环境变量**，
  仅当 `NODE_ENV=test` 时允许覆盖钉钉 endpoint；生产忽略。
- 所有配置 API 走现有 `http.js` 的 JSON/Origin/错误体约定。
- SQLite `settings` 表已存在，无需迁移；加密值只存 `settings`。
- 前端不新增 UI 库；复用现有 CSS 变量与组件风格。

## 兼容性要求

- 现有投票数据、用户、`voting_open` 保持不变。
- 旧 `.env` 的 `DINGTALK_*` / `PUBLIC_BASE_URL` 继续可用；`AUTH_MODE` 被忽略。
- 管理员口令、会话 cookie、限流、CSV、重置行为不变。
- 桌面/移动 Chrome；375px 无横向滚动。

## 验收标准

- [ ] A1 仓库与运行时不再有 mock 登录/开发者模式入口；`POST /api/auth/mock` 404。
- [ ] A2 未配置钉钉时服务能启动；管理员可登录；员工点登录提示未开放，无 500。
- [ ] A3 管理员在后台保存 AppKey/Secret/corpId/站点地址后，配置立即生效；刷新仍显示已配置。
- [ ] A4 AppSecret 不出现在 GET/PUT 响应、DOM、日志、数据库中（数据库为密文）。
- [ ] A5 回调地址正确生成并可复制；错误 URL 被 400 拒绝。
- [ ] A6 用假钉钉服务完成一次真实 OAuth 跳转 → 回调 → 会话 → 5 票流程。
- [ ] A7 数据库配置优先于 env；env 仍可作为引导；换 `SESSION_SECRET` 后显示未配置。
- [ ] A8 UI：状态栏无「登录后投票」、无「剩余 X 票」；hero 无「我的票数」；
      0 票卡片无排名；管理开关面板有状态；1440/375 无横向滚动。
- [ ] A9 `npm run build`、`npm test`、`npm run test:e2e` 全绿；E2E 覆盖后台配置+登录。
- [ ] A10 README/docs/AGENTS/tech-stack/decisions 同步；无真实密钥入库。

## 待确认问题

用户 2026-11-04 已明确：删除开发者模式、后台配置钉钉、全量 UI 检查。
实现层面的取舍（加密、env 回退、配置面板字段）由本 Spec 决定，不再重复询问。
