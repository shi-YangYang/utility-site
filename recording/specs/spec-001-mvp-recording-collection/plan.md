# Plan — spec-001 MVP 录音收集

> 描述如何实施已确认的 Spec。本文件可随代码调研完善，但不得绕过 `spec.md` 改变需求。

## 涉及模块

全部为新增文件，位于 `recording/` 内：

- `server/` —— 后端（新增）
- `public/` —— 前端（新增）
- `content/passages.json` —— 朗读稿（新增）
- `package.json` / `package-lock.json` —— 依赖（新增）
- `Dockerfile` / `.dockerignore` —— 为后续部署预留（新增）
- `.env.example` —— 配置样例（新增）
- `data/` —— 运行时生成，已在 `.gitignore` 中忽略

不触碰 `constitution/`、`specs/`、`.ai/`、根目录文档（除全站登记那一次）以及其他子项目。

## 修改顺序

按依赖关系串行实施，不做并行（改动高度耦合）：

1. **`content/passages.json`** —— 朗读稿。无依赖，最先定稿，前端与 `/api/config` 都依赖它。
2. **`package.json` + 安装依赖** —— 只装 `busboy`。锁定版本并提交 lockfile。
3. **`server/config.js`** —— 环境变量读取与默认值。其余模块都依赖它。
4. **`server/sanitize.js`** —— 姓名消毒与 id 生成。纯函数，最容易单独验证。
5. **`server/transcode.js`** —— ffmpeg 探测、转码、ffprobe 读取时长。
6. **`server/store.js`** —— 索引读写、原子写、写入串行化、覆盖逻辑。依赖 sanitize 与 config。
7. **`server/routes/`** —— 各接口实现。依赖以上全部。
8. **`server/index.js`** —— HTTP 服务、路由分发、静态文件、启动自检。最后组装。
9. **`public/`** —— 员工端与管理端页面。依赖 `/api/config` 的响应结构。
10. **`Dockerfile` / `.dockerignore` / `.env.example`** —— 部署相关，放最后。
11. **回来更新 `constitution/tech-stack.md` 的「业务代码目录」** —— 若实际文件与此处描述不符。

后端先于前端：前端依赖已经能跑通的接口，先做后端可以让前端开发时直接对着真接口调。

## 数据流

### 员工提交

```
浏览器
  getUserMedia(EC/NS/AGC 全关) → MediaRecorder → Blob(webm 或 mp4)
        │  两段都录好
        ▼
  POST /api/submit (multipart: code, name, zh, en)
        │
        ▼
server
  1. 校验员工端口令（恒定时间比较）        失败 → 401
  2. 校验 name 非空、两个文件都在且非空    失败 → 400
  3. busboy 流式接收，边收边统计大小        超限 → 413
        │  收到临时文件（DATA_DIR/tmp/）
        ▼
  4. ffmpeg: -ac 1 -ar $SAMPLE_RATE -c:a pcm_s16le → <id>/zh.wav
     失败 → 清理临时文件 + 500
        │
        ▼
  5. ffprobe 读取时长；< minSeconds → 400 并删除已生成的文件
        │
        ▼
  6. store: 取写锁 → 读索引 → upsert(按原始姓名) → 原子写索引 → 释放锁
        │
        ▼
  7. 清理临时文件，返回 200
```

关键点：**先转码到最终位置、校验通过、再更新索引**。索引更新是最后一步，
保证索引里不会出现指向不存在文件的记录。任一环节失败都要回滚已写入的文件。

### 管理端读取

```
GET /api/admin/session      → cookie 有效否（页面决定显示登录框还是列表）
GET /api/admin/submissions  → 读索引 → 拼 audioUrl/downloadUrl → 返回
GET /api/admin/audio/:id/:segment   → 校验会话 → fs 流 + Range 支持
GET /api/admin/download/:id/:segment → 同上 + Content-Disposition
```

## 接口变化

