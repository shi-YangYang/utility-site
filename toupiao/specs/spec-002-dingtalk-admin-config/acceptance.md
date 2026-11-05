# Acceptance — spec-002 钉钉配置后台化与 UI 整改

## Result

**PASS**（2026-11-04，独立验收）

验收范围：spec-002 全部 A1–A10、安全与配置立即生效、UI 1440/375、spec-001 高风险回归、Docker
与文档/仓库卫生。验收 Agent 未修改业务代码，仅写入本文件与 `specs/README.md` 状态行。

环境：macOS / Node **v24.20.0** / npm **11.19.0** / Docker **29.7.2** / Compose v5.5.1 /
系统 Chrome（Playwright-core `channel: chrome`，headless）。测试使用临时 DATA_DIR、临时
`.env`、临时端口与临时 Docker compose，**未读取或打印仓库 `.env`**，未提交、未改动既有容器。

## Spec Coverage

| 条目 | 结论 | 实际证据（均为本次独立执行） |
|---|---|---|
| **A1** 删除 mock/开发者模式；`POST /api/auth/mock` 404 | PASS | `server/`、`client/src/`、`client/dist`、Docker 配置中 grep `AUTH_MODE` / `/api/auth/mock` / `开发模式` / `登录后投票` / `authMode` **0 处产品入口**；实际请求 `POST /api/auth/mock` → **404 `NOT_FOUND`**；`/api/state` 无 `authMode`、有 `loginConfigured`；用临时 `.env` 写入 `AUTH_MODE=mock` 启动真实 `server/index.js`，行为不变（仍 404 / 302 / 无 authMode）。E2E 也断言 404。 |
| **A2** 未配置可启动；管理员可登录；员工点登录提示未开放，无 500 | PASS | 未配置实例：`/api/health` 200、管理员登录 200、`GET /api/admin/state` 200；`GET /api/auth/login` → **302** `/?auth_error=AUTH_NOT_CONFIGURED`（非 500），`callback` 亦然；浏览器点卡片 → toast「登录暂未开放」，未弹窗。E2E 步骤 A2 通过。 |
| **A3** 后台保存后立即生效，刷新仍已配置 | PASS | 独立 API 脚本：PUT 完整配置返回 200，**同一进程不重启**下一次 `/api/state` 即 `loginConfigured=true`，`GET /api/auth/login` 立即按新 `client_id` / `redirect_uri` / `state` / `corpId` 生成跳转；后台刷新后状态仍「已配置」。Docker 生产容器内同样实测（PUT 后 `/api/state` 立即 true、登录 302 到真实 `login.dingtalk.com`）。 |
| **A4** AppSecret 不进响应/DOM/日志/明文数据库 | PASS | PUT/GET 响应体与 JSON 字符串、`/api/state`、后台 DOM（1440/375）均不含测试 secret；服务日志 0 次；SQLite 直查 `dingtalk.app_secret_enc` = `v1:...`（89 字符），库文件与 `-wal` 中无明文 secret，`SESSION_SECRET` 未落库；Docker 容器日志/库文件同样 0 次。加密为 AES-256-GCM + HKDF，密文带版本前缀。 |
| **A5** 回调地址正确生成、可复制；错误 URL 400 | PASS | GET/PUT 返回 `callbackUrl = publicBaseUrl + /api/auth/callback`；后台只读输入框与「复制」按钮实测写入剪贴板；路径/查询/锚点/非法协议/超长/控制字符均 **400 `INVALID_DINGTALK_CONFIG`**；生产 `http://` 非 localhost **400**，`http://localhost` 允许。 |
| **A6** 假钉钉完成真实 OAuth 跳转→回调→会话→5 票 | PASS | `npm run test:e2e` **21/21 步通过**：后台配置 → 假钉钉授权 → 回调 → 登录 → 投 5 → 第 6 被拒 → 取消改投 → 刷新保持 → 375px → 后台明细 → 关闭冻结 → 重开 → CSV → 重置；并断言 authorize/token/userinfo 参数、`clientSecret`、`state`、`redirect_uri`。 |
| **A7** DB > env；清空回退；换 SESSION_SECRET 后未配置 | PASS | 独立脚本覆盖：仅 env → `source=env`；DB 覆盖 → `source=db`；清空 DB 的 appKey/corpId/base → `source=mixed` 且回退 env；直接删除 DB 密文 → `source=env`；同 DATA_DIR 换 `SESSION_SECRET` → `configured=false`、`hasSecret=false`、health 200、警告一次、登录 302 提示；重填 secret → `configured=true` 且立即生效。 |
| **A8** UI 清理与 1440/375 无横向滚动 | PASS | 独立浏览器脚本 8 项通过：未登录状态栏无「登录后投票/剩余 X 票」、hero 无「我的票数」；未配置点登录 toast「登录暂未开放」；登录弹窗仅标题 +「使用钉钉登录」（0 个 input/form/p，无 mock 表单）；满 5 票时 20 号卡片仅「0 票」、无「第 N 名」/rank 徽标；后台钉钉面板字段/状态/回调/复制可用，AppSecret 为空且 placeholder「已保存，留空不修改」，DOM 无 secret，投票开关有状态 pill；1440/375 均无页面横向滚动（表格内部滚动）。截图见下。 |
| **A9** build/test/e2e 全绿且 E2E 覆盖后台配置+登录 | PASS | `npm ci` 成功（38 packages，0 vulnerabilities，lockfile 未变）；`npm run build` 成功（Vite 7.3.7，40 modules，264ms）；`npm test` **47/47 pass，0 fail**；`npm run test:e2e` **21/21 步通过**。 |
| **A10** 文档同步；无真实密钥入库 | PASS | `toupiao/README.md`、`docs/README.md`、`AGENTS.md`、`constitution/tech-stack.md`、`.env.example`、`.ai/decisions/003` 均已说明后台配置、DB>env、AES-256-GCM、换 `SESSION_SECRET` 影响；无引导使用 mock/`AUTH_MODE`（仅说明「会被忽略」）。`git add -n toupiao` 共 41 个文件，**不含** `.env` / `data/` / `dist/` / `node_modules` / `e2e/artifacts` / 图标 PNG；仓库样例与测试仅含占位/假凭据。 |

