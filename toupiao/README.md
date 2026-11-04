# toupiao — Esonitro Logo 评选投票

给公司内部选 Logo 用的投票站。员工用**钉钉扫码登录**，在 20 个候选稿中最多投 **5 个**
（可随时取消、改投）；前台实时显示排名与票数；管理员后台看投票明细、开关投票、
导出 CSV、重置投票。

- 技术栈：Vue 3 + Vite 前台，Node.js 24 后端（零运行时依赖，SQLite 存数据），单容器 Docker。
- 数据：`data/toupiao.db`（SQLite），只存在服务器本地；没有第三方统计或追踪。
- 图标：20 张候选图放在 `assets/icons/`，**不在 git 里**（见下方“图标”一节）。

## 快速开始（本地开发，mock 登录）

需要 **Node.js 24+**（后端使用 Node 内置的 `node:sqlite`，不依赖任何运行时 npm 包）。

```bash
cd toupiao
npm install
cp .env.example .env
# 编辑 .env：
#   AUTH_MODE=mock
#   ADMIN_PASSWORD=换一个至少 8 位的口令
#   SESSION_SECRET=换一个至少 32 位的随机串（可用 openssl rand -hex 32 生成）
npm run dev
```

- 前台：<http://localhost:5173/>
- 后台：<http://localhost:5173/admin>
- 后端 API：<http://localhost:3001/api/health>

mock 模式下，前台登录框会显示“开发模式”标识，输入任意姓名即可登录，用来跑通投票流程。
**mock 只允许本地开发使用，上线必须是 `AUTH_MODE=dingtalk`。**

## 配置

全部配置走环境变量；`.env.example` 是模板。真实 `.env` 已被 git 忽略。

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 后端监听端口，默认 `3001` |
| `HOST_PORT` | 否 | 仅 docker compose 使用：宿主映射端口，默认 `3001` |
| `AUTH_MODE` | 是 | `dingtalk`（线上）或 `mock`（仅本地开发） |
| `ADMIN_PASSWORD` | 是 | 后台管理口令，至少 8 位；不要使用示例值 |
| `SESSION_SECRET` | 是 | 会话签名密钥，至少 32 位随机串；换掉会让所有人重新登录 |
| `PUBLIC_BASE_URL` | dingtalk 模式必填 | 站点对外地址，如 `https://vote.example.com`，用于拼钉钉回调地址 |
| `DINGTALK_APP_KEY` | dingtalk 模式必填 | 钉钉应用 AppKey（client_id） |
| `DINGTALK_APP_SECRET` | dingtalk 模式必填 | 钉钉应用 AppSecret |
| `DINGTALK_CORP_ID` | 否 | 企业 corpId；填写后登录会限定到该企业 |
| `DATA_DIR` | 否 | SQLite 与运行数据目录，默认 `./data` |
| `ICONS_DIR` | 否 | 候选图目录，默认 `./assets/icons` |
| `COOKIE_SECURE` | 否 | `auto`（默认，按请求协议判断）/ `true` / `false` |
| `TRUST_PROXY` | 否 | 默认 `1`；反代后取 `X-Forwarded-For` 做限流。直连且不可信时设 `0` |

## 钉钉登录

