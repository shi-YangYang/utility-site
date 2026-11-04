# toupiao — Esonitro Logo 评选投票

给公司内部选 Logo 用的投票站。员工用**钉钉扫码登录**，在 31 个候选稿中最多投 **5 个**
（可随时取消、改投）；前台实时显示排名与票数；管理员后台看投票明细、上传候选图、
开关投票、导出 CSV、重置投票。

- 技术栈：Vue 3 + Vite 前台，Node.js 24 后端（零运行时依赖，SQLite 存数据），单容器 Docker。
- 登录：只有钉钉扫码 OAuth2。站点地址、AppKey、AppSecret、corpId 都在管理后台配置，
  保存后立即生效，无需重启服务。
- 数据：`data/toupiao.db`（SQLite），只存在服务器本地；没有第三方统计或追踪。
- 图标：31 张候选图放在 `assets/icons/`，**不在 git 里**；管理员可在后台上传 PNG，
  上传后立即出现在前台（见下方“图标”一节）。

## 快速开始（本地开发）

需要 **Node.js 24+**（后端使用 Node 内置的 `node:sqlite`，不依赖任何运行时 npm 包）。

```bash
cd toupiao
npm install
cp .env.example .env
# 编辑 .env：
#   ADMIN_PASSWORD=换一个至少 8 位的口令
#   SESSION_SECRET=换一个至少 32 位的随机串（可用 openssl rand -hex 32 生成）
#   钉钉配置可以先留空，启动后在管理后台填写
npm run dev
```

- 前台：<http://localhost:5173/>
- 后台：<http://localhost:5173/admin>
- 后端 API：<http://localhost:3001/api/health>

首次使用时：

1. 用 `ADMIN_PASSWORD` 登录 `/admin`。
2. 在「钉钉登录」面板填写站点地址（如 `https://vote.example.com`）、AppKey、AppSecret、
   corpId（可选），保存。
3. 复制面板里的回调地址，填到钉钉应用的“登录回调地址”。
4. 回到前台点「使用钉钉登录」。

未配置钉钉时服务照常启动：员工点登录会提示「登录暂未开放」，管理员仍可登录后台完成配置。

## 配置

启动只需要 `ADMIN_PASSWORD` 与 `SESSION_SECRET`。钉钉配置优先从数据库读取，环境变量只是
首次部署的可选引导值。`.env.example` 是模板；真实 `.env` 已被 git 忽略。

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 后端监听端口，默认 `3001` |
| `HOST_PORT` | 否 | 仅 docker compose 使用：宿主映射端口，默认 `3001` |
| `ADMIN_PASSWORD` | 是 | 后台管理口令，至少 8 位；不要使用示例值 |
| `SESSION_SECRET` | 是 | 会话签名密钥，至少 32 位随机串；也用于派生 AppSecret 加密密钥 |
| `PUBLIC_BASE_URL` | 否 | 站点对外地址的引导值；后台「钉钉登录」面板保存的值优先 |
| `DINGTALK_APP_KEY` | 否 | 钉钉应用 AppKey 的引导值；推荐在后台填写 |
| `DINGTALK_APP_SECRET` | 否 | 钉钉应用 AppSecret 的引导值；推荐在后台填写 |
| `DINGTALK_CORP_ID` | 否 | 企业 corpId 的引导值；填写后登录限定到该企业 |
| `DATA_DIR` | 否 | SQLite 与运行数据目录，默认 `./data` |
| `ICONS_DIR` | 否 | 候选图目录（需可写，后台上传写入这里），默认 `./assets/icons` |
| `COOKIE_SECURE` | 否 | `auto`（默认，按请求协议判断）/ `true` / `false` |
| `TRUST_PROXY` | 否 | 默认 `1`；反代后取 `X-Forwarded-For` 做限流。直连且不可信时设 `0` |

说明：

- 数据库里的非空值优先于环境变量；后台把 AppKey/corpId/站点地址留空保存时，会删除数据库值并回退到环境变量；AppSecret 留空表示保留原密文。
- AppSecret 使用 AES-256-GCM 加密后写入 `settings` 表，管理接口只返回 `hasSecret`，不返回明文或密文。
- **更换 `SESSION_SECRET` 后，已保存的 AppSecret 无法解密**：后台会显示未配置，重新填写即可。
- 管理员口令、会话 cookie、限流、CSV、重置行为与之前一致。
- 旧 `.env` 中的 `AUTH_MODE` 会被忽略；登录方式固定为钉钉扫码，无需迁移数据。