## Tests

### 官方命令（实际执行）

| 命令 | 结果 |
|---|---|
| `npm ci` | exit 0；`added 38 packages, audited 39, 0 vulnerabilities`；`package-lock.json` 无改动 |
| `npm run build` | exit 0；Vite 7.3.7，40 modules；`dist/index.html` 0.88 kB、CSS 22.79 kB、JS 137.63 kB |
| `npm test` | **47 tests / 47 pass / 0 fail / 0 skipped**，`duration_ms 259.34` |
| `npm run test:e2e` | exit 0；**21 个步骤全部通过**；输出「✅ E2E 全部通过」；产物在 `toupiao/e2e/artifacts/`（gitignore） |
| Docker | 临时 compose：`build` 成功、容器 **healthy**、`/api/state` 200；`docker inspect` user=`node`、容器内 `uid=1000`；镜像内无 `.env`、`node_modules`、`tests`、PNG；未配置时 `loginConfigured=false`，管理员可登录；配置后立即 true 且 302 到真实钉钉；日志/DB 无 secret |

### 独立验收脚本（断言由验收 Agent 编写，仅复用 startServer/客户端脚手架）

| 脚本 | 结果 | 覆盖重点 |
|---|---|---|
| `/tmp/toupiao-acceptance-002/verify-api.mjs` | **24/24 通过** | 未配置/404/302、权限 401/403、校验反例（路径/查询/锚点/超长/控制字符/生产 http）、立即生效、响应/日志/DB 保密、留空保留密文、并发 PUT、错误 state、换 `SESSION_SECRET`、DB>env/mixed/回退 |
| `/tmp/toupiao-acceptance-002/verify-ui.mjs` | **8/8 通过** | 1440/375 状态栏、hero、0 票排名、登录弹窗、未配置 toast、后台面板/复制/placeholder/DOM、开关 pill、无横向滚动 |
| `/tmp/toupiao-acceptance-002/verify-regression.mjs` | **11/11 通过** | 并发 6 票（5 成功 + 1×409）、上限幂等、取消改投、关闭冻结、管理员限流/401/403、RESET 保留用户、CSV BOM/转义/公式注入、图标穿越 404、公开状态隐私、重启持久化（票数/关闭状态/会话） |
| 跨源写补测（inline） | 1/1 通过 | 管理员 cookie + `Origin: http://evil.example` → **403 ORIGIN_FORBIDDEN**；同源 → 200 |