全部为新增，无既有接口需要兼容。接口定义以 `spec.md` F1–F8 为准。

## 数据模型（实施细节）

`DATA_DIR/index.json`：

```json
{
  "version": 1,
  "employees": [
    {
      "id": "zhangsan",
      "name": "张三",
      "dir": "张三",
      "firstSubmittedAt": "2026-09-15T08:00:00.000Z",
      "updatedAt": "2026-09-15T08:05:00.000Z",
      "segments": {
        "zh": { "file": "zh.wav", "durationSec": 61.2, "bytes": 1960000, "sampleRate": 16000, "channels": 1 },
        "en": { "file": "en.wav", "durationSec": 58.4, "bytes": 1870000, "sampleRate": 16000, "channels": 1 }
      }
    }
  ]
}
```

- 以 `name`（原始姓名去首尾空白）为逻辑主键做 upsert。
- `id` 与 `dir` 由 `sanitize.js` 生成，保证不撞车、不穿越。
- `id` 对外暴露给管理端用于拼 URL；不使用姓名原文拼 URL，避免编码问题。

`DATA_DIR/recordings/<dir>/meta.json`：该员工记录的副本，便于脱离服务直接查看。

## 播放器与 Range

`/api/admin/audio/:id/:segment` 需支持 `Range`：

- 无 `Range` → `200`，`Content-Length`，`Accept-Ranges: bytes`
- 有 `Range` → `206`，`Content-Range: bytes a-b/total`，`Content-Length: b-a+1`
- 非法 Range → `416`

WAV 的 `Content-Type` 用 `audio/wav`。

## 前端实现要点

**员工端 `public/index.html` + `app.js`**

三段式状态机：`口令 → 姓名 → 录音`。每次进入下一段前，前一段的校验必须由服务端确认
（口令走 `/api/employee/access`；姓名只做非空校验，按 Spec 不校验真实性）。

录音器封装：

- `getUserMedia({ audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false } })`
- `MediaRecorder` 的 mimeType 依次尝试 `audio/webm;codecs=opus` → `audio/mp4` → 留给浏览器默认
- 计时器显示已录秒数 / 目标秒数；到达 `maxSeconds` 自动 `stop()`；低于 `minSeconds` 不允许提交
- 每段独立：录 → 试听（`<audio>` 指向 `URL.createObjectURL(blob)`）→ 重录
- 两段都有有效 Blob 后，"提交"才可用
- 提交用 `FormData`，`fetch` 带进度提示；成功后展示成功态与"重新录制"
- 错误分支：非 secure context、`getUserMedia` 被拒、`MediaRecorder` 不支持 —— 各给一条中文可读提示

**管理端 `public/admin.html` + `admin.js`**

- 先调 `/api/admin/session`；无效则显示口令输入
- 登录成功后调 `/api/admin/submissions` 渲染表格
- 每行的中文/英文单元格：时长（保留一位小数）+ `<audio controls>` + 下载链接
- 提供刷新按钮；空列表显示空状态
- 401 时自动退回登录态

**样式 `public/style.css`**：一个文件覆盖两个页面，不引入任何 CSS 框架。
设计上以清晰、朴素为主，不做动画和装饰性内容。

## 测试计划

本项目**没有测试框架**，不建 `tests/` 目录。验证方式如下，全部要实际执行：

### 后端（可在开发环境完整执行）

1. 用 ffmpeg 生成两个测试音频文件（例如 20 秒正弦/静音 wav 与 webm），作为模拟上传素材。
2. 启动服务，逐条验证 `spec.md` 的验收标准：
   - `curl` 调 `/api/config`、`/api/employee/access`、`/api/submit`、各管理端接口
   - **正向**：正确口令 + 两个文件 → `200`，`ffprobe` 复核产物为 16 kHz / 单声道 / pcm_s16le
   - **反向**：口令错 → `401` 且 `data/` 无变化；只带一段 → `400`；超大文件 → `413`
   - **路径安全**：姓名填 `../../evil`、`a/b`、`..`、含控制字符 → 复核文件落在
     `DATA_DIR/recordings/` 内，且没有在预期之外的位置产生文件
   - **覆盖**：同名提交两次 → 文件被覆盖、`firstSubmittedAt` 不变、列表仍只有一行
   - **并发**：并行发起多次提交 → 索引可被 JSON 解析且记录数正确
   - **Range**：`curl -H "Range: bytes=0-99"` → `206` 且 `Content-Range` 正确
   - **重启**：重启服务后列表数据仍完整
