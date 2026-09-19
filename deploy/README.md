# deploy —— 全站部署与运维

一台服务器上跑所有子项目的 Docker 容器。本目录是全站**共享设施**的唯一归属：
反向代理、端口分配表、部署脚本与部署约定。**不放业务代码。**

## 现状（骨架阶段）

- **已定**：单服务器；每个子项目一个容器；共享一个反向代理；
  子项目自备可部署单元（`Dockerfile`、`docker-compose.yml`、环境变量与数据卷说明）。
- **已提供**：端口分配表（[`ports.md`](./ports.md)）、部署脚本
  （[`scripts/deploy.sh`](./scripts/deploy.sh)）、反向代理 compose 与
  Caddyfile 模板（[`proxy/`](./proxy/)）。
- **待定**：服务器地址与域名、是否启用 HTTPS 与证书来源
  （见根 `AGENTS.md`「全站待定」）。模板使用占位域名，未配置前不会签发证书。

## 怎么用

完整的分步教程（Ubuntu 服务器、无域名、含全部命令）：
[`UBUNTU.md`](./UBUNTU.md)。

在服务器上的仓库根目录执行：

```bash
./deploy/scripts/deploy.sh recording    # 构建并启动 recording
./deploy/scripts/deploy.sh proxy        # 启动 / 更新反向代理
./deploy/scripts/deploy.sh all          # 部署所有带 compose 的子项目 + 代理
```

首次启用反向代理：

```bash
cd deploy/proxy
cp Caddyfile.example Caddyfile
# 无域名（当前场景）：按模板"用法 1"填服务器内网 IP；
#   default_sni 必须填，否则浏览器访问 IP 时 TLS 握手会失败（已实测）。
# 有域名：按模板"用法 2"，域名解析与 80/443 可达后自动签发证书。
../scripts/deploy.sh proxy
```

> **员工端录音必须走 HTTPS。** 浏览器只在 HTTPS（或 localhost）下给麦克风，
> 用 `http://<IP>:3000` 打开员工端会提示"不是安全上下文"、无法录音。
> 没有域名也能用 HTTPS：Caddy 的 `tls internal` 会对 IP 签发自签证书（已实测
> `isSecureContext=true` 且可正常录音）。首次访问点"继续前往"即可；
> 想消掉证书警告，把 Caddy 根证书装进员工电脑的受信任根证书：
>
> ```bash
> docker compose -f deploy/proxy/docker-compose.yml exec caddy \
>   cat /data/caddy/pki/authorities/local/root.crt
> ```
>
> 管理端不依赖麦克风，HTTP 直连 `http://<IP>:3000/admin.html` 也能用；
> 但员工入口地址应发 HTTPS 的那个。

## 约定（与根 `AGENTS.md` 5.3 一致）

- **端口先登记再使用**：新子项目上线前在 [`ports.md`](./ports.md) 登记宿主端口。
- **共享设施只在本目录改**：代理、证书、网络、备份等；子项目不得自行修改共享配置。
- **凭据不进仓库**：服务器 `.env`、证书与密钥由使用者保管，仓库只放样例与说明。
- **一个子项目一个 compose project**：容器名固定，数据落在自己的 `data/`
  或服务器指定目录。

## CI/CD

流水线文件位于仓库根 `.github/workflows/`（GitHub 唯一合法位置，
2026-09-16 用户批准的唯一根目录结构例外，见根 `AGENTS.md` 21.2）。
内容属于共享设施，改动时同步维护本文件。

| 文件 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | PR 到 `main` | 只校验本次改动到的子项目：`deploy` 做 shell/compose 校验；`recording` 做 `node --check`、compose 校验与镜像构建；`screenshot-ledger` 做 `tsc` 与 Jest 单测；不做全量重验 |
| `cd.yml` | **只在手动触发时运行**（Actions → CD → Run workflow） | 从下拉里选择目标（`recording` / `proxy` / `all`），交给 `deploy/scripts/deploy.sh` 执行；**合并到 `main` 不会自动部署**；未配置凭据时跳过并提示。**新增可部署子项目时，把项目名加进 `cd.yml` 的 `inputs.project.options`** |

**使用前需要在 GitHub 配置**（Settings → Secrets and variables → Actions）：

| 名称 | 类型 | 说明 |
|---|---|---|
| `SSH_HOST` | Secret | 服务器地址 |
| `SSH_USER` | Secret | 登录用户（需有 docker 权限） |
| `SSH_KEY` | Secret | 部署用私钥（建议单独生成，只授权这台仓库） |
| `DEPLOY_PATH` | Variable | 服务器上本仓库的绝对路径，如 `/srv/utility-site` |

**服务器准备**：

- 仓库已 clone 到 `DEPLOY_PATH`，当前分支为 `main`，且该仓库对
  `git pull` 有读权限（部署密钥 / token 由使用者配置）；
- 已安装 Docker 与 compose 插件；
- 首次部署前按 [`ports.md`](./ports.md) 确认端口未被占用。

未配置凭据时，运行 CD 会跳过部署并在 Actions 里给出提示，不会失败。
部署方式：Actions → CD → Run workflow → 选择目标（如 `recording` / `proxy` / `all`）。

## 多个子项目并存（端口区分）

一台服务器上多个子项目按**端口区分**（2026-09-16 定），完整流程见
[`ports.md`](./ports.md) 的「接入新子项目」：

| 类型 | 用户访问方式 | 接线位置 |
|---|---|---|
| 需要 HTTPS 的项目（如录音类） | `https://<IP>:<对外端口>/`（首个项目用 443） | 对外端口加进 `proxy/docker-compose.yml`，路由加进 `proxy/Caddyfile` |
| 不需要 HTTPS 的纯展示工具 | `http://<IP>:<应用端口>/` | 子项目自己的端口映射，不进代理 |

- 端口分两段：`3000–3099` 应用端口（仅本机）、`3100–3199` 对外 HTTPS 端口（Caddy）。
- 新增项目先登记 `ports.md`，再部署；应用端口不要对公网开放。

## 非目标

- 不托管业务代码，不引入子项目依赖。
- 不做多环境（staging / production）与蓝绿发布；当前是单服务器直接部署。
- 不在仓库内托管任何真实凭据。