补充实测：

- 真实 `server/index.js` + 临时 `.env`（含 `AUTH_MODE=mock`）：`/api/state` 无 `authMode`、mock 404、login 302；启动日志未输出模式或密钥。
- `NODE_ENV=production` 时 `DINGTALK_TEST_BASE` 被忽略（`prod_test_base=""`），`NODE_ENV=test` 时生效。
- Docker 生产容器：PUT `https://vote.example.com` → `callbackUrl` 正确、`/api/state` 立即 true、登录 Location 为 `https://login.dingtalk.com/oauth2/auth?...`；容器日志中测试 secret / ADMIN_PASSWORD / SESSION_SECRET 均 **0 次**；库中 `v1:` 密文、无明文。

### 截图（/tmp，未写仓库）

`/tmp/toupiao-acceptance-002/` 下：

- `ui-unconfigured-1440.png`、`ui-unconfigured-375.png`
- `ui-voted-1440.png`、`ui-voted-375.png`
- `ui-login-dialog-1440.png`
- `ui-admin-1440.png`、`ui-admin-375.png`

另：`toupiao/e2e/artifacts/` 含 E2E 自带截图、CSV 与 `server.log`（已被项目 `.gitignore` 忽略）。

## Issues

**阻塞问题：无。**

非阻塞问题 / 后续事项：

1. **验收后状态行待协调 Agent 更新**：`toupiao/README.md` 状态段与
   `specs/spec-002-.../spec.md` 仍写「待独立验收 / 待验收」。按本次交接的写入范围，
   验收 Agent 不得修改这两处；已按允许范围更新 `specs/README.md` 为 PASS。
   不影响功能与安全结论。
2. **真实钉钉未联调**（移交说明已声明）：无企业凭据与备案 HTTPS 域名，因此真实
   `login.dingtalk.com` 扫码/回调未执行；本次以 E2E 假 provider（仅 `NODE_ENV=test` +
   `DINGTALK_TEST_BASE` 生效）完成全链路，并独立核对了 authorize 参数与 token/userinfo
   请求。上线前仍需按 `docs/README.md` 在真实域名完成一次扫码验证。
3. 后台 375px 下图标/投票人表格使用内部横向滚动（题目允许），页面本身无横向滚动；
   回调地址输入框在窄屏内显示截断，可聚焦滚动且复制按钮可用，属展示取舍，非缺陷。

## Regression Risks

- **真实钉钉联调风险**：钉钉侧回调地址必须与后台生成的地址逐字符一致；真实域名/证书/
  备案未验证，仍存在 `redirect_uri` 不匹配或钉钉接口变更的风险。
- **`SESSION_SECRET` 轮换**：已保存 AppSecret 会无法解密（设计如此），后台显示未配置，
  需重填；若同时存在 env secret，损坏的 DB 密文会遮蔽 env secret（已文档化）。
- **env 引导值仍参与启动校验**：非法 `PUBLIC_BASE_URL` 等仍会阻止启动；这是既有 config
  行为，不影响 DB>env 的生效顺序，但运维改 `.env` 时需保持合法。
- **测试夹具差异**：大部分 node:test 使用 6 图标夹具，E2E/独立 UI 使用 20 张真实候选图；
  20 图标布局与排名已在 E2E/UI 实测覆盖，不构成产品风险。
- **根级文档**：根 `README.md` / 根 `AGENTS.md` 的 toupiao 行仍写「MVP 已完成（真实钉钉
  待域名）」，对当前状态仍成立，本次未改（不属 spec-002 范围）。

## Required Rework

**无（PASS）。**

建议协调 Agent 收尾（非返工）：

1. 将 `toupiao/README.md` 状态段与 `spec.md` 状态行更新为「spec-002 已验收 PASS」；
2. 在具备 HTTPS 域名与钉钉应用凭据后，补一次真实扫码登录验收（记录到后续验收/运维文档）。
