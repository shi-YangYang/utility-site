# Acceptance — spec-002 界面与流程优化

> 本文件由**独立验收 Agent**（未参与本 spec 实现的子 Agent）编写。
> 环境、素材与截图目录沿用实施阶段提供的可复用资产；
> 除**复用运行**了实施者的 `test-silence-storage.mjs`（下文注明）外，
> 其余结论均来自本 Agent 自行编写并实际执行的脚本（存放于验收工作目录
> `/var/folders/36/.../opencode/recording-test/acceptance/`，未写入项目仓库）。
> 本 Agent 未修改任何业务代码；唯一写入的项目文件是本文件。

---

## 第二轮（返工后）独立复验 — 2026-09-15

> 本轮由**另一名独立验收 Agent**执行（与第一轮验收 Agent、实施者均非同一会话）。
> 返工只改了 `recording/public/app.js`（sha256 `9236d106…`，mtime 21:13:17，验收期间未再变动；
> 改动点为 `state.starting` / `segment.pending` / `startRecording` 同步守卫与 await 后复校验 /
> `updateUI` 的 pending 分支与禁用条件 / `canSubmit` / `resetSegments`）。
> 本轮**不复用第一轮结论**：E7 全部重测，其余按根规范 10.1 做关键回归抽查与范围核对。
> 本 Agent 未修改任何业务代码，未改动 `server/`、`content/`、`constitution/`；唯一写入的项目文件是本文件。

### 第二轮 Result

**PASS**

第一轮唯一阻塞项 E7 已修复：竞态复验 **25/25 PASS**，关键回归 **16/16 PASS**，
`resetSegments` 定向小验证 **5/5 PASS**。第一轮其余结论（E1–E6、E8、E9、管理端 A1–A5、U1–U4）
对未受返工触及的代码继续有效；返工触及路径已定向复核，未发现回归。

### 第二轮 Spec Coverage 变化

| 项 | 第一轮 | 第二轮 | 依据 |
|---|---|---|---|
| E7 同一时刻只允许一段录音（阻塞项） | ❌ FAIL（`getUserMedia` 等待窗口） | ✅ PASS | r2-race R1–R5 |
| E7 试听不占用麦克风 | 隐含通过 | ✅ 进一步确认 | r2-regression：3 次录音恰对应 3 次 `getUserMedia`，试听期间 0 次 |
| E8 错误路径保留录音 / 重试提交 | ✅ | ✅ 复核 | r2-regression：abort → 408 → 重试成功，真实落盘 11.04s×2 |
| E6/U4 EC/NS/AGC 约束与产物 | ✅ | ✅ 复核 | 实参与 `track.getSettings()` 三路 false，`applyConstraints=0` |
| E7 两段独立重录 | ✅ | ✅ 复核 | 重录中文后英文的 `src`/状态完全不变 |
| E1/E8「重新录制并再次提交」（`resetSegments`） | ✅ | ✅ 定向复核 | r2-again 5/5 |
| 其余验收标准 | ✅（第一轮实测） | 维持（返工未触及，本轮范围核对确认） | 第一轮证据 + 本轮 `git` 范围核对 |

### 第二轮 Tests：实际执行的命令与关键数字

环境：服务器 PID 80601，`PORT=3111`，**真实阈值** `target 60 / min 10 / max 180`
（`GET /api/config` 实测），Chromium headless + fake device。
脚本为本 Agent 亲自编写，位于验收工作目录 `acceptance/r2/`（未写入仓库）。
**未采用实施者脚本作为任何结论来源。**

| 命令 | 结果 | 关键数字 |
|---|---|---|
| `node acceptance/r2/r2-race.mjs` | **25/25 PASS** | 各场景 `gum=1 streams=1 recorders=1`；停止后轨道 `[["ended"]]`、录音器 `["inactive"]` |
| `node acceptance/r2/r2-regression.mjs` | **16/16 PASS** | 3 段 ×11s 真实录制；`复验R2036293` 服务端 `durationSec` 11.04/11.04；磁盘 ffprobe 11.040000s / 353358B ×2；管理端 113 行、搜索「显示 1 / 共 113 条」 |
| `node acceptance/r2/r2-again.mjs` | **5/5 PASS** | 重置后两段清空、再录 2 段共 4 次 gUM、可提交 |

