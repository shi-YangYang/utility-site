# Tech Stack — recording

> 本文件描述**已经确认并实际使用**的技术与工程约束。项目结构一旦建立并投入使用，
> 除用户明确批准架构调整外，不得擅自迁移或重命名。

## 概览

| 项 | 选择 |
|---|---|
| 语言 | JavaScript（Node.js，无 TypeScript） |
| Runtime | Node.js 20.12+（开发环境为 v22）。下限由 `.env` 读取所使用的 `process.loadEnvFile` 决定 |
| 包管理器 | npm |
| 后端框架 | 无框架，仅用 Node 内置 `http` 模块 |
| 依赖 | `busboy`（multipart 表单解析）一个运行时依赖 |
| 前端 | 原生 HTML + CSS + JavaScript，**零构建步骤**，无打包器 |
| 数据库 | 无。文件系统 + JSON 索引 |
| 媒体处理 | ffmpeg（外部可执行文件，非 npm 依赖） |
| 部署 | Docker（2026-09-15 已实际构建并验证运行） |
| 测试框架 | 无 |

## 为什么这么选

MVP 只有两个页面、四个接口。引入框架、构建工具或数据库都会让依赖和心智负担
远超收益。用 Node 内置 `http` + 静态文件服务，整个后端可以在一两个文件里读完。

选 Node 而非 Python、选原生前端而非 React 的原因记录在 `.ai/decisions/002-tech-stack.md`。

## 业务代码目录

```text
server/                    后端业务代码
├── index.js               入口。HTTP 服务、路由分发、静态文件、启动自检
├── config.js              配置读取（环境变量 + 默认值）
├── http-util.js           HTTP 小工具：响应封装、请求体读取、cookie、
│                          口令恒定时间比较
├── sanitize.js            姓名消毒与目录名生成（路径安全，纯函数）
├── transcode.js           ffmpeg 探测 / 转码 / ffprobe 读取时长
├── store.js               员工索引与录音文件的读写、原子写、写入串行化
└── routes/                接口实现（按职责拆分）
    ├── config.js          F1 公开配置
    ├── employee.js        F2 员工端口令 / F4 提交录音（multipart + 转码）
    ├── admin.js           F5–F8 管理端登录、列表、试听（Range）、下载
    └── static.js          F3 静态页面

public/                    前端静态页面
├── index.html             员工端
├── admin.html             管理端
├── app.js                 员工端逻辑（口令 → 姓名 → 录音 → 提交）
├── admin.js               管理端逻辑（登录、列表、试听、下载）
└── style.css              两个页面共用

content/passages.json      朗读稿与时长配置（纯数据）
data/                      运行时数据（gitignore，非源码）
├── index.json             员工索引
├── recordings/<目录名>/    每人的 zh.wav / en.wav / meta.json
└── tmp/                   上传与转码过程中的临时文件，启动时清空
```

> 实施 Agent 已按实际落地的文件结构更新本节的目录树。

## 关键工程约束

### 音频

- 采样格式统一为 **单声道 16-bit PCM WAV**，默认采样率 **16000 Hz**，
  由环境变量 `SAMPLE_RATE` 控制。
- 选择 16 kHz 的理由：这是语音分析的通用标准，能覆盖人声全部共振峰；
  下游若需要更高保真度，改一个环境变量即可，无需改代码。
- **前端录音必须关闭浏览器的音频后处理**：`echoCancellation`、`noiseSuppression`、
  `autoGainControl` 全部设为 `false`。默认开启的这些处理会明显改变音色，
  直接破坏样本对音色分析的价值。这是本项目的硬约束，不是可选项。
- ffmpeg 必须在服务启动时被检测到；缺失则启动失败并给出明确提示，
  不允许在转码时才报错。

### 数据存储

- 不用数据库。员工索引是 `DATA_DIR/index.json`，录音按 `DATA_DIR/recordings/<姓名>/` 分目录。
- 索引写入必须**原子**（写临时文件 + rename），并发提交必须串行化，避免索引损坏。
- 同名提交覆盖旧录音，一人只保留最新一版。
- 姓名来自用户输入，用作路径前必须消毒：剥离路径分隔符、`..`、控制字符、
  前导点，限制长度；消毒后不可用时回退到基于原始姓名的 hash 目录名。
  显示名始终以用户原始输入为准，存在索引里。

### 上传生命周期

- **必须处理客户端中断与超时。** 判据是 `req.complete === false`（而不是
  `'close'` 事件是否触发——正常收完也会触发 `'close'`）。
- 中断/超时/畸形表单三条路径必须共用同一套收尾逻辑，且**先关写流、再删文件**。
  顺序反了会让 fd 挂在已删除的 inode 上（FUSE 上表现为残留 `.fuse_hidden*`）。
- 主动 `bb.destroy()` 之前，必须给每个文件流挂 `error` 监听，
  否则 busboy 带错误 destroy 时会产生未处理事件并**直接带崩进程**。
