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
# 编辑 Caddyfile：填域名 / 路由；启用 HTTPS 需要域名解析与 80/443 可达
../scripts/deploy.sh proxy
```

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
| `ci.yml` | PR 到 `main` | 只校验本次改动到的子项目：`deploy` 做 shell/compose 校验；`recording` 做 `node --check`、compose 校验与镜像构建；不做全量重验 |
| `cd.yml` | 合并到 `main`（或手动运行） | 按改动目录 SSH 部署对应子项目；`deploy/` 变化 → `all`；纯 `.github/` 变化 → 不部署 |

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

未配置凭据时，CD 会跳过部署并在 Actions 里给出提示，不会失败。
手动补部署：Actions → CD → Run workflow → 填目标（如 `recording` / `proxy` / `all`）。

## 非目标

- 不托管业务代码，不引入子项目依赖。
- 不做多环境（staging / production）与蓝绿发布；当前是单服务器直接部署。
- 不在仓库内托管任何真实凭据。