> 诚实记录：首次运行 r2-race 为 23/25、r2-regression 首次为 15/16，两处失败经排查均为
> **本 Agent 测试脚本自身缺陷**（init script 在非 secure context 的 `about:blank` 访问
> `navigator.mediaDevices`；重录时读到上一轮残留计时文本；恢复原生 `getUserMedia` 绕过探针），
> 修正探针后重跑即全通过。**产品代码未因这些失败做过任何改动。**

### 第二轮反例设计与逐条结果

1. **慢授权窗口（延迟 1.5s）+ 同段正常双击 → 只应一次 getUserMedia、一个录音器**：✅
   窗口内本段显示「准备中……」且禁用；再补 force click 与两次合成 `dispatchEvent(click)`
   （彻底绕过 disabled 语义、直击监听器守卫）→ 仍 `gum=1 streams=1 recorders=1`；
   停止后该流全部轨道 `ended`、录音器 `inactive`。
2. **窗口内先点中文、再点英文（force click 穿透 disabled）→ 只能一段录音、另一段拿不到麦克风**：✅
   英文始终「未录音」，force click + 合成点击均被守卫吞掉；最终仅中文进入录音，
   总计 1 个麦克风流（英文无流）。中文录音中再点英文 → 提示「一次只能录一段」且 `gum` 不增。
3. **无延迟、同一任务内连点两次**：✅ 合成事件连发，`gum=1 recorders=1`，停止后轨道 `ended`。
4. **等待窗口内两段按钮处于禁用/明确反馈（不是看起来空闲）**：✅ 「准备中……」+ 两段录音按钮禁用 +
   提交按钮禁用（`canSubmit` 含 `!state.starting`）。
5. **边界：慢授权窗口内刷新 / 导航离开**：✅ `pageerror=0`、console error=0；刷新后回到第 1 步。
6. **反例：授权失败（延迟 1.2s 后 reject `NotAllowedError`）**：✅ 拒绝窗口内连点不产生重复调用；
   失败后显示可读错误、状态回「未录音」、按钮回到可点的「开始录音」（**不是永久"准备中"**）；
   探针切回正常后重试成功录满一段并停止（`gum=2 streams=1`，轨道 `ended`）。
7. **正常全链路（不延迟、真实阈值）**：✅ 中文 11.0s → 试听（currentTime 前进）→ 英文 11.0s →
   只重录中文（英文 `src`/状态逐字不变）→ 断网 abort（错误就地显示、按钮变「重试提交」、录音保留）→
   伪造 408（提示超时、录音保留）→ 重试成功；服务端索引与磁盘 WAV 均 ≥10s。
8. **管理端点检**：✅ 列表 113 行渲染；搜索 `<本轮姓名>` → 「显示 1 / 共 113 条」；播放第二段时
   第一段自动暂停（`aPausedAfterB=true`）；无未捕获错误。

### 第二轮 Issues

- 无阻塞项、无中等问题。
- [仅记录] 本脚本主动注入的两次提交失败（abort / 伪 408）产生 2 条网络层 console 噪声
  （`Failed to load resource`），非未捕获 JS 错误；正常路径 console error 为 0。
- [仅记录] 第一轮的既存记录不变：<1s 录音提示语偏笼统、真实 `beforeunload` 弹窗在 headless 下不可验证。

### 第二轮 Regression Risks

1. E7 修复把「准备中」窗口显式暴露给用户：若后续改动 `updateUI` 的 pending/else 分支，
   需复跑 R1–R3，确认 `starting/pending` 一定在 `finally` 复位，否则按钮可能永久禁用。
2. await 后复校验依赖 `state.starting` 的同步置位：若将来新增其他录音入口，必须先同步置位再 await。
3. `canSubmit` 新增 `!state.starting`：若调整提交按钮条件，需回归「等待窗口内提交禁用」。
4. `resetSegments` 已复位 `pending`：改动「再次录制」流程后需复跑 r2-again。
5. 上传生命周期（`data/tmp`、fd）仍为最高风险面：本轮 0 文件 / fd 19（与基线一致），
   后续若动服务端需复跑中断清理测试。

### 第二轮 Required Rework

无。

---

## 第一轮验收记录（返工前，原文保留）

## Result — 第一轮（返工前）

**FAIL**（第一轮）

- spec.md 的 **24 条验收标准全部通过**（全部为实跑证据，逐条见 `Spec Coverage`）；
- 绝大多数边界条件通过；
- 但功能需求 **E7「同一时刻只允许一段处于录音状态」在 `getUserMedia` 的等待窗口内不成立**，
  可复现且有实际副作用（同段双击会留下常驻 `live` 的麦克风轨道；先后点两段会同时开始录音）。
  该问题在 spec-001 的代码里同样存在（不是 spec-002 引入的回归），但 E7 是本 spec 的明确要求，
  故整体判 FAIL，返工要求见 `Required Rework`。