- 时限：空闲 30 秒、请求体接收总时长 60 秒，均为 `server/routes/employee.js`
  顶部的常量（**有意不做成环境变量**，属已知的、有意留下的技术债）。
  时限**只覆盖请求体接收阶段**，收完后不再限制转码与落盘。
- 超时返回 `408`；对端已断线时不回写任何响应。
  请求体已收完再断线的，照常保存。

### 安全

- 员工端口令与管理端口令**只在服务端校验**，禁止出现在前端代码或前端可见的响应里。
- 管理端接口需鉴权；管理口令通过 `httpOnly` cookie 维持会话。
- 上传需限制单个文件大小（`MAX_UPLOAD_MB`）与总请求大小。
- 口令比较使用恒定时间比较；不得把口令写进日志。

### 前端

- 只在 secure context（`https://` 或 `http://localhost`）下麦克风可用。
  这是浏览器的硬性限制，不是本项目能绕过的，必须在文档中向使用者说明。
- 不支持任何构建步骤。新增前端文件直接以 `<script>` 引入。
- **同一时刻只允许一段处于录音状态。** 录音启动必须在 `await getUserMedia`
  之前同步置位守卫并禁用两段录音按钮（授权等待窗口内也能挡住连点与先后点两段）；
  任何新增录音入口都必须共享同一守卫。

## 命令

```bash
npm install     # 安装依赖
npm start       # 启动服务，默认 http://localhost:3000
```

**没有** `npm test`、`npm run build`、`npm run lint` —— 本项目未引入测试框架、
构建步骤或 linter。验收以「实际启动服务 + 真实调用接口 + 浏览器端到端跑通」为准，
不得假设存在这些命令。

## 部署

- 目标是 **Docker 部署 + CI/CD**（用户 2026-09-15 确认的方向）。
- `Dockerfile`、`.dockerignore`、`docker-compose.yml` 已在 Phase 1 一并写好。
  镜像内安装 ffmpeg，配置全部走环境变量，数据目录通过 volume 挂载。
- **两条运行路径，前置条件不同：**
  - **本机 `npm start`**：需要宿主装 Node 20.12+ 与 **ffmpeg**。开发调试用这条。
  - **Docker**：宿主**不需要** Node 与 ffmpeg，镜像内自带。部署 / 给别人用走这条。
- **验证状态（2026-09-15 已实际构建并验证）**：宿主机 Docker Desktop
  （4.90.0 / engine 29.7.2，macOS arm64）完成 `docker compose build` 与
  `docker compose up -d`，容器 healthy（healthcheck 打 `/api/config`）；
  镜像内 `ffmpeg 5.1.9-0+deb12u1`、Node v22.23.2。实测通过：新前端由容器正常提供、
  员工端录音与时长判定、管理端登录/列表/搜索、一次性容器 + 临时卷的完整提交与转码
  （`pcm_s16le / 16000 Hz / 单声道`）。`USER node` 与 macOS Docker Desktop
  的宿主卷属主不冲突（本机验证）。此前「沙箱无法访问 Docker」的描述只反映当时的
  Agent 环境，不再代表当前状态。
- **国内网络的已知障碍：** Docker Hub 的鉴权服务（`auth.docker.io`）常被 DNS 污染，
  导致构建在拉基础镜像阶段就超时失败。处置办法（配 registry mirror 或走本机代理）
  写在 `README.md` 的「拉不到基础镜像怎么办」一节。首次构建曾实际遇到此问题。
- **Debian 软件源可覆盖**（2026-09-16）：`Dockerfile` 用 `ARG APT_MIRROR`
  （默认上游 `deb.debian.org`），`docker-compose.yml` 透传；
  国内服务器在 `recording/.env` 设 `APT_MIRROR=mirrors.cloud.tencent.com`
  （备选 `mirrors.tuna.tsinghua.edu.cn`，实测容器内可用），
  避免 apt 装 ffmpeg 时从上游慢速下载。仓库默认值保持中立，不绑定某个云厂商。

## 待确认项（不要替用户决定）

1. ~~CI 配置放在哪里。~~ **已决定（2026-09-16）**：用户批准仓库根目录 `.github/`
   作为唯一结构例外；`ci.yml` / `cd.yml` 已就位，说明见 `deploy/README.md`。
2. **部署环境与 HTTPS。** **已定（2026-09-16）**：公司内网一台腾讯云 Ubuntu 服务器
   （无域名），访问采用内网 IP + Caddy 自签证书提供 HTTPS
   （员工端录音要求 secure context；已实测 `https://<IP>` 可正常录音）。
   服务器上的具体路径、证书信任分发（是否把 Caddy 根证书装到员工电脑）由使用者决定。
3. **正式朗读稿采信度。** 当前文稿是 Agent 生成的占位稿（覆盖常用音素与四声），
   用户尚未确认这就是最终版本。
4. **下游对音频格式的具体要求。** 当前按"16 kHz 单声道 WAV"交付，
   下游音色分析若要求其他采样率或声道，需要回改。