3. 缺 ffmpeg 的场景：用 `FFMPEG_PATH=/nonexistent` 启动 → 进程退出且提示可读

### 前端（尽可能实际执行）

在开发环境安装 Playwright + Chromium，以
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` 启动，
用合成的音频输入模拟麦克风，端到端跑：

- 员工端全流程：输口令 → 填姓名 → 录两段 → 提交 → 检查服务端确实收到合规 WAV
- 管理端全流程：登录 → 列表出现该员工 → 试听接口被调用 → 下载链接可用
- 截图留存页面实际渲染结果

若 Playwright 安装失败或 fake device 不可用，**必须如实说明这一段没有执行**，
并降级为「人工在真实浏览器里跑一遍」的建议，不得描述为已通过。

### 无法在开发环境验证的部分

- **Docker 构建**：开发环境没有 Docker。`Dockerfile` 只能静态检查，不能 build。
- **真实麦克风录音质量**：fake device 验证的是流程，不是真实录音链路。
  最终需要用户在 Mac 上用真麦克风跑一次。
- **Safari 行为**：环境里只有 Chromium，Safari 的 `audio/mp4` 分支只能靠代码审阅保证。

## 风险

| 风险 | 应对 |
|---|---|
| 浏览器默认音频处理污染音色 | 显式关闭 EC/NS/AGC；写进 Spec 与 AGENTS.md 的硬约束；转码不引入额外处理 |
| Safari 录音格式与 Chromium 不同 | mimeType 逐级回退；服务端不假设输入格式，一律交给 ffmpeg |
| ffmpeg 参数不当导致音质损失 | 输出 `pcm_s16le` 无损；`-ar` 只降采样一次；不做任何滤波 |
| 姓名用作路径导致穿越 | 独立 `sanitize.js` 纯函数 + 专门的路径安全验收项 |
| 索引并发写损坏 | 写锁串行化 + 临时文件 rename 原子替换 |
| ffmpeg 是本项目唯一的重外部依赖 | 启动自检 + 明确错误提示 + Docker 镜像内预装 |
| 大文件耗尽磁盘 | `MAX_UPLOAD_MB` 限制 + busboy 流式截断 |

## 迁移策略

无。全新项目，`DATA_DIR` 为全新目录。

## 预计涉及文件

```text
recording/
├── package.json
├── package-lock.json
├── .env.example
├── Dockerfile
├── .dockerignore
├── content/passages.json
├── server/
│   ├── index.js
│   ├── config.js
│   ├── http-util.js        ← 实施时新增：响应封装 / 请求体读取 / cookie / 口令比较
│   ├── sanitize.js
│   ├── transcode.js
│   ├── store.js
│   └── routes/
│       ├── config.js
│       ├── employee.js
│       ├── admin.js
│       └── static.js
└── public/
    ├── index.html
    ├── admin.html
    ├── app.js
    ├── admin.js
    └── style.css
```

实际拆分可在此范围内调整；若调整，实施 Agent 需同步更新 `constitution/tech-stack.md`
与本文件的文件清单。

> 实施结果：上面这份清单与实际落地的文件一致，唯一新增的是 `server/http-util.js`
> —— 把响应封装、请求体读取、cookie 解析、口令恒定时间比较这几件与业务无关的
> HTTP 琐事集中到一个文件，免得四个 routes 模块各写一遍。