## Spec Coverage

### 24 条验收标准

| # | 标准 | 结论 | 证据（均为实跑） |
|---|---|---|---|
| 1 | 步骤指示器高亮/完成态；改姓名返回不丢录音 | ✅ | 步骤切换焦点/高亮见 K 脚本；步骤切换不触碰录音状态（代码审查）；X1 的 401 路径（showStep→再回录音步）实测两段试听与状态保留 |
| 2 | 姓名回填；localStorage 不可用不报错 | ✅ | S4 预置 `<b>x</b>` 原样回填；复跑实施者 `test-silence-storage.mjs`：禁用 localStorage 静默降级 9/9 PASS |
| 3 | 实时计时/进度；target 正向提示；max 自动停止 | ✅ | S5：用 `page.route` 覆盖 `/api/config`（target 3 / min 2 / max 5，不改任何项目文件），进度条 min/target 两个刻度（40%/60%），到 target 提示后仍录音，到 max 自动停在第 5.0 秒并 polite 播报 |
| 4 | 电平条随声音变化；静音 3 秒提示不打断；Web Audio 不可用无报错 | ✅ | 复跑实施者静音脚本 9/9；X2 删除 `AudioContext`/`webkitAudioContext` 后电平条隐藏、录音照常开始与结束、无未捕获错误 |
| 5 | 显示时长与产物一致（≤0.5s）；不再前端够长服务端 400 | ✅ | S6：前端显示 10.2s / 10.6s（边界），服务端 **200 成功**；磁盘 ffprobe 值 10.26 / 10.68，误差 -0.06 / -0.08s |
| 6 | ≥900px 并排、窄屏单列、无横向溢出 | ✅ | K：901px→2 列，899px→1 列，390px→1 列且 `scrollWidth=390=innerWidth`；管理端 800px 表格自身滚动（accept-admin） |
| 7 | 真实百分比；取消可中止、录音保留；tmp/fd 无残留 | ✅ | S3：CDP 限速 15KB/s 下进度显示「正在上传……9%」，取消后提示可读、录音保留、按钮回到可提交；shell 连续 5 次 `curl --limit-rate 50k -m 2` 中断：`data/tmp` 0→0，服务进程 fd 19→19，`index.json` md5 不变，日志 5 行 client-abort 清理 |
| 8 | 失败（断网/500/408）后按钮变「重试提交」，重试成功落盘 | ✅ | X1：伪造 408 → 就地报错 + 「重试提交」、录音保留；随后 401 → 退回第 1 步、姓名/录音保留；重新输口令后提交 **成功落盘**；实施者另有断网（route.abort）证据 |
| 9 | 有未提交录音时离开拦截，无录音不打扰 | ✅ | S3/X2：对真实 `beforeunload` 事件派发后 `defaultPrevented`：无录音 false、有录音 true、成功后 false。**真实浏览器确认框在 headless Chromium 下无法弹出**（见「未执行」） |
| 10 | 搜索子串/大小写不敏感 + 「显示 X / 共 Y」 | ✅ | accept-admin：XSS 姓名子串命中 1 行，计数/空态正常；实现为双侧 `toLowerCase()`（代码审查） |
| 11 | 三种排序生效、中文稳定 | ✅ | X3：三种排序前 12 行与 API 期望完全一致（`localeCompare('zh-CN')` / 时间字符串倒序） |
| 12 | 自动刷新默认开启 30s；后台暂停、回前台立即刷新；开关可关 | ✅ | accept-admin：登录后按 30 秒级节奏产生下一次请求（清除 cookie 后 ≤35s 轮询命中 401）；`document.hidden` 33s 内 0 请求，恢复可见 2s 内 +1。**「关闭开关后 33s 无请求」未独立复跑**（实施者脚本覆盖 + 代码审查 `tick()` 守卫） |
| 13 | 偏短标记；`/api/config` 不可用不阻塞列表 | ✅ | accept-admin：111 条记录中 badge 数 7 = 按 API 数据计算的期望值 7；Y1：`/api/config` 返回 500 时列表照常渲染、badge 0 |
| 14 | 相对时间 + title 精确时间 | ✅ | accept-admin：文本「2 分钟前」、`title="2026/9/15 20:54:05"` 可解析、`dateTime` 与 API 一致 |
| 15 | 复制成功；剪贴板不可用降级 | ✅ | accept-admin：剪贴板读出 `http://localhost:3111/` + 「已复制」提示；X3：禁用 clipboard API 且 `execCommand=false` 时显示「复制失败，请手动复制员工入口：…」 |
| 16 | 播放互斥 | ✅ | accept-admin：播第二个时第一个自动暂停（paused true/false 实测） |
| 17 | 100 条可用，搜索响应 <200ms | ✅ | accept-admin：111 条渲染完整；搜索输入到列表更新最大 **12.1ms** |
| 18 | XSS 姓名不执行、超长不破版 | ✅ | accept-admin：`<img src=x onerror=...>` 行 `childElementCount=0`、`window.__xss` 未定义、无 img 元素；60 字姓名 1280/800px 均无页面横向溢出 |
| 19 | 键盘全流程；焦点在步骤标题；aria-live 节点 | ✅ | K：Tab 可达姓名输入/开始/停止按钮，纯键盘完成一段录音；四步标题 `tabindex=-1`；`#sr-announcer` 为 `role=status aria-live=polite`；计时器 `aria-hidden=true`（不刷屏） |
| 20 | focus-visible 可见；reduced-motion 无强动效 | ✅ | Y2：Tab 聚焦 `outline: 2px solid`；Y3：`prefers-reduced-motion` 下 transition 实测 1e-05s；实施者截图证据并存 |
| 21 | 对比度 ≥4.5:1 | ✅ | 用 WCAG 公式逐对计算 10 组（正文/次要文字/主按钮/错误/警告/成功/信息/链接），最低 4.88:1，全部通过 |
| 22 | 控制台无未捕获错误 | ✅ | 本 Agent 全部脚本（员工端/管理端/降级场景）收集到的 pageerror/console.error 均为 0（过滤网络噪声） |
| 23 | 无新增依赖；根目录结构未变 | ✅ | `git status`：改动仅 `recording/{public,README.md,specs/README.md,.ai/README.md}` + 新增 spec-002 与 decision 008；`package.json`/`content/`/`server/`/`constitution/` 未动；`git diff --stat` 与预期一致 |
| 24 | README 与 specs/README 登记 | ✅ | 已核对 diff：README 增补新能力说明；`specs/README.md` 登记 spec-002；`.ai/README.md` 登记 decision 008 |

