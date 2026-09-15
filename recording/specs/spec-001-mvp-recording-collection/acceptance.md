# Acceptance — spec-001 MVP 录音收集

> 本文件记录两轮验收。
> **第一轮**由独立验收 Agent 完成，结论 FAIL。
> **第二轮**为返工后的复验，**由协调 Agent 自行执行**（用户选择跳过独立 Agent 以节省时间），
> 详见下方「关于第二轮验收的独立性说明」。此说明不可省略——不独立就是不独立，不能记为独立验收。

## Result

**PASS**（第二轮，返工后复验）

第一轮判 FAIL 的阻塞项已修复并复验通过；`spec.md` 的 22 条验收标准与全部边界条件均满足。
未验证项已在下文显式列出。

---

## 关于第二轮验收的独立性说明

根 `AGENTS.md` 第 9 节要求「不得伪造独立 Agent 验收」。因此必须写明：

**第二轮复验不是独立验收。** 执行者是协调 Agent 本人，不是独立于实施者的第三方 Agent。
第一轮的独立验收 Agent 已完成其职责并产出了完整的 FAIL 报告；第二轮本应再派一个全新的独立
验收 Agent，但用户为控制时间成本选择让协调 Agent 快速复验。

这不影响「问题确实被修好了」这一事实判断（证据见下，全部为实跑数字），
但影响的是**保证强度**：复验覆盖的是返工点与既有行为回归，
没有重跑第一轮那样的全量前端端到端（Playwright）验证。

第一轮的全量前端验证结论（员工端/管理端全流程、EC/NS/AGC 取证、四个错误分支）
是在**返工之前**的代码上做的。返工只改动了 `server/routes/employee.js`，
未触碰 `public/`，但严格地说，**返工后的前端没有在浏览器里重跑过**。

## Spec Coverage

### 验收标准（22 条）

第一轮：**22 / 22 通过**，逐条证据见本节末尾的历史记录。
第二轮：抽查复验了其中与返工风险相关的部分，全部通过（见 `Tests`）。

### 边界条件

| 边界条件 | 第一轮 | 第二轮复验 |
|---|---|---|
| 姓名不可信 → 消毒，不可用时回退 hash | ✅ | ✅ 复验 |
| 消毒后撞车 → 追加短 hash | ✅ | — 未复验 |
| 空录音/过短 → 400 | ✅ | — 未复验 |
| 超长录音 → 前端自动停止 | ✅ | — 未复验 |
| **上传中断 → 不得留下半截文件或索引记录** | ❌ **不满足** | ✅ **已修复，复验通过** |
| 同名并发 → 不损坏索引 | ✅ | — 未复验 |
| `DATA_DIR` 不可写 → 启动即报错退出 | ✅ | — 未复验 |
| 音频其实是别的东西 → 转码失败不落盘 | ✅ | ✅ 复验 |
| 浏览器不支持 MediaRecorder / 拿不到麦克风 → 可读提示 | ✅ | — 未复验 |

---

## 第一轮（独立验收 Agent）记录

**结论 FAIL。** 22 条验收标准全部通过，但边界条件中「上传中断」一条明确不满足：

> 客户端上传途中断开后，服务端**永久**（观察 65 秒以上不回收）留下
> `DATA_DIR/tmp/upload-*.bin` 半截文件，且进程一直持有该文件的写 fd 不关闭。
> 每次中断泄漏 1 个文件 + 1 个 fd，只有重启服务才清。

| 观察时刻 | tmp/ 半截文件数 | 进程持有的 upload 写 fd |
|---|---|---|
| 中断后立即 | 1 | 1 |
| 5 秒后 | 1 | 1 |
| 20 秒后 | 1 | 1 |
| 65 秒后 | 1 | 1 |

机理：`req.pipe(bb)` 之后没有任何地方监听 `req` 的中断，客户端断开时 busboy 不保证
emit `'close'`，导致 `await parserFinished` 永不 resolve、`cleanupUploads()` 从不执行、
`startSpilling()` 建出的写流始终不 close。

第一轮另发现两条非阻塞项：子项目未登记进根 `README.md` / 根 `AGENTS.md`（见下）、
根 `.gitignore` 末行缺尾换行（已修）。

第一轮同时完成了**返工前**的全量前端端到端验证（Playwright + Chromium +
`--use-fake-device-for-media-stream`），结论摘要：

- 员工端全流程跑通（错口令被拒 → 录音 → 试听 → 重录 → 两段齐全才可提交 → 成功态）
- 管理端全流程跑通（登录 → 列表 → 试听 Range 206 → 下载 attachment）
- **录音约束有双层实证**：3 次 `getUserMedia` 实参的 EC/NS/AGC 均为 `false`，
  且 `track.getSettings()` 的**实际生效值**也为 `false`
- 四个错误分支均给出中文可读提示（`NotAllowedError` / `NotFoundError` /
  `MediaRecorder` 缺失 / 非 secure context）
- 截图：`accept-employee-recording.png`、`accept-employee-success.png`、
  `accept-admin-list.png`、`accept-employee-error.png`、`accept-employee-tooshort.png`

## 返工记录

见同目录 `rework.md`。返工只改动了一个文件：`server/routes/employee.js`。
改动要点已回写进 `constitution/tech-stack.md` 的「上传生命周期」一节。

返工还额外发现并修复了一条**同类**残留路径（第一轮未测到）：
畸形表单（`Content-Length` 完整、multipart 被截断）虽然正常返回 400，
但原来的清理顺序是「先 unlink 再关流」，导致 fd 挂在已删除的 inode 上
（FUSE 挂载目录上表现为残留 `.fuse_hidden*` 文件 + 1 个悬空写 fd）。

