# Plan — spec-002 界面与流程优化

> 描述**如何实施**已经确认的 Spec。可以随代码调研完善，但不得绕过 Spec 改变需求本身。

## 涉及模块

- `public/index.html`、`public/app.js` —— 员工端结构、样式钩子与全部交互逻辑
- `public/admin.html`、`public/admin.js` —— 管理端结构、工具栏与列表交互
- `public/style.css` —— 两页共用样式（token、组件、响应式）
- `README.md`、`specs/README.md` —— 文档同步与登记
- **不改** `server/`、`content/`、`constitution/`、`.ai/decisions/`

## 修改顺序

1. **HTML 骨架先行。** `index.html` 加步骤指示器容器、录音步的"修改姓名"入口、
   必要的 `aria-live` 区域与 `tabindex="-1"` 标题；`admin.html` 加搜索框、排序选择、
   自动刷新开关、复制按钮、列表计数区。理由：DOM 结构定了，JS 才有稳定挂点。
2. **样式打底。** `style.css` 先建设计 token（颜色/间距/圆角/字号/阴影），
   再补按钮层级、`:focus-visible`、进度条、电平条、步骤指示器、`prefers-reduced-motion`，
   最后写两页布局与响应式断点（900px / 640px）。
3. **员工端逻辑（`app.js`）。** 按 E1 → E9 顺序实现：步骤导航与焦点 → 姓名记忆 →
   时长实测（`Audio` 元数据 + 回退）→ 电平与静音提示 → XHR 进度/取消/重试 →
   `beforeunload`。每完成一块手动起服务验证一块。
4. **管理端逻辑（`admin.js`）。** A1 → A5：搜索/排序/计数 → 轮询与可见性 →
   相对时间与偏短标记 → 复制 → 播放互斥。
5. **回归与文档。** 复跑 spec-001 关键接口与上传清理回归；更新 `README.md` 的
   两端描述；`specs/README.md` 登记 spec-002。

理由：结构 → 样式 → 行为，员工端（核心流程）先于管理端；每步可独立验证。

## 数据流

无新增服务端数据流。三处客户端变化：

- **提交**：`fetch` → `XMLHttpRequest`。`upload.onprogress` 驱动百分比；
  `abort()` 走"取消"；响应解析与 401/408/413/500 分支保持现有语义。
- **录音**：`MediaStream` 一路进 `MediaRecorder`（不变），另一路只读接入
  `AnalyserNode` 做电平可视化，不参与录制、不加约束。
- **姓名**：`localStorage` 单向回填；口令始终只在内存中。

管理端新增一个只读请求：启动时 `GET /api/config` 取 `minSeconds` 用于"偏短"标记。

## 接口变化

无。不新增、不修改任何接口与字段。

## 测试计划

项目无测试框架、无 build/lint（见 `constitution/tech-stack.md`），验收以实跑为准。

- **启动**：`PORT=3111 npm start`（Node ≥ 20.12、ffmpeg 可用）。
- **浏览器自动化**（Playwright/Chromium + fake device）：
  - 员工端全流程；E1 返回改姓名不丢录音；E2 回填与隐私模式降级；
  - E4 阈值：临时把 `passages.json` 的 target/max 调小后实测自动停止，测完还原；
  - E5 静音提示：用 `--use-file-for-fake-audio-capture` 分别提供有声与静音 wav；
  - E6 时长一致性；E8 取消与重试（CDP 断网、伪造 408/500）；E9 `beforeunload`。
  - 管理端：搜索/排序/计数、轮询节奏与后台暂停、偏短标记、复制
    （`grantPermissions` 剪贴板）、播放互斥、XSS 姓名、100 条数据渲染计时。
- **接口回归**（curl / node 脚本）：401、400、413、408、500、覆盖提交、
  Range 206、下载 `attachment`、`/api/config` 不含口令。
- **资源回归**：上传中途 abort 后 `data/tmp/` 文件数与进程 fd 不增长
  （复跑 spec-001 Tests A 的思路）。
- **手工**：Chrome 与 Safari 各用真麦克风录一段，确认电平、时长、试听正常。
- **无法自动验证**：Safari 真实交互细节（手工补）、真麦克风音质（用户确认）。

## 风险

1. **Web Audio 与 MediaRecorder 共存**：`AnalyserNode` 理论只读，但必须实测确认
   EC/NS/AGC 生效值与产物格式不变（本项目最关键约束）。
2. **XHR 改造触碰提交路径**：401 回退、408/413/500 文案、覆盖语义可能被改坏；
   按接口回归清单逐条复测。
3. **样式共用**：`style.css` 被两页共享，改组件样式需两页同时回归。
4. **前端大改回归面广**：spec-001 的关键保证（口令、音频格式、覆盖提交、
   路径安全、上传清理）必须复测，不能只看新功能。
5. **轮询带来额外请求**：30 秒间隔对单管理员可忽略；仍加可见性暂停与开关。

## 迁移策略

无。`data/` 不动，既有记录原样展示。

## 预计涉及文件

```text
recording/public/index.html
recording/public/app.js
recording/public/admin.html
recording/public/admin.js
recording/public/style.css
recording/README.md
recording/specs/README.md
```