### 边界条件

| 边界 | 结论 | 证据 |
|---|---|---|
| localStorage 禁用/抛错 → 静默降级 | ✅ | 复跑实施者脚本（来源：`test-silence-storage.mjs`）9/9 PASS |
| 剪贴板不可用 → 降级提示 | ✅ | X3 |
| AudioContext 创建失败 → 电平隐藏、无报错循环 | ✅ | X2 |
| MediaRecorder 中途报错 → 丢弃该段 | ⚠️ 仅代码审查（`onerror → discard → stopRecording`），未独立模拟 |
| 上传取消/断网/408 → 录音保留、tmp 无残留 | ✅ | S3 + X1 + shell 5 连击（fd/tmp/index 三不变） |
| 上传中刷新 → beforeunload 拦截 | ✅（合成事件） | S3；真实弹窗 headless 不支持，见「未执行」 |
| 列表 0/1/100+ 条；emoji/HTML/超长姓名 | ✅ | 111 条 + XSS + 60 字姓名实测（无 0/1 条数据，现状数据决定） |
| 轮询收到 401 → 停止轮询回登录态 | ✅ | accept-admin：清 cookie 后下一次轮询 401 → 登录态 + 「会话已过期」；随后 33s 内 0 新请求 |
| 录音步刷新 → 回第 1 步 | ⚠️ 仅代码审查（页面内存态，刷新即回到 code 步） |
| 时间字段缺失/非法 → 「—」 | ⚠️ 仅代码审查（formatTime/formatRelative 返回 '—'） |
| 前端对姓名长度无新增限制 | ⚠️ 仅代码审查（app.js 不对姓名做长度限制） |

## Tests

### 环境

- 服务：`PORT=3111`，PID 69982，Node **v24.20.0**，ffmpeg **4.4**，数据目录含 **111** 条记录；
  验收结束时 `data/tmp` 0 个文件、进程 fd 19（与基线一致）。
