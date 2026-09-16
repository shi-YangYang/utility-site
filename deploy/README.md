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

## 非目标

- 不托管业务代码，不引入子项目依赖。
- 不包含 CI 流水线文件：GitHub Actions 只能放仓库根 `.github/`，
  属尚未批准的全站结构变更（见根 `AGENTS.md` 待定项）。
- 当前不做自动化 CD；已定形态是「单流水线 + 按变更部署子项目」，实现待定。