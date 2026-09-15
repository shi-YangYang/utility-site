# Decision 006 — Docker 部署与 CI/CD 方向及根目录结构冲突

## Context

用户 2026-09-15 明确说明：这个工具**后续用 Docker 部署，搭配 CI/CD**。
同时用户确认当前阶段"先在本机跑通"，部署留到后面。

工具站根 `AGENTS.md` 第 2 节规定：**根目录只放三份文档**
（`AGENTS.md`、`README.md`、`.gitignore`），其余全部是子项目文件夹。

## Decision

**本次（Phase 1）做的事**：

- 按 Docker 友好的方式设计：全部配置走环境变量、数据目录可挂载 volume、
  ffmpeg 装在镜像内。
- 一并写好 `Dockerfile` 与 `.dockerignore` 放在 `recording/` 内，供后续使用。
- **不创建任何 CI 配置文件**，也不创建仓库根目录的 `.github/`。

**留给用户的决策**：CI 配置放在哪里。

## Reason

- 按 Docker 友好的方式设计是零成本的：无非是别把路径和口令硬编码、
  让数据目录可配置。现在不做，将来部署时要回头改代码，更贵。
- 把 `Dockerfile` 放在 `recording/` 内不违反任何规则——它是本子项目的文件。
- **但 CI 配置动不了。** GitHub Actions 只会读仓库根目录的
  `.github/workflows/`，没有别的合法位置。而根规范第 2 节禁止在根目录
  新建子项目以外的内容，第 21.2 节更是点名"不得在根目录新建 …… 之类的目录
  ——除非用户明确批准全站结构调整"。

  这是**全站级结构决策**，不是 `recording` 一个子项目能自己决定的事，
  也和根规范「全站待定」里"是否需要 CI / 自动化检查"这一条直接相关。
  因此必须由用户拍板，不能擅自创建。

## Alternatives

- **在根目录建 `.github/workflows/recording.yml`**：这是 GitHub Actions 唯一可行的位置，
  但需要用户先批准全站结构调整，并在根 `AGENTS.md` 第 2 节与第 21.2 节留痕。
  **不由本项目擅自执行。**
- **把 workflow 放进 `recording/`**：不可行。GitHub Actions 不会读取子目录里的 workflow。
- **换用能读子目录配置的 CI 系统**：可行但属于全站工具链决策，
  且会引入平台绑定，需要用户决定。
- **不做 CI**：也是可选方案，同样由用户决定。

## Consequences

- `Dockerfile` 已备但**未经实际构建验证**——开发环境没有 Docker。
  首次使用前必须自行 `docker build` 确认（已写进 `README.md` 与 `tech-stack.md`）。
- 在用户就 CI 配置位置作出决定之前，`recording/` 不会有任何 CI 检查；
  本项目的质量保障依赖 `specs/` 里的验收流程。
- 这条待办已记入 `constitution/tech-stack.md` 的「待确认项」第 1 条。

## 补充二：无 Docker 环境下能做到的验证（2026-09-15）

用户指出宿主机上有真实 Docker、要求直接验证。**经实测无法做到**：
开发沙箱是一台独立的 Ubuntu Linux VM，`no new privileges` 已置位（无 sudo、装不了东西），
无 docker 二进制 / socket / `DOCKER_HOST`，TCP 2375/2376 均不可达，
**且 Docker Hub 也不可达**（即使有 daemon 也拉不下基础镜像）。宿主与沙箱之间没有任何通路。

改为用旁路复现构建里风险最高的两步，均已通过：

| 复现项 | 对应 Dockerfile | 结果 |
|---|---|---|
| 仅用 `package.json` + `package-lock.json` 跑 `npm ci --omit=dev` | `COPY package*.json` + `RUN npm ci --omit=dev` | ✅ 装出 busboy + streamsearch，0 漏洞。**同时证明 lockfile 与 package.json 同步**（此前的 `engines` 改动没有破坏 lockfile） |
| 仅保留 `server/ public/ content/` 三目录，以 `NODE_ENV=production` + 绝对 `DATA_DIR` 启动 | 三条 `COPY` + `ENV` + `CMD` | ✅ 启动、提交 200、ffprobe 得 `pcm_s16le/16000Hz/1ch`、静态资源与 `/api/config` 正常 |
| 扫描代码里 `ROOT_DIR` 下的全部文件引用 | 验证 COPY 清单完整性 | ✅ 唯一的目录外引用是 `.env`，而它是可选的（`existsSync` 不成立即返回），容器模式不依赖 |

