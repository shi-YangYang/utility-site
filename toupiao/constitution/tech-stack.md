# Tech Stack — toupiao

> 本文件描述**已经确认并实际使用**的技术与工程约束。项目结构一旦建立并投入使用，
> 除用户明确批准架构调整外，不得擅自迁移或重命名。

## 概览

| 项 | 选择 |
|---|---|
| 语言 | JavaScript（Node.js 与浏览器，均无 TypeScript） |
| Runtime | Node.js **24**（Docker 镜像 `node:24-alpine`） |
| 后端框架 | 无框架，Node 内置 `http` 模块 |
| 数据库 | SQLite，Node 内置 `node:sqlite`（`DatabaseSync`），WAL 模式 |
| 运行时 npm 依赖 | **零**（只用 Node 内置模块与全局 `fetch`） |
| 前端 | Vue 3 + Vue Router 4 + Vite 7，原生 CSS，无 UI 组件库 |
| 登录 | 钉钉 OAuth2 扫码登录；站点/AppKey/AppSecret/corpId 在管理后台配置（DB > env） |
| 会话 | HMAC-SHA256 签名的 HttpOnly cookie（员工 / 管理员两种角色） |
| 部署 | 单容器 Docker（多阶段构建），宿主端口 3001 |
| 测试 | `node:test`（接口/集成）+ Playwright-core（本机 Chrome 的 E2E） |
| 包管理器 | npm（仓库根无 workspace，本目录独立） |

## 为什么这么选

- **后端零运行时依赖**：接口只有登录、状态、投票、后台四类，Node 内置 `http` + `node:sqlite`
  足够；不引入 Express/Koa，减少供应链与升级负担。`node:sqlite` 在 Node 24 可直接使用，
  不需要 native 编译，Docker 构建简单。
- **Vue + Vite**：用户指定 Vue；Vite 是 Vue 3 的标准构建工具，构建产物是纯静态文件，
  由同一个 Node 进程托管，不需要第二个容器或 Nginx。
- **SQLite 而不是 JSON 文件**：投票需要并发下的“5 票上限”原子性、按图标聚合、
  投票人去重；SQLite 的事务与唯一索引比手写 JSON 锁更可靠，且仍是单文件、易备份。
- **轮询而不是 WebSocket**：投票规模是公司内部几十到几百人，5 秒轮询足够，
  少一个长连接层与断线重连逻辑。

## 业务代码目录

```text
server/                       后端
├── index.js                  入口：加载配置、建库、启动 HTTP、优雅退出
├── app.js                    路由表与请求分发
├── config.js                 环境变量读取与校验（仅 ADMIN_PASSWORD / SESSION_SECRET 必填）
├── db.js                     SQLite 打开、迁移、查询与事务
├── dingtalk-config.js        钉钉配置解析（DB > env）、AES-256-GCM 加解密、校验
├── auth.js                   会话签名、钉钉 OAuth2、鉴权
├── icons.js                  扫描图标目录、静态图响应
├── http.js                   JSON/cookie/静态文件/安全响应头等工具
├── rate-limit.js             登录与投票的简单内存限流
├── state.js                  聚合前台/后台状态（票数、排名、我的投票）
└── routes/
    ├── public.js             /api/health、/api/state
    ├── auth.js               /api/auth/login|callback|logout
    ├── votes.js              /api/votes/*
    └── admin.js              /api/admin/*（含 /dingtalk 配置）

client/                       Vue 前台与后台（同一个 SPA）
├── index.html
├── vite.config.js            开发代理 /api、/icons → 3001
└── src/
    ├── main.js / App.vue / router.js
    ├── api.js                fetch 封装与错误码映射
    ├── styles.css            设计变量与全局样式
    ├── composables/          轮询、提示、登录态
    ├── components/           图标卡、票数条、登录弹窗、Toast 等
    └── views/
        ├── VoteView.vue      前台投票页
        └── AdminView.vue     后台登录 + 管理台

tests/                        node:test 接口/集成测试
e2e/                          Playwright-core 端到端脚本与截图产物（gitignore）
assets/icons/                 20 张候选图（**不入库**）
data/                         运行时 SQLite（不入库）
docs/                         部署与钉钉接入手册
```

## 数据与状态

- 数据库文件：`$DATA_DIR/toupiao.db`，WAL 模式，`foreign_keys=ON`。
- 表：
  - `users(id, union_id UNIQUE, nick, avatar_url, created_at, last_login_at)`
  - `votes(id, user_id, icon_id, created_at, UNIQUE(user_id, icon_id))`
  - `settings(key PRIMARY KEY, value)`：`voting_open`（`"1"` / `"0"`）与钉钉配置键
  `dingtalk.app_key`、`dingtalk.app_secret_enc`（AES-256-GCM 密文，`v1:` 前缀）、
  `dingtalk.corp_id`、`dingtalk.public_base_url`。
- 迁移通过 `PRAGMA user_version` 顺序执行；schema 变更必须写迁移函数。
- 票数不单独存计数器，查询时 `COUNT(*)` 聚合，避免计数漂移。

## 关键工程约束

### 投票规则

- 每人最多 **5 个不同图标**；`UNIQUE(user_id, icon_id)` 保证同一图标不重复。
- 新增投票必须在事务内检查“已有票数 < 5”，不能先查后写导致并发超投。
- 同一图标重复 `PUT` 视为幂等成功，不报错、不增加票数。
- `DELETE` 不存在的票视为幂等成功。
- 投票关闭时，新增与取消都返回 `403 VOTING_CLOSED`，数据保持不变。

