# Plan — spec-001 MVP Logo 投票

> 实施路径，不改变 `spec.md` 的需求本身。关键决策已确认，可直接进入实施。

## 涉及模块与文件

### 根目录（本子项目）

| 文件 | 作用 |
|---|---|
| `package.json` | scripts、devDependencies（vue/vue-router/vite/@vitejs/plugin-vue/playwright-core） |
| `package-lock.json` | npm ci 用 |
| `.env.example` | 全部配置项与注释，默认 `AUTH_MODE=dingtalk` |
| `.gitignore` | `/data/`、`/assets/icons/*.png`、`/e2e/artifacts/` |
| `.dockerignore` | node_modules、data、图标、.env、e2e 产物 |
| `Dockerfile` | 多阶段构建；runtime 无 node_modules |
| `docker-compose.yml` | 3001、双卷、healthcheck、env_file |
| `scripts/dev.mjs` | 并行起后端与 Vite，转发 SIGINT/SIGTERM |

### 后端 `server/`

| 文件 | 内容 |
|---|---|
| `index.js` | 读配置→建库→扫描图标→listen→SIGTERM 关闭 |
| `config.js` | 解析 env、校验必填、`AUTH_MODE` 约束、`PUBLIC_BASE_URL` 推导 |
| `http.js` | JSON body（64KB 限制）、cookie 解析/设置、签名 cookie、恒定时间比较、静态文件、安全头、`sendError` |
| `db.js` | `DatabaseSync`、迁移 v1、查询/事务、reset、settings |
| `auth.js` | 会话编解码、DingTalk authorize/token/userinfo、mock 用户、鉴权函数 |
| `icons.js` | 扫描 `NN_名称.png`、白名单、文件响应 |
| `rate-limit.js` | 内存滑窗，按 IP+key |
| `state.js` | 构造 `/api/state` 与 `/api/admin/state` |
| `app.js` | 路由分发、Origin 校验、错误兜底、SPA fallback |
| `routes/public.js` | `/api/health`、`/api/state` |
| `routes/auth.js` | login/callback/mock/logout |
| `routes/votes.js` | PUT/DELETE `/api/votes/:id` |
| `routes/admin.js` | login/logout/state/voters/settings/reset/export.csv |

### 前端 `client/`

| 文件 | 内容 |
|---|---|
| `index.html` | 挂载点，中文 title |
| `vite.config.js` | Vue 插件、`root: client`、proxy `/api`、`/icons` → 3001、build outDir `dist` |
| `src/main.js` | createApp + router + 全局样式 |
| `src/router.js` | `/`、`/admin`，未知路径回 `/` |
| `src/api.js` | `request()` 统一处理 401/403/409/429/503，导出各接口 |
| `src/composables/usePolling.js` | 可见性感知轮询 |
| `src/composables/useToast.js` | 轻量提示队列 |
| `src/components/AppHeader.vue` | 标题、登录态、退出、开发模式徽标 |
| `src/components/IconCard.vue` | 图片、名称、票数、排名、投票/取消按钮、禁用态 |
| `src/components/LoginDialog.vue` | 钉钉按钮 / mock 姓名表单，错误展示 |
| `src/components/VoteSummary.vue` | x/5、剩余票数、已选缩略图、取消 |
| `src/components/Leaderboard.vue` | 实时排行前 5/全部 |
| `src/components/ToastHost.vue` | 提示 |
| `src/components/AdminLogin.vue` | 口令表单 |
| `src/components/AdminDashboard.vue` | 统计卡、图标表、投票人表、设置区 |
| `src/views/VoteView.vue` | 组合前台状态、轮询、投票动作 |
| `src/views/AdminView.vue` | 登录态判断 + 后台 |
| `src/styles.css` | 设计变量、布局、响应式 |

### 测试

| 文件 | 覆盖 |
|---|---|
| `tests/helpers.js` | 临时目录/配置、启动 app、fetch 封装、登录 helper |
| `tests/auth.test.js` | mock 登录/登出/会话篡改、dingtalk 参数与 state、未配置启动失败 |
| `tests/votes.test.js` | 5 票上限、幂等、取消、关闭、并发、图标不存在、未登录/管理员 |
| `tests/admin.test.js` | 口令/限流、state、voters、开关、重置、CSV/BOM/转义 |
| `tests/icons.test.js` | 扫描排序、重复编号、缺失目录、路径穿越 |
| `tests/http.test.js` | 畸形 JSON、超长 body、Origin 校验、安全头、SPA 回退 |
| `tests/security.test.js` | `next` 开放重定向防护、CSV 转义与公式注入防护 |
| `tests/persistence.test.js` | 重启服务后会话/投票/开关状态仍在（B6） |
| `tests/db.test.js` | WAL/foreign_keys/迁移版本、同名不同 unionId、数据库损坏与不可写路径 |
| `e2e/run.mjs` | 真浏览器：mock 登录→投 5→第 6 被拒→取消→后台开关/明细/导出/重置；截图与 CSV 写入 `e2e/artifacts/` |

## 实施顺序

1. **骨架**：`package.json`、`.gitignore`、`.env.example`、Vite 脚手架、空 server 启动。
2. **数据层**：`db.js` 迁移与查询；图片扫描 `icons.js`；`config.js` 校验。
3. **认证**：`http.js` cookie/签名 → `auth.js` mock → DingTalk OAuth2 → 会话/鉴权。
4. **投票 API**：`state.js` 聚合、`routes/votes.js` 事务、关闭开关。
5. **管理 API**：登录/限流、state/voters、settings、reset、CSV。
6. **前端前台**：状态轮询、卡片、5 票交互、登录弹窗、实时排行、响应式。
7. **前端后台**：登录、统计/明细、开关、导出、重置确认。
8. **Docker**：Dockerfile、compose、healthcheck、非 root、卷。
9. **测试**：node:test 全量 → 构建 → E2E → Docker smoke。
10. **文档回填**：README 状态、acceptance、决策（如有）、端口/CI/CD。