## 钉钉登录

1. 在[钉钉开发者后台](https://open-dev.dingtalk.com/)创建**企业内部应用**，拿到 AppKey / AppSecret。
2. 在应用的“登录与分享”里配置**登录回调地址**：
   `https://<你的域名>/api/auth/callback`
   （后台「钉钉登录」面板会根据站点地址生成这个地址，可直接复制；钉钉通常要求已备案域名与 HTTPS。）
3. 用管理员登录本站后台，在「钉钉登录」面板填写站点地址、AppKey、AppSecret、corpId，保存。
4. 前台“使用钉钉登录”会跳转到钉钉授权页；回调成功后写入 HttpOnly 会话 cookie。

> 没有域名时无法完成真实钉钉回调。此时可以先启动服务、登录后台、浏览与配置，
> 但员工登录会提示“登录暂未开放”；域名就绪后再保存配置即可。
> 详细步骤与排查见 [`docs/README.md`](./docs/README.md)。

## 投票规则

- 登录后点击图标卡片投票；每人最多 **5 个不同图标**，每个图标 **1 票**。
- 已投的卡片可以再次点击取消；取消后可投其它图标。
- 达到 5 票后，未选图标显示“已满 5 票”，需要先取消一个。
- 投票关闭后，新增与取消都会被拒绝；管理员重新开启后恢复。
- 前台公开实时排名与票数；**不公开谁投了什么**，投票人明细仅管理员可见。
- 0 票的候选只显示“0 票”，不显示排名。

## 后台

访问 `/admin`，用 `ADMIN_PASSWORD` 登录。可查看/操作：

- 钉钉登录配置（站点地址、AppKey、AppSecret、corpId、回调地址复制）；
- 上传候选图标（多选 PNG、逐张上传、单张 ≤ 5 MB，上传后立即生效）；
- 总票数、参与人数、每个图标的票数与排名、最近投票；
- 投票人明细（姓名、投了哪些图标、时间）；
- 开启/关闭投票；
- 导出 CSV（UTF-8 BOM，Excel 可直接打开）；
- 重置所有投票（需输入 `RESET` 二次确认，**不可撤销**）。

管理员会话与员工会话分离；管理员账号本身不能投票。

## 图标（重要）

31 张候选图在 `assets/icons/`，文件名格式 `NN_名称.png`（如 `01_无限连接.png`，编号 01–99），
服务启动时按编号排序扫描。**这些图被 `.gitignore` 忽略，不在仓库里。**

**后台直接上传**（推荐日常使用）：

1. 管理员登录 `/admin` →「上传图标」；
2. 选择一张或多张 PNG（单张 ≤ 5 MB），点「开始上传」；
3. 每张显示等待/上传中/成功（新编号与名称）或失败原因；成功后图标表与前台立即刷新，
   不需要重启服务。

服务端会校验管理员权限、PNG 结构与大小、文件名与 99 张上限；上传内容只写入
`ICONS_DIR`（默认 `assets/icons/`），不写入数据库。上传同名文件会分配新编号。

- 本地开发：图片已就位，直接用。
- 部署到服务器：`git pull` 后目录里不会有图，可以手工上传：

  ```bash
  # 在本地执行
  scp -r toupiao/assets/icons/*.png <用户>@<服务器>:/srv/utility-site/toupiao/assets/icons/
  sudo chown -R 1000:1000 /srv/utility-site/toupiao/assets/icons
  ```

  也可以先启动容器，再由管理员在后台逐张/批量上传（目录需对容器内 uid 1000 可写）。
  缺图时服务不会崩，但前台会提示“尚未上传图标”，后台也会给出警告。

## Docker

```bash
cd toupiao
cp .env.example .env     # 至少填 ADMIN_PASSWORD / SESSION_SECRET；钉钉配置可稍后在后台填
docker compose up -d --build
docker compose logs -f
```

- 容器内监听 `3001`，宿主端口由 `HOST_PORT` 控制（默认 `3001`，已登记在
  [`../deploy/ports.md`](../deploy/ports.md)）。生产环境建议设
  `BIND_HOST=172.17.0.1`，让 `3001` 只被 Docker 网关/Caddy 访问，不对公网暴露。
- 数据卷：`./data:/app/data`；图标卷：`./assets/icons:/app/assets/icons`（**可写**，供后台上传）。
- 以非 root 的 `node` 用户运行（uid 1000）；宿主 `./data` 与 `./assets/icons` 都需可写：

  ```bash
  sudo chown -R 1000:1000 data assets/icons
  ```

  目录不可写时，后台上传会返回 500 并提示检查 `ICONS_DIR` 权限。
- 镜像为多阶段构建：Vite 构建前端 → 只把 `client/dist` 与 `server/` 放进运行镜像，
  运行阶段**没有** `node_modules`（后端零运行时依赖）。
- 未配置钉钉时容器仍能 healthy；启动后用管理员登录后台配置即可。

## 部署与端口

- 应用端口：`3001`（仅本机）；对外 HTTPS 端口：`3100`（共享 Caddy）。
- 需要域名的真实钉钉登录见 `docs/README.md`；Caddy 路由示例：

  ```caddy
  https://vote.example.com {
      reverse_proxy host.docker.internal:3001
  }
  ```

- 后台保存的站点地址必须是对外 HTTPS 地址（本地 `localhost` / `127.0.0.1` 允许 http 调试）。
- 本阶段只准备可部署单元与端口登记，服务器/域名接线稍后进行。

## 开发与测试

```bash
npm test              # node:test：鉴权、钉钉配置、图标上传校验/并发、5 票上限、关闭投票、CSV、重置
npm run build         # 构建 client/dist
npm run test:e2e      # 自动构建 + 启动临时服务 + 假钉钉服务 + 本机 Chrome（不下载浏览器）
```

页面在 `client/src/`（Vue），接口与数据层在 `server/`，纯逻辑尽量拆成可单测函数。
E2E 使用本地假钉钉服务（`e2e/fake-dingtalk.mjs`）完成真实 OAuth 跳转/回调，不需要真实
AppKey/AppSecret 或域名；该服务只在 `NODE_ENV=test` + `DINGTALK_TEST_BASE` 下被应用使用。
测试命令以 `package.json` 与 `constitution/tech-stack.md` 为准；本项目没有 lint / typecheck 命令。

## 状态

**MVP 已完成（2026-11-04，独立验收 PASS）**；**spec-002 钉钉配置后台化与 UI 整改已验收 PASS
（2026-11-04，独立验收）**；**spec-003 后台上传图标已验收 PASS（2026-11-04，独立验收）**。
本地与 Docker 均已实际验证：

| 验证 | 结果 |
|---|---|
| `npm run build` | 通过，产出 `client/dist` |
| `npm test` | **58/58 通过**（在原有 47 项上新增 11 项上传用例：权限 401/403、PNG 结构/只有签名/截断/空文件/错误 Content-Type、5 MB 边界与超限、文件名清洗与路径穿越、最小空位、并发不撞号、99 上限、目录自动创建、reload 重扫、state 立即生效、上传不影响已有投票、关闭投票时仍可上传） |
| `npm run test:e2e` | 通过（23 个步骤）：临时复制 31 张图标 → 后台上传 1 张 → 图标数 31→32、前台免重启出现且 0 票 → 非 PNG 错误提示 → 钉钉授权/登录 → 投 5 → 第 6 被拒 → 取消改投 → 刷新保持 → 375px → 后台明细 → 关闭冻结 → 重开 → CSV → 重置；含 secret 不落 DOM/日志/明文数据库的检查 |
| Docker | 临时 compose 实测：`/app/assets/icons` 以 `rw=true` 绑定挂载，容器内 uid 1000 非 root；匿名上传 401，管理员上传 200，宿主目录出现 `32_后台上传.png`，`/api/state` 立即返回 32 个图标且新图 0 票；镜像内仍无图标、无 `.env`、无 `node_modules` |

已知边界：真实钉钉扫码登录需要 HTTPS 域名与钉钉应用回调配置；图标仍不入库，新机器可先手工
上传 31 张，或启动后由管理员在后台逐张上传。验收记录见 [`specs/`](./specs/)。