### 登录与安全

- 钉钉流程：`/api/auth/login` 读取当前生效配置；未配置时 302 回
  `/?auth_error=AUTH_NOT_CONFIGURED`。已配置时生成随机 `state` 写入 HttpOnly cookie →
  跳转 `https://login.dingtalk.com/oauth2/auth` → 回调校验 `state` → 用 code 换
  userAccessToken → 调 `/v1.0/contact/users/me` 取 unionId/nick/avatar → upsert 用户 →
  写会话 cookie。
- 配置解析：数据库非空值 > 环境变量 > 空；`configured = appKey && appSecret && publicBaseUrl`。
  回调地址 = `publicBaseUrl + /api/auth/callback`；每次请求读取，保存后立即生效。
- AppSecret：AES-256-GCM，12B IV，密钥由 `SESSION_SECRET` 经 HKDF 派生；格式
  `v1:base64url(iv|tag|ciphertext)`。解密失败视为未配置并警告一次；接口只返回 `hasSecret`。
- 测试专用：仅 `NODE_ENV=test` 时允许 `DINGTALK_TEST_BASE` 覆盖钉钉 endpoint，生产忽略。
- 没有 mock 登录 / `AUTH_MODE`；旧 `.env` 中的 `AUTH_MODE` 会被忽略。
- 会话 cookie：`HttpOnly; SameSite=Lax; Path=/; Max-Age=7d`；HTTPS 下加 `Secure`。
  值为 `base64url(payload).HMAC-SHA256(payload, SESSION_SECRET)`。
- 所有写操作（POST/PUT/DELETE）校验 `Origin` 与站点同源（开发环境额外允许 Vite 5173）。
- 管理口令使用恒定时间比较；登录限流（每 IP 5 分钟 10 次）。
- 口令、AppSecret、Session Secret 不得出现在日志、响应、前端 bundle 或 git 中。
- 响应头至少包含 `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`、
  `X-Frame-Options: DENY`、`Content-Security-Policy`（允许同源与 https 图片——钉钉头像在
  外部域名、内联样式，禁止内联脚本与 frame 嵌入）。
- 登录回跳 `next` 只接受站内路径（拒绝 `//`、绝对 URL、反斜杠与控制字符），防开放重定向。
- CSV 导出对以 `= + - @`、制表符或回车开头的字段前置单引号，防电子表格公式注入。

### 图标

- 目录 `ICONS_DIR`，文件名 `^(\d{2})_(.+)\.png$`，按编号排序；`id` 为两位编号。
- 只按**启动时扫描到的白名单**提供图片，禁止按请求路径直接拼文件系统路径。
- 目录缺失或为空不崩溃：服务照常启动，`/api/state` 返回空列表并带警告标记，
  后台显示明确提示。
- 图标不提交 git；Docker 以只读卷挂载。**构建镜像不 COPY 图标。**

### 前端

- 单个 SPA，路由 `/` 与 `/admin`；刷新任意前端路由由后端回退到 `index.html`。
- 未登录可以浏览图标与实时票数；点击投票时弹出只有“使用钉钉登录”的弹窗；
  `/api/state` 的 `loginConfigured=false` 时提示“登录暂未开放”，不跳转。
- 状态栏只保留投票状态 pill 与“已投 x/5”；hero 只展示总票数/参与人数；
  0 票卡片只显示“0 票”，不显示排名。
- 已选状态、满 5 票提示必须可见；达到上限时未选卡片禁用并提示先取消。
- 每 5 秒轮询 `/api/state`（页面隐藏时暂停），投票操作后用响应立即更新，避免等待。
- 移动端优先：375px 宽无横向滚动，卡片两列；桌面四到五列。
- 前台不出现任何投票人姓名或头像列表。

### 管理端

- 独立口令会话；管理员角色不可投票（投票接口返回 403）。
- 后台「钉钉登录」面板可配置站点地址/AppKey/AppSecret/corpId，回调地址只读可复制；
  AppSecret 留空表示保留，保存后立即生效。
- 重置必须请求体 `{ "confirm": "RESET" }`，只删 `votes`，保留 `users`。
- CSV 以 UTF-8 BOM 输出，列：姓名、图标编号、图标名称、投票时间（本地时区 ISO 字符串）。

## 命令

```bash
npm install          # 安装前端构建、测试依赖
npm run dev          # 后端 3001 + Vite 5173（并行）
npm run build        # vite build → client/dist
npm start            # NODE_ENV=production 起后端，托管 client/dist
npm test             # node --test tests/*.test.js
npm run test:e2e     # 构建并启动临时服务 + 本机 Chrome 跑端到端
```

**没有** lint / typecheck / format 命令；不要假设存在。验收以实际构建、接口测试、
浏览器端到端与 Docker 运行为准。

## 部署

- 单容器，多阶段：builder 里 `npm ci && npm run build`；runtime 只带 `server/` 与
  `client/dist`，以 `node` 用户运行，`EXPOSE 3001`。
- 应用端口 3001（仅本机），对外 HTTPS 3100 由共享 Caddy 提供（见 `deploy/ports.md`）。
- 卷：`./data:/app/data`、`./assets/icons:/app/assets/icons:ro`。
- 健康检查：`GET /api/health`。
- 启动只要求 `ADMIN_PASSWORD` / `SESSION_SECRET`；钉钉配置推荐在后台填写，
  `DINGTALK_*` / `PUBLIC_BASE_URL` 只是可选引导值。
- 真实钉钉登录依赖 HTTPS 域名；本阶段先准备 Docker 与端口，域名接线见 `docs/README.md`。