- 浏览器：`playwright-core` + 已下载 Chromium（headless，fake device；未使用系统 Chrome）。

### 本 Agent 独立编写的脚本（均在 `acceptance/` 下实跑）

| 脚本 | 结果 | 说明 |
|---|---|---|
| `accept-emp.mjs` | 35/40 | 失败 4 项全部是 E7 竞态（S2a×2、S2b×2）；另 1 项是**本脚本对“已录制 X 秒”文本的解析 bug**（误报 auto-stop 为 NaN），已在 `accept-race.mjs` 修正并 PASS（5.0s） |
| `accept-race.mjs` | 2/5 | R1/R2 在把 `getUserMedia` 延迟 1.5s（模拟**首次授权弹窗**）后，用正常人类节奏点击即可复现竞态；S5 修正重跑 PASS |
| `accept-admin.mjs` | 16/16 | XSS/超长/偏短标记一致性/相对时间/复制/互斥/搜索 12.1ms/401 停轮询/后台暂停/回前台刷新 |
| `accept-extra.mjs` | 14/15 | 408→401→重提成功、Web Audio 降级、三种排序、剪贴板降级；唯一失败是「真实 beforeunload 弹窗」（headless 限制，合成事件路径已通过） |
| `accept-keyboard.mjs` | 10/10 | 纯键盘流程、焦点、aria、900px 断点 |
| `accept-last.mjs` | 3/3 | `/api/config` 不可用、focus-visible 计算样式、reduced-motion 计算样式 |

### 复用运行的实施者脚本（来源：实施者的 `recording-test/` 工作目录）

- `test-silence-storage.mjs`（**实施者编写**）：本次由验收 Agent 原样重跑，**9/9 PASS**
  （静音 3 秒提示、静音不打断、localStorage 降级、姓名回填、窄屏单列）。
- `test-employee.mjs` / `test-admin-heavy.mjs` / `test-ui-visual.mjs` **未重跑**：
  其覆盖点已由上述独立脚本更严格地覆盖（竞态、边界时长、408/401、计数一致性等）。

### Shell / 接口回归（实跑命令与数字）

- 中断清理：5 次 `curl -m 2 --limit-rate 50k -F ...@big.bin`；
  `tmp 0→0`、`fd 19→19`、`index.json` md5 前后一致、日志 5 行 `client-abort`。
- 接口：错误员工口令 **401**；只带一段 **400**（`缺少英文录音`）；未登录管理端 **401**；
  管理端登录 200；Range 100 字节 **206**；下载 `Content-Disposition: attachment`；
  `%2e%2e/server/index.js` 与 `/../package.json` **404**；60MB **413**（`单个音频文件不能超过 50 MB`）；
  上述拒绝路径均未写入索引（grep 计数 0）。
- `/api/config` 不含 `test123/testadmin/admin123`（grep 0）。

### 静态检查

- `public/` 内无 `sessionStorage`、`document.cookie`、`innerHTML`、`eval`、口令字样；
  `localStorage` 仅 `recording.lastName` 一处；EC/NS/AGC 三处均为 `false`；
  实测 `getUserMedia` 实参恰为 `{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false}`，
  `track.getSettings()` 生效值也为 false，且录制全程未调用 `applyConstraints`。
- 未改动 `server/`、`content/`、`constitution/`、根目录文件（`git diff --name-only` 验证）。

### 未执行项

1. **真实 beforeunload 确认框**：headless Chromium 不弹框（`page.close({runBeforeUnload:true})`
   未触发 dialog）。仅验证了合成 `beforeunload` 事件的 `defaultPrevented=true/false` 与代码审查。
   需要真人在真实浏览器里补一次确认。
2. **Safari `audio/mp4` 分支**：环境无 Safari。
3. **真实麦克风音质/手感**：只有 fake device。
4. **「关闭自动刷新开关后 33 秒无请求」**：未独立复跑（实施者脚本覆盖，代码审查确认 `tick()` 守卫）。
5. **MediaRecorder 中途报错丢弃该段**：仅代码审查。
6. Docker 构建：与 spec-001 相同，环境无 Docker，不在本 spec 范围。

## Issues

### 1. [中] E7 竞态：`getUserMedia` 等待窗口内可重复启动、可同时启动两段

**复现（新 Chromium 上下文，已在验收中实跑）：**

1. 在 `addInitScript` 中把 `navigator.mediaDevices.getUserMedia` 延迟 1.5 秒
   （模拟**首次使用时的授权弹窗**，或慢设备/慢浏览器）；
