# recording —— 录音收集（音色样本采集）

公司内部用的语音样本采集工具。员工在网页上朗读一段中文、一段英文，录音上传到服务器；
管理员在另一个网页上查看所有员工的提交情况。

这个工具只负责**收集**，不负责分析。项目名里的"分析音色"是这条流水线的下游环节，
不在本项目范围内——本项目的交付终点是：服务器上有一批规整的、按员工分好的 WAV 文件。

## 两个入口

| 入口 | 地址 | 谁用 | 做什么 |
|---|---|---|---|
| 员工端 | `http://localhost:3000/` | 公司员工 | 输口令 → 填姓名 → 录中文、英文两段 → 提交 |
| 管理端 | `http://localhost:3000/admin.html` | 管理员 | 输管理口令 → 查看所有已提交记录、试听、下载 |

员工端录音时有实时计时、目标进度与输入电平，静音会即时提醒；提交有真实进度、
可取消、失败可重试。姓名会在本机浏览器里记住（下次自动填入，存在 `localStorage`，
口令绝不保存），进入录音步后也可以返回修改姓名且不丢已录内容。

管理端支持按姓名搜索、三种排序、可关闭的自动刷新（30 秒一次，切到后台自动暂停）、
相对时间显示、"偏短"标记与一键复制员工入口地址。

## 前置条件

有两条路：**本机直接跑**（开发调试方便）和 **Docker**（部署 / 给别人用）。
两者的前置条件不一样。

### 路线一：本机直接跑（需要 Node + ffmpeg）

- **Node.js** 20.12 或更高（开发时用的是 v22）。
  20.12 是下限，因为 `.env` 的读取用了 Node 内置的 `process.loadEnvFile`；
  更低的版本不会报错，但 `.env` 会静默不生效。
- **ffmpeg**：必须能在命令行里直接调用。服务端用它把浏览器录出的音频统一转成 WAV。

  ```bash
  # macOS
  brew install ffmpeg
  # 装完确认一下
  ffmpeg -version
  ```

  服务启动时会检测 ffmpeg，缺了会直接报错退出，不会让转码在后面悄悄失败。

### 路线二：Docker（只需要 Docker）

**不需要在 Mac 上装 Node，也不需要装 ffmpeg** —— 镜像里都带好了。
直接用下面的 `docker compose up`。

## 怎么跑

```bash
cd recording
npm install
npm start
```

默认监听 `http://localhost:3000`。首次启动会自动创建数据目录。

> **注意**：浏览器只在 **secure context** 下允许调用麦克风，也就是 `https://` 或
> `http://localhost`。本机跑没问题；如果以后部署到公司内网用 IP 访问，
> 必须配 HTTPS，否则页面会直接拿不到麦克风权限。

