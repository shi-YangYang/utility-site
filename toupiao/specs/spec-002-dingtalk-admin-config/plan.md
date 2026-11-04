# Plan — spec-002 钉钉配置后台化与 UI 整改

## 实施顺序

1. **后端配置层**：新增 `server/dingtalk-config.js`（加密、解析、校验、保存）；
   `db.js` 补通用 `setSetting/deleteSetting`。
2. **认证改造**：`config.js` 去掉 `AUTH_MODE`/mock；`auth.js` 改为按当前配置拼授权 URL、
   换 token、取用户；删除 mock 函数。
3. **路由**：删除 `/api/auth/mock`；`/api/auth/login` 未配置时回跳错误；
   新增 `GET/PUT /api/admin/dingtalk`；`/api/state` 改返回 `loginConfigured`。
4. **管理端 UI**：新增 `DingTalkSettings.vue`，接入 `AdminDashboard`；
   表单、状态、回调地址复制、窄屏布局。
5. **登录 UI**：`LoginDialog` 只留钉钉按钮；前台按 `loginConfigured` 拦截；
   删除 mock 分支与 `authMode`。
6. **UI 清理**：状态栏、hero、0 票排名、管理开关面板。
7. **测试**：测试 helper 改为直接注入会话；补配置加密/解析/校验/权限测试；
   E2E 增加本地假钉钉服务，覆盖“后台配置 → 钉钉跳转 → 回调 → 投票”。
8. **文档**：README/docs/.env.example/AGENTS/tech-stack/decisions/spec-002 acceptance。

## 后端文件

| 文件 | 改动 |
|---|---|
| `server/dingtalk-config.js`（新） | 设置键、AES-256-GCM 加解密、DB/env 合并、校验、保存 |
| `server/config.js` | 删除 `AUTH_MODE`/`isMock`/`authMode`；DingTalk env 改为可选；测试 endpoint 覆盖 |
| `server/auth.js` | 删除 mock；`buildAuthorizeUrl(settings,state)`、`callbackUrl(base)`；token/userinfo 接受 API base |
| `server/routes/auth.js` | 删除 mock；未配置回跳 `AUTH_NOT_CONFIGURED`；使用当前配置 |
| `server/routes/admin.js` | 新增 GET/PUT `/api/admin/dingtalk` |
| `server/app.js` | 路由表更新（删除 mock，加 dingtalk config） |
| `server/state.js` | 删除 `authMode`，加 `loginConfigured`；管理状态加 `dingtalkConfigured` |
| `server/db.js` | `setSetting` / `deleteSetting`（如缺） |

## 配置键与加密

```text
dingtalk.app_key
dingtalk.app_secret_enc      v1:<base64url(iv|tag|ciphertext)>
dingtalk.corp_id
dingtalk.public_base_url
```

- 密钥：`hkdfSync('sha256', SESSION_SECRET, 'toupiao-dingtalk-secret', 32)`。
- 加密：AES-256-GCM，12B IV，16B tag；解密失败视为未配置。
- 解析：DB 非空 > env；`configured = appKey && appSecret && publicBaseUrl`。
- 回调：`publicBaseUrl.replace(/\/$/, '') + '/api/auth/callback'`。

## API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/admin/dingtalk` | 管理员 | 返回 configured/appKey/corpId/publicBaseUrl/callbackUrl/hasSecret/source |
| PUT | `/api/admin/dingtalk` | 管理员 | 保存；secret 可省略表示保留 |
| GET | `/api/auth/login` | - | 未配置 302 回 `/?auth_error=AUTH_NOT_CONFIGURED` |
| POST | `/api/auth/mock` | - | **删除**，404 |

## 测试方案

- `tests/helpers.js`：删除 HTTP mock 登录；新增 `loginAs(name)`：
  直接 `store.upsertUser` + `createUserSessionToken` + 设置 cookie。
- `tests/dingtalk-config.test.js`（新）：加密/解密、DB>env、空值回退、URL 校验、
  `SESSION_SECRET` 变化、secret 不落明文。
- `tests/auth.test.js`：未配置提示、授权参数、state、回调（注入 fetch）、404 mock。
- `tests/admin.test.js`：配置 GET/PUT、权限、secret 不回显、立即生效。
- `tests/votes.test.js` / `persistence.test.js`：改用 `loginAs`。
- `e2e/fake-dingtalk.mjs`（新）：`/oauth2/auth` → 302 回调；token/userinfo JSON。
- `e2e/run.mjs`：启动 fake provider，`NODE_ENV=test`、
  `DINGTALK_TEST_BASE=http://127.0.0.1:<fake>`；管理员登录后台填写配置并保存；
  退出后台；点“使用钉钉登录”完成真实跳转/回调；后续投票流程不变。

## UI 改动

- `client/src/components/DingTalkSettings.vue`（新）：状态、站点地址、AppKey、
  AppSecret（留空不修改）、corpId、回调地址复制、保存。
- `AdminDashboard.vue`：插入面板；投票开关补状态 pill。
- `LoginDialog.vue`：只保留标题 + “使用钉钉登录”。
- `VoteView.vue`：`loginConfigured` 拦截；状态栏删“登录后投票”“剩余 X 票”；
  hero 删“我的票数”。
- `IconCard.vue`：0 票不显示排名。
- `api.js`：配置接口。
- `styles.css`：配置表单/状态/窄屏样式。

## 风险

| 风险 | 应对 |
|---|---|
| AppSecret 明文落库/回显 | AES-GCM；API 脱敏；测试 grep 数据库/响应/日志 |
| 换 SESSION_SECRET 后无法解密 | 视为未配置 + 警告；管理员重填 |
| 未配置时登录 500 | 明确 302 错误码；前台 toast；测试覆盖 |
| env 与 DB 优先级混乱 | 单测覆盖 mixed/none |
| 假钉钉服务污染生产 | `DINGTALK_TEST_BASE` 仅 `NODE_ENV=test` 生效 |
| E2E 登录流程改造导致用例大改 | 保留投票/后台断言，只替换登录前段 |
| UI 清理引入布局回归 | 1440/375 截图 + E2E 无横向滚动 |

## 预计涉及文件

后端 8 个、前端 6 个、测试 5 个、E2E 2 个、文档 7 个。不改其它子项目。