## 数据流

```text
浏览器 ──GET /api/state──▶ app.js ─▶ state.js ─▶ db.js（COUNT 聚合）
   ▲                                      │
   └──── 5s 轮询 / 投票后的响应 ◀──────────┘

投票点击 ──PUT/DELETE /api/votes/:id──▶ votes.js
            ├─ 会话校验（auth.js）
            ├─ 事务：BEGIN IMMEDIATE → 查票数/唯一约束 → 写 → COMMIT
            └─ 返回 state 快照（myVotes/icons/totalVotes）
```

## 数据库 schema（v1）

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  union_id TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, icon_id)
);
CREATE INDEX idx_votes_icon ON votes(icon_id);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings(key,value) VALUES ('voting_open','1');
```

- 时间统一存 UTC ISO 字符串；展示与 CSV 转服务器本地时区。
- `PRAGMA user_version = 1`。

## API 契约

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/health` | - | `{ok,uptime}` |
| GET | `/api/state` | 可选 | 前台聚合状态 |
| GET | `/api/auth/login` | - | 302 钉钉授权（mock 模式 400） |
| GET | `/api/auth/callback` | - | 钉钉回调，302 回站点 |
| POST | `/api/auth/mock` | - | mock 登录 `{name}`（仅 mock 模式） |
| POST | `/api/auth/logout` | - | 清会话 |
| PUT | `/api/votes/:iconId` | 员工 | 投票，幂等 |
| DELETE | `/api/votes/:iconId` | 员工 | 取消，幂等 |
| POST | `/api/admin/login` | - | `{password}` |
| POST | `/api/admin/logout` | 管理员 | 退出 |
| GET | `/api/admin/state` | 管理员 | 统计 + 最近投票 |
| GET | `/api/admin/voters` | 管理员 | 投票人明细 |
| PUT | `/api/admin/settings` | 管理员 | `{votingOpen}` |
| POST | `/api/admin/reset` | 管理员 | `{confirm:"RESET"}` |
| GET | `/api/admin/export.csv` | 管理员 | CSV 下载 |

错误体统一 `{ "error": "CODE", "message": "中文可读文案" }`。

## UI 要点

- 视觉基调：Esonitro 蓝（主色 `#1456f0`，深色 `#0b1f4b`，浅底 `#f5f7fb`），
  白色卡片托住白底 Logo，圆角 16px，轻阴影；标题区说明规则与剩余票数。
- 桌面：左侧/上方规则与“我的投票”，右侧候选网格（4 列）+ 实时排行侧栏（sticky）。
- 移动：单列头部、2 列网格、我的投票固定在底部（safe-area-inset-bottom）。
- 卡片：图片 `object-fit: contain` 高约 140px；编号徽标、名称、票数条、排名；
  已选蓝色描边 + 右上角勾；满 5 票时未选卡片按钮禁用并显示“满 5 票”。
- 状态：加载骨架、空图标提示、登录中、投票失败 toast、关闭横幅。
- 无障碍：卡片内真实 `<button>`、`aria-pressed`、图片 alt=`图标名称`、焦点可见、
  toast `aria-live="polite"`。

## 测试计划

1. `npm test`：全部 node:test 用例（无外部网络；DingTalk 调用用本地 mock HTTP 服务或
   依赖注入替换 `fetch`）。
2. `npm run build`：Vite 生产构建成功，无警告级错误。
3. `npm run test:e2e`：Playwright-core 启动本机 Chrome；`AUTH_MODE=mock`；
   流程见 `e2e/vote.spec.mjs`；产物截图放 `e2e/artifacts/`（gitignore）。
4. Docker：`docker compose build`、`up -d`、健康检查、mock 模式页面与 API 冒烟、
   重启后数据保留。若本机 Docker 不可用，记录为“未执行”并说明替代验证，不得写“通过”。
5. 手工核对：CSV 用 Excel/Numbers 打开、375px 视口截图、关闭状态、重置确认。

## 风险与应对

| 风险 | 应对 |
|---|---|
| 钉钉 OAuth2 参数/接口与文档不一致 | 参数集中在 `auth.js`；用本地 mock 测试 state/会话；真实凭据到位后做一次联调 |
| 无域名导致真实回调不可用 | 本期用 mock 验收；README/docs 明确域名与 HTTPS 前置条件 |
| `node:sqlite` 在镜像版本不可用 | 固定 `node:24-alpine`；启动自检打印 Node 版本；CI 用 Node 24 |
| 并发超投 | `BEGIN IMMEDIATE` 事务 + 唯一约束 + 并发测试（6 请求） |
| 图标中文名 URL 编码问题 | 服务端 `encodeURIComponent` 生成 URL；E2E 断言图片自然宽度 > 0 |
| 反向代理后 Secure cookie/Origin 判断错误 | 支持 `X-Forwarded-Proto`、`PUBLIC_BASE_URL`、开发白名单；文档写明 |
| 管理员口令过弱 | 启动校验长度；文档要求随机；限流 |
| 重置误操作 | 必须输入 `RESET`；前端二次确认；文档标注不可恢复 |

## 预计涉及文件

约 35–40 个项目文件（不含 lockfile 与图标）。不修改其它子项目；需要改的共享文件只有
根 `README.md`、根 `AGENTS.md`、`deploy/ports.md`、`.github/workflows/ci.yml`、
`.github/workflows/cd.yml`，且都属于本次新项目登记/接线的一部分。