不想装 Node 和 ffmpeg 的话，直接看下面的 [Docker](#docker) 一节。

## 配置

全部通过环境变量配置，代码里带有默认值。想在本地固定一套配置，就复制 `.env.example` 为 `.env`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `EMPLOYEE_CODE` | `123` | 员工端入门口令 |
| `ADMIN_CODE` | `admin123` | 管理端口令。**上线前务必改掉**，用默认值启动时控制台会打警告 |
| `DATA_DIR` | `./data` | 录音与索引的存放目录 |
| `SAMPLE_RATE` | `16000` | 转码后的 WAV 采样率（Hz），单声道 16-bit PCM |
| `MAX_UPLOAD_MB` | `50` | 单个音频文件的大小上限 |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 可执行文件路径 |

> `SAMPLE_RATE` 默认 16 kHz 是语音分析的通用标准（覆盖全部共振峰）。如果下游的
> 音色分析需要更高保真度，改这一个变量重启即可，不用动代码。

此外有两个**不通过环境变量配置**的上传时限，写死在 `server/routes/employee.js` 顶部：
连接空闲超过 **30 秒**、或请求体接收超过 **60 秒**，服务端会终止这次提交并回 `408`，
同时清掉临时文件。这两个值只约束"把数据传上来"这一段，之后的转码与落盘不受影响。
正常一段 60 秒录音只有几 MB，办公室网络远用不到，所以默认没有做成可配置项。

## 改朗读稿

朗读稿是纯数据，放在 [`content/passages.json`](./content/passages.json)：
改文本、改每段目标时长都在这里，**不需要动任何代码**。

## 数据存在哪

```
data/
├── index.json                      ← 员工索引，记录谁交了、什么时候交的
└── recordings/
    └── <姓名>/
        ├── zh.wav
        ├── en.wav
        └── meta.json               ← 该员工的提交元信息
```

同一个姓名重复提交会**覆盖**旧录音，一个员工只保留最新一版。

`data/` 是运行时数据，不进版本库（见本目录的 `.gitignore`）。

## Docker

`Dockerfile` 和 `docker-compose.yml` 已经备好。**镜像内已装好 ffmpeg**，
所以走 Docker 不需要在 Mac 上装 Node 或 ffmpeg。

> **验证状态（2026-09-15 已实际构建并验证）**：宿主机用 Docker Desktop
> （4.90.0 / engine 29.7.2，macOS arm64）完成 `docker compose build` 与
> `docker compose up -d`，容器 **healthy**；镜像内 `ffmpeg 5.1.9-0+deb12u1`、
> Node v22.23.2。实测通过：新前端由容器正常提供；员工端录音/停止/时长判定；
> 管理端登录、列表与搜索；一次性容器 + 临时数据卷的完整提交
> （上传 → 转码 → `pcm_s16le/16000Hz/单声道` 落盘）正常。
> 此前记录的「沙箱无法访问 Docker」只反映当时的 Agent 环境，
> 构建与运行机制、`USER node` 与 macOS 卷属主这三项现已验证；
> 仍待确认的只有 CI 配置位置与内网/HTTPS 部署（见 `constitution/tech-stack.md` 待确认项）。
> 换到新机器或用新配置首次部署时，仍建议 `docker compose up -d --build` 后再确认一次。

### 用 compose（推荐）

```bash
cd recording
docker compose up -d --build     # 构建并后台启动
docker compose logs -f           # 看日志
docker compose down              # 停止，数据保留在 ./data
```

起来之后照常访问 `http://localhost:3000/` 和 `http://localhost:3000/admin.html`。
`localhost` 依然是 secure context，麦克风照常可用 —— 浏览器录不录音跟服务端跑在
容器里还是宿主上无关。

配置从项目根目录的 `.env` 读（没有就用默认值），所以想改口令、采样率：

```bash
cp .env.example .env    # 编辑里面的 ADMIN_CODE / SAMPLE_RATE 等
docker compose up -d    # 重新起一下生效
```

想换宿主端口就用 `HOST_PORT`（容器内固定 3000）：

```bash
HOST_PORT=8080 docker compose up -d
```

### 用 docker run

不想用 compose 的话：

```bash
cd recording
docker build -t recording .
docker run -d --name recording -p 3000:3000 \
  -e EMPLOYEE_CODE=123 \
  -e ADMIN_CODE='换成你自己的口令' \
  -v "$(pwd)/data:/app/data" \
  recording
```

### 数据与属主

数据目录一定要挂 volume（compose 里已经写好 `./data:/app/data`），
否则容器重建时录音会丢。

镜像里以非 root 的 `node` 用户（uid 1000）运行，宿主上 `./data` 的属主最好也是 1000。
macOS 的 Docker Desktop 一般会自动处理，真遇到「数据目录不可写」的启动错误，
先试 `sudo chown -R 1000:1000 ./data`。

### 拉不到基础镜像怎么办（国内网络）

如果构建在 `FROM node:22-bookworm-slim` 这一步就失败，报错类似：

```
failed to fetch oauth token: Post "https://auth.docker.io/token":
dial tcp [2a03:2880:...]:443: i/o timeout
```

**这不是 Dockerfile 的问题 —— 构建还没开始**，是 Docker 连不上 Docker Hub 的鉴权服务。
国内网络下很常见（那个 IPv6 地址通常是 DNS 污染的结果）。两种解法任选一种：

**解法一：配镜像加速站。** Docker Desktop → Settings → Docker Engine，在 JSON 里加：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
```

保存后 Apply & Restart，再跑 `docker compose up --build`。
加速站时好时坏，一个不行就换下一个；也可以写多个，Docker 会依次尝试。

**解法二：让 Docker 走你本机已有的代理。** 如果你机器上已经有 Clash 之类的，
这条路更稳：Docker Desktop → Settings → Resources → Proxies →
Manual proxy configuration，填 `http://127.0.0.1:7897`（改成你自己的端口），
Apply & Restart。

> 镜像加速站只是国内网络下的权宜之计，不适合长期依赖。
> 真要往内网或生产部署，更稳的做法是在内网搭一个 registry，
> 或者在能出网的机器上 `docker save` 好镜像再导入。

### 构建在 apt 阶段失败怎么办

如果基础镜像已经拉下来了，但卡在装 ffmpeg 这一步，报错类似：

```
Err:18 http://deb.debian.org/debian bookworm/main arm64 libxfixes3 ... 502 Bad Gateway
E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?
```

这是 `deb.debian.org`（走 Fastly CDN）的偶发 502，**不是配置问题**。
ffmpeg 在 Debian 上有近 200 个依赖、要下 120MB，任何一个抖动都会让整层重来。

Dockerfile 里已经加了 `Acquire::Retries=5`，apt 会自己重试。再撞上就直接重跑
`docker compose up --build` —— 基础镜像层有缓存，会从 apt 那一步继续，不用从头来。

> 顺带一提：如果嫌慢，可以在能出网的机器上预构建这个镜像再 `docker save`/`load`
> 分发，或者给内网搭个 apt 镜像。国内直连 `deb.debian.org` 实测只有
> 400–500 kB/s，这一步通常要 4 分钟左右。

## 技术栈

Node.js + 原生 HTML/JS。后端一个轻量 HTTP 服务，前端两个静态页面，零构建步骤。
详见 [`constitution/tech-stack.md`](./constitution/tech-stack.md)。

## 本项目文档

- 本目录的规则与继承关系：[`AGENTS.md`](./AGENTS.md)
- 产品使命与方向：[`constitution/`](./constitution/)
- 需求规格：[`specs/`](./specs/)
- 关键决策：[`.ai/decisions/`](./.ai/decisions/)