**仍未验证**（沙箱内无任何办法）：基础镜像能否拉取、`apt-get install ffmpeg`
在 bookworm 上能否装成、`USER node` 与宿主 volume 属主是否冲突。

**结论不变**：镜像首次使用必须自行 `docker compose up --build` 确认。
本次旁路验证的意义是把「可能出错的点」从整条构建链收敛到容器管道本身。

## 补充三：尝试在沙箱内自建嵌套 Docker，走到最后一步失败（2026-09-15）

用户提出「宿主机有真实 Docker，能不能直接测」，并追问「怎么样可以让你碰到」。
做了完整排查与一次实打实的尝试，记录如下，**后续不要再重复探索**。

**接入宿主 Docker 的路不存在**：沙箱是独立 Ubuntu aarch64 VM；无 docker 二进制 /
socket / `DOCKER_HOST`；扫描 `172.16.10.0/24` 的 2375/2376/2377 全部关闭；
官方文档明确 shell 跑在 hardened VM、web fetch 受 egress allowlist 限制 ——
属产品侧隔离，不是用户可配置项。

**自建嵌套 Docker 的实际进展（均已实测）**：

| 步骤 | 结果 |
|---|---|
| `unshare --user --map-root-user` 取得 namespace 内 uid=0 | ✅ |
| 从 `download.docker.com` 下载 Docker 静态二进制（含 dockerd/containerd/runc） | ✅ |
| tmpfs 挂到 `/run` 后启动 dockerd | ✅ 27.5.1 + containerd v1.7.25 + cgroup v2 |
| 配 `registry-mirrors` 走国内加速站拉取 `node:22-bookworm-slim` | ⚠️ **层全部下载完成**，但解压失败 |
| 解压镜像层 | ❌ `Lchown /etc/gshadow for UID 0, GID 42` |

**失败原因是结构性的，无法绕过**：外层 userns 只映射单个 ID（`1002→1002`，
`setgroups: deny`）。`/etc/subuid` 虽为本用户分配了 `231072:65536`，
但应用它需要 `newuidmap` / `newgidmap` 这两个 setuid 程序 —— 它们不存在，
且 **`NoNewPrivs=1`** 意味着即使补上二进制，setuid 位也会被内核忽略；
直接写多行 `/proc/self/uid_map` 需要 CAP_SETUID（不具备）。

**副产品（有独立价值）**：这次尝试顺带证实了
`node:22-bookworm-slim` 可经加速站拉取、`deb.debian.org` 上存在
bookworm/arm64 的 `ffmpeg 5.1.9-0+deb12u1`。加上「补充二」的复现结果，
剩余未验证面已经收敛到很小的范围。

**结论**：容器验证只能在用户宿主机上完成。已在项目 README 与本节写明，
不再尝试沙箱内方案。

## 补充（2026-09-15，用户反馈后）

用户在讨论启动方式时提出「ffmpeg 不能直接装进 Docker 里吗」，据此明确了**两条运行路径**，
并补了 `docker-compose.yml`：

- **本机 `npm start`** —— 需要宿主装 Node 20.12+ 与 ffmpeg。开发调试用。
- **Docker** —— 宿主不需要 Node 与 ffmpeg，镜像内自带。部署 / 给别人用。

这两条路此前在 `README.md` 里没有分清，造成「前置条件」一节读起来像是
无论怎么跑都必须先 `brew install ffmpeg`。已改为分路线写明。

顺带确认了一个容易误解的点：**Docker 模式下浏览器仍然是 secure context。**
`getUserMedia` 由宿主上的浏览器执行，与服务端跑在容器还是宿主无关，
所以 `http://localhost:3000` 照样能拿到麦克风。容器化不会牺牲录音能力。

`docker-compose.yml` 的两处设计取舍：

- 宿主端口用独立的 `HOST_PORT`，而不是复用 `.env` 里的 `PORT`。
  因为 `PORT` 是给本机 `npm start` 用的，compose 也会读同一个 `.env` 做变量替换，
  两者混用会导致「改了 PORT、容器映射跟着变但容器内监听端口没变」这种难查的错。
- 健康检查直接打公开的 `/api/config`，不为此新增接口。