## Tests

### 第二轮复验（协调 Agent，实跑）

环境：Node v22.23.2 / ffmpeg 4.4.2；服务以 `PORT=3111` 真实启动；
测试素材用 ffmpeg 现造（20s opus/webm、20s aac/m4a、60MB 随机数据、纯文本假音频）。

**A. 返工点：中断泄漏**

```
基线        : tmp文件=0  fd总数=19  upload写fd=0
10 次中断后 : tmp文件=0  fd总数=19  upload写fd=0
服务端日志  : 10 行「上传未完成（client-abort），临时文件已清理」
```

连续 10 次 `curl --limit-rate 50k -m 1`（真实触发落盘）后，
`tmp/` 无残留、无 upload 写 fd 残留、fd 总数回到基线。**通过。**

**B. 超时路径**

裸 socket 发一半 multipart 后静默，实测：

```
基线      t=0.0s   tmp=0  fd=19
上传中    t=3.0s   tmp=0  fd=20
收到响应  t=30.0s  HTTP/1.1 408 Request Timeout
响应体              {"ok":false,"error":"上传超时，已终止这次提交，请重新提交"}
连接关闭  t=36.1s
再等 5 秒 t=40.0s  tmp=0  fd=19
服务端日志：上传未完成（idle-timeout），临时文件已清理
```

空闲超时按时触发（30 秒）、返回 408、资源回收、fd 回到基线。**通过。**

**C. 既有行为不回退**

| 路径 | 结果 |
|---|---|
| 正常提交（webm + m4a） → 200；`ffprobe` 复核产物为 `pcm_s16le,16000,1` | ✅ |
| 口令错误 → 401，且数据目录 `find -printf '%p %s' \| md5sum` 前后一致 | ✅ |
| 只带一段 → 400 | ✅ |
| 60MB 超大文件 → 413 | ✅ |
| 假音频 → 500，且未落盘 | ✅ |

**D. 路径安全与其余关键项**

| 项 | 结果 |
|---|---|
| 姓名 `../../evil` / `a/b` / `..` / `.hidden` → `data/` 下无 `recordings/` 之外的产物 | ✅ |
| `/tmp/evil`、项目目录、仓库根均未产生穿越文件 | ✅ |
| `/api/config` 返回文稿且不含 `123` / `admin123` | ✅ |
| 未登录 `/api/admin/submissions` → 401 | ✅ |
| 登录后列表 200，记录数与磁盘一致 | ✅ |
| `Range: bytes=0-99` → 206，实收恰好 100 字节 | ✅ |
| 下载 → `attachment` | ✅ |
| `/../server/index.js`、`/package.json`、`/content/passages.json` → 均 404 | ✅ |
| 根目录仍只有 `AGENTS.md` / `README.md` / `.gitignore` / `recording/`，无 `.github/` | ✅ |
| 运行时依赖仍只有 `busboy` | ✅ |

复验脚本：`outputs/verify-fix.sh`、`outputs/verify-timeout.js`。
测试结束后 `recording/data/` 已删除，无残留服务进程。

### 未验证项（两轮累计）

1. **返工后的前端未在浏览器里重跑。** 返工未触碰 `public/`，但严格说这是未验证项。
   第一轮的前端结论是在返工前的代码上取得的。
2. **Docker 构建。** 开发环境无 Docker，`Dockerfile` / `.dockerignore` 仅经静态阅读，
   镜像未经构建验证。
3. **真实麦克风录音质量。** 只有 fake device，验证的是链路而非真实采集音质。
   最终需要用户在 Mac 上用真麦克风跑一次。
4. **Safari 的 `audio/mp4` 分支。** 环境只有 Chromium，仅靠代码审阅保证。
5. **音色分析。** 明确不在本项目范围。

---

## Issues

### 第二轮复验未发现新问题。

第一轮的三条问题处置情况：

| # | 严重度 | 问题 | 处置 |
|---|---|---|---|
| 1 | 严重/阻塞 | 上传中断导致半截文件 + fd 永久泄漏 | **已修复并复验通过**（见 Tests A/B） |
| 2 | 中 | 子项目未登记进根 `README.md` / 根 `AGENTS.md` | **已补登** |
| 3 | 低 | 根 `.gitignore` 末行缺尾换行 | **已修** |

## Regression Risks

1. **上传路径仍是本项目最大的回归面。** 清理逻辑现在统一收口到一处，
   但涉及「正常提交 / 口令错 / 转码失败 / 超限 / 中断 / 超时 / 畸形表单」七条路径，
   后续改动此处需重跑本文件的 Tests A–C。
2. **两个超时时长是硬编码常量**（空闲 30s / 总计 60s），不是配置项。
   若将来把 `MAX_UPLOAD_MB` 调得很大、又在慢速链路上使用，会被 60 秒上限掐掉。
   这是有意的技术债，见 `constitution/tech-stack.md` 的「上传生命周期」一节。
3. **前端录制时长用 `Date.now()` 差值判定**，与 `MediaRecorder` 产物的实际时长可能不一致。
   真实设备丢帧时，可能出现「前端认为够长、服务端 ffprobe 判定过短」而提交被 400
   （有中文原因提示，可恢复，但算一次失败提交）。
4. **`index.json` / `meta.json` 的 `dir` 字段是路径信任边界。** 现有实现有
   `isSafeSegment` + `isInsideDir` 双重校验，后续改动不要移除。
5. **会话只存内存**，服务重启后管理员需重新登录。已知取舍，非缺陷。

## Required Rework

无。

> 提醒：第二轮为协调 Agent 自验而非独立验收。若后续需要一次真正的独立复验
> （尤其是返工后的前端端到端），应另派独立 Agent 执行。