1. 在[钉钉开发者后台](https://open-dev.dingtalk.com/)创建**企业内部应用**，拿到 AppKey / AppSecret。
2. 在应用的“登录与分享”里把**登录回调地址**设为：
   `https://<你的域名>/api/auth/callback`
   （必须与 `PUBLIC_BASE_URL` 拼出来的地址完全一致；钉钉通常要求已备案域名与 HTTPS。）
3. 把 AppKey / AppSecret / corpId 与 `PUBLIC_BASE_URL` 写进服务器上的 `.env`，`AUTH_MODE=dingtalk`。
4. 重启服务后，前台“钉钉登录”会跳转到钉钉授权页；回调成功后写入 HttpOnly 会话 cookie。

> 没有域名时无法完成真实钉钉回调。可先用 `AUTH_MODE=mock` 演示与验收，域名就绪后再切换。
> 详细步骤与排查见 [`docs/README.md`](./docs/README.md)。

## 投票规则

- 登录后点击图标卡片投票；每人最多 **5 个不同图标**，每个图标 **1 票**。
- 已投的卡片可以再次点击取消；取消后可投其它图标。
- 达到 5 票后，未选图标显示“已满 5 票”，需要先取消一个。
- 投票关闭后，新增与取消都会被拒绝；管理员重新开启后恢复。
- 前台公开实时排名与票数；**不公开谁投了什么**，投票人明细仅管理员可见。

## 后台

访问 `/admin`，用 `ADMIN_PASSWORD` 登录。可查看：

- 总票数、参与人数、每个图标的票数与排名、最近投票；
- 投票人明细（姓名、投了哪些图标、时间）；
- 开启/关闭投票；
- 导出 CSV（UTF-8 BOM，Excel 可直接打开）；
- 重置所有投票（需输入 `RESET` 二次确认，**不可撤销**）。

管理员会话与员工会话分离；管理员账号本身不能投票。

## 图标（重要）

20 张候选图在 `assets/icons/`，文件名格式 `NN_名称.png`（如 `01_无限连接.png`），
服务启动时按编号排序扫描。**这些图被 `.gitignore` 忽略，不在仓库里。**

- 本地开发：图片已就位，直接用。
- 部署到服务器：`git pull` 后目录里不会有图，**必须手工上传**：

  ```bash
  # 在本地执行
  scp -r toupiao/assets/icons/*.png <用户>@<服务器>:/srv/utility-site/toupiao/assets/icons/
  ```

  然后 `docker compose up -d --build`。缺图时服务不会崩，但前台会提示“尚未上传图标”，
  后台也会给出警告。

## Docker

```bash
cd toupiao
cp .env.example .env     # 填好 ADMIN_PASSWORD / SESSION_SECRET / AUTH_MODE 等
docker compose up -d --build
docker compose logs -f
```

- 容器内监听 `3001`，宿主端口由 `HOST_PORT` 控制（默认 `3001`，已登记在
  [`../deploy/ports.md`](../deploy/ports.md)）。
- 数据卷：`./data:/app/data`；图标卷：`./assets/icons:/app/assets/icons:ro`。
- 以非 root 的 `node` 用户运行；宿主 `./data` 属主建议 1000。
- 镜像为多阶段构建：Vite 构建前端 → 只把 `client/dist` 与 `server/` 放进运行镜像，
  运行阶段**没有** `node_modules`（后端零运行时依赖）。

## 部署与端口

- 应用端口：`3001`（仅本机）；对外 HTTPS 端口：`3100`（共享 Caddy）。
- 需要域名的真实钉钉登录见 `docs/README.md`；Caddy 路由示例：

  ```caddy
  https://vote.example.com {
      reverse_proxy host.docker.internal:3001
  }
  ```

- 本阶段只准备可部署单元与端口登记，服务器/域名接线稍后进行。

## 开发与测试

```bash
npm test              # node:test：鉴权、5 票上限、并发、关闭投票、CSV、重置
npm run test:e2e      # 自动构建 + 启动临时服务 + 本机 Chrome（不下载浏览器）
```

页面在 `client/src/`（Vue），接口与数据层在 `server/`，纯逻辑尽量拆成可单测函数。
测试命令以 `package.json` 与 `constitution/tech-stack.md` 为准；本项目没有 lint / typecheck 命令。

## 状态

**MVP 已完成（2026-11-04，独立验收 PASS）**，本地与 Docker 均实际验证过：

| 验证 | 结果 |
|---|---|
| `npm ci` | 通过（lockfile 可复现） |
| `npm run build` | 通过，产出 `client/dist` |
| `npm test` | **39/39 通过**（鉴权、钉钉参数/回调、5 票上限、并发 6 请求、关闭冻结、管理员限流、CSV BOM/转义/公式注入、图标扫描/缺失、畸形 JSON/Origin、SPA 回退、数据库损坏、重启持久化等） |
| `npm run test:e2e` | 通过（17 个步骤）：mock 登录 → 投 5 → 第 6 被拒 → 取消 → 改投 → 刷新保持 → 375px 两列 → 后台登录/明细 → 关闭冻结 → 重开 → 导出 CSV → 重置；截图在 `e2e/artifacts/` |
| Docker | `docker compose build` / `up -d` 成功，容器 healthy；非 root 运行；重启与 `down`/`up` 后投票、用户、开关状态都在；镜像内无图标、无 `.env`、无 `node_modules` |

已知边界：真实钉钉扫码登录需要 HTTPS 域名与钉钉应用回调配置，本阶段用 mock 模式完成端到端验收；
图标不入库仍是运维手工步骤（见上）。独立验收的非阻塞建议见
[`specs/spec-001-mvp-logo-vote/acceptance.md`](./specs/spec-001-mvp-logo-vote/acceptance.md)。