2. `page.dblclick('.segment[data-key="zh"] button.primary')` —— 正常双击；
   观测：`getUserMedia` 被调用 **2 次**；停止一次后，`window.__streams` 中该次请求的两条轨道为
   **`[live, ended]`** —— 第一条录音器与麦克风流**未被停止**（URL/UI 已不显示录音中，麦克风却仍被占用）；
3. 另一路径：先点中文「开始录音」，**800ms 后**点英文「开始录音」；
   观测：两段状态**同时**为「录音中……」，`getUserMedia` 调用 2 次 —— 直接违反 E7。
   （不加延迟时，用 `evaluate` 在同一任务内连点两次同样 100% 复现：`gum=2`，`[live, ended]`。）

**机理（代码审查）：** `app.js:515 startRecording()` 在 `await getUserMedia` **之前**检查
`segment.recording || state.busy || isAnyRecording()`，等待期间三者都还没被置位；
按钮也要等 `await` 返回后的 `updateUI()` 才 disabled。等待窗口内所有入口都处于“看似空闲”状态。

**影响：** 首次授权弹窗（每个新员工第一次都会遇到）期间按钮无任何反馈，用户再次点击很自然。
同段双击会遗留常驻的麦克风流（隐私指示灯持续亮、录音器继续缓冲）；两段同时录音则破坏
“一次只录一段”的交互承诺。不造成已提交数据损坏，但属于可复现的功能需求违例。

**性质说明：** 该模式在 spec-001 的 `app.js` 中完全相同（`git show HEAD:recording/public/app.js`
同位置同样是“守卫在 await 之前”），因此**不是 spec-002 引入的回归**；但 E7 是 spec-002 的明确要求。

**建议的最小修法（供返工参考，未实施）：**
同步维护一个 `starting`（或 pending）标志/立即 disable 相关按钮，在 `await getUserMedia`
之后重新检查一次；若已被占用则立即 `track.stop()` 并放弃本次启动。

### 2. [低/仅记录] 不足 1 秒的录音提示为「没有采集到任何声音」

K 脚本调试时实测：录制约 0.3 秒后停止，出现「这次录音没有采集到任何声音，请检查麦克风后重录」
（`MediaRecorder.start(1000)` + 停止过早，产物 Blob 为空触发既有保护）。
提示不够准确（确有声音，只是过短），但**可恢复、无副作用**，且为 spec-001 既有行为，
不在 spec-002 范围，仅记录。

### 3. [说明] 真实 beforeunload 弹窗未在 headless 验证

不是实现问题，是验证环境限制（见「未执行项」1）。

## Regression Risks

1. **录音启动路径是本次返工触及点**：修竞态时会动 `startRecording` 的入口守卫，
   必须重跑竞态脚本 R1/R2 + 正常录制/停止/重录流程，确认不引入“按钮永久禁用”类问题。
2. **`showStep` 与录音状态的耦合**：E1 的“返回改名不丢录音”依赖 `showStep` 不触碰 segment 状态；
   后续若在步骤切换中加入清理逻辑，需复测 X1 与试听保留。
3. **提交路径（XHR）**：408/401 语义已实测通过；后续若改动 `finishSubmitRequest` 的调用点，
   注意 `onload/onerror/onabort` 互斥，防止重复收尾。
4. **管理端轮询**：401 停轮询依赖 `showLogin → stopTicking`；若将来加多标签页/重登录逻辑，
   需复测「401 后 33 秒 0 请求」。
5. **`data/tmp` 清理**：本次 5 连击无残留；上传生命周期仍是最高风险面，改动后复跑中断测试。

## Required Rework — 第一轮（已由返工完成，见文首第二轮复验）

1. **修复 E7 竞态（阻塞）**：在 `startRecording` 中关闭 `await getUserMedia` 的窗口
   （同步置位 pending 标志/立即禁用按钮，await 后重新校验；若窗口内已有录音在进行，
   立即停止新拿到的流并放弃）。音频约束与产物格式不得变化。
2. 返工后由**新的独立验收**验证：
   - `accept-race.mjs` 的 R1（正常双击只启动一次、停止后无 live 轨道）与
     R2（先后点两段只启动一段）PASS；
   - 冒烟：正常录音 → 停止 → 试听 → 重录 → 提交成功，EC/NS/AGC 约束仍为 false。

> 返工范围仅限 `public/app.js` 的启动守卫；不需要动服务端、接口或数据模型。