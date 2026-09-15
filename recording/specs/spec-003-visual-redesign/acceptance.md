# Acceptance — spec-003 界面重设计（视觉与排版）

> 本文件记录**两轮验收**：
> - **第一轮**：独立验收 Agent，结论 **FAIL**（I1–I6），原文保留在下方「第一轮」。
> - **第二轮**：返工后复验，**由协调 Agent 自验，不是独立验收**——
>   用户明确要求跳过再次独立 Agent 以节省时间。按根规范第 9 节，
>   这不能记为独立验收，保证强度见文末「未执行项与剩余风险」。

## 最终结果

**PASS**（第二轮，返工后复验；**非独立**）

第一轮判 FAIL 的 I1–I6 已全部修复并复验；第一轮通过的主流程、量化布局、对比度、
响应式与 spec-002 回归项维持通过；本轮新增反例全部通过。

---

## 第二轮（返工后）复验 — 协调 Agent 自验，非独立

### 修复清单（仅 `public/`，服务端与数据未动）

| 编号 | 问题 | 修复 |
|---|---|---|
| I1 | 步进器三态与 `aria-current` 全失效 | `app.js` 选择器 `.step-item` → `.step`（HTML 已用 `step`） |
| I2 | 播放按钮两枚图标叠着显示 | `admin.js` 给两枚 SVG 分别加 `icon-play` / `icon-pause` 类 |
| I3 | 表头吸顶不生效 | `.table-wrapper` 增 `max-height: min(74vh, 760px)`，表体内部滚动使 sticky 生效 |
| I4 | 停止后大号计时与徽标/摘要差 0.1s | `updateUI` 停止后用实测时长刷新计时 |
| I5 | token 收敛不彻底 | 新增 `--on-accent/--read-text/--progress-under/--progress-near/--tick/--tick-strong/--knob-shadow/--fs-heading/--fs-read/--fs-data`；`.toolbar-meta` 加 tabular-nums；:root 外无残留硬编码色值/字号（grep 验证） |
| I6 | 截图缺 1280/768/空态 | 补齐，改造后共 15 张（`ui-shots-after/`） |
| I7 | 修复 I1 后暴露的类名冲突：进度条刻度与步进器对勾共用 `.tick`，后者的 `position: absolute` 把已完成步骤的对勾甩到页面左上角（用户实机发现） | 进度条刻度改名 `.progress-tick`（CSS + `app.js` 同步）；`.dot` 增 `position: relative` 作防护 |

### 复验执行与关键数字

| 命令（工作目录 `recording-test/`） | 结果 | 关键数字 |
|---|---|---|
| `node reverify-spec003.mjs` | **20/20 PASS** | 见下方反例表 |
| `node verify-spec003.mjs` | **45/45 PASS** | 页脚 diff=0；两卡 705/705（1440 与 1024）；表格密度 8 行、行高 76px；对比度 10 组最低 4.64:1；五档视口横滚 0；播放器键盘/互斥；上传百分比/取消/重试；XSS 纯文本；100 条过滤 15.6ms |
| `node verify-race2.mjs` | **5/5 PASS** | 录音启动并发守卫不回退（双击/连点/窗口内点两段均只 1 次 `getUserMedia`，轨道 `ended`） |
| `node verify-big.mjs` | **4/4 PASS** | 113 条首屏 80ms；筛选 100 行 16ms；清空/排序 <25ms |
| `node --check public/{app,admin}.js` + grep 硬编码 | 通过 | :root 外无散落色值/字号 |

### 反例（本轮自设，逐条实测）

1. **I1 三步三态**：第 1/2/3 步分别核对 `.is-current` 文案、`aria-current` 数量、
   已完成打勾数量 → 全部正确（输入口令 → 填写姓名 1 个完成 → 朗读录音 2 个完成）。✅
1b. **I1b / I7 对勾位置**：已完成步骤的对勾 `position: static` 且矩形完全落在圆点内
   （top 103 vs dotTop 97）；进度条刻度仍为 `absolute` 且落在进度条内；放大截图
   （`ui-shots-after/crop-topleft.png`）确认 logo 区无游离元素。✅
2. **I4 计时一致性 ×2 轮**：停止后大号计时、徽标、提交摘要三处数字完全一致
   （1.6/1.6、2.2/2.2）。✅
3. **V7 目标/上限状态**（`page.route` 覆盖 `/api/config`，不改项目文件）：
   target 4 / min 2 / max 8 下，到达目标进度条变 `is-reached`、文案「已录满…」、
   `aria-live` 播报；8.0 秒自动停止。✅
4. **A 极窄/矮视口**：320×480、1440×600 均无页面横滚；1440×600 下两卡仍等高（738/738）。✅
5. **B 200% 缩放**：无页面横滚。✅
6. **C 录音中改姓名**：被拦截并提示「请先停止正在进行的录音」，录音未中断。✅
7. **D 播放器边界**：5 次快速连点后 `paused` 与 `is-playing` 自洽；seek 到末尾后自动收尾（暂停、进度归零）。✅
8. **E 播放中滚动表格**：表头吸顶稳定（thTop 192 / wrapTop 191），播放不中断。✅
9. **F 自动刷新开关**：键盘 Space 可关/可开。✅
10. **G 空态（独立空数据服务 3113）**：不破版、显示员工入口地址。✅
11. 全过程无未捕获错误。✅

### 未执行项与剩余风险

- **本轮非独立复核**：I1–I6 的修复者与复验者是同一会话，保证强度低于第一轮；
  如需一次真正的独立复验（尤其步进器/播放器/吸顶三项与截图复核），应另派独立 Agent。
- 真机 Safari / 真麦克风手感、真实 60 秒长录到目标（本轮用阈值覆盖模拟状态）未执行；
- 表体内部滚动是本次为吸顶引入的新行为，390 下横向+纵向滚动的触控体验未在真机验证；
- 「好看」的主观维度需用户看截图定夺（改造前 `ui-shots/`，改造后 `ui-shots-after/`）。

---

# 第一轮（独立验收 Agent）记录

## Result

**FAIL**

主流程、量化布局、对比度、响应式、spec-002 功能回归均通过，但存在 2 个可稳定复现的
功能/视觉缺陷和 1 个明确的 spec-002 无障碍回退，另有 V2 token 收敛与截图证据覆盖不足：

1. **步进器完全失效**（V5 + V14）：`aria-current="step"` 丢失、当前步不高亮、已完成态不显示。
   根因是 HTML 类名改为 `step` 而 JS 仍查询 `.step-item`，`dom.stepItems` 为空集。
2. **管理端播放按钮同时渲染"播放"与"暂停"两枚图标**（V11）：两枚 SVG 均无 `icon-play` /
   `icon-pause` 类，CSS 切换规则全部落空；按钮为 grid，两图标纵向各占一行。
3. **表头吸顶不生效**（V11 叙述项）：`.table-wrapper` 无高度约束，`position: sticky` 无滚动容器可粘。
4. 次要：停止录音后大号计时与徽标/摘要数字不一致（1.8 秒 vs 1.7 秒，可重现）；
   V2 有 10 处 :root 外硬编码色值、4 处硬编码字号（13.5/15/18px）、计数未用 tabular-nums；
   截图证据未覆盖 1280/768 两档与空态。

## Spec Coverage

| 验收标准 | 结果 | 关键证据 |
|---|---|---|
| 页脚贴底（短内容页 scrollHeight==innerHeight；超一屏正常滚动） | PASS | 口令页 900/900、footer diff=0；420 高时 scrollH=434>420、页脚在文档末尾；完成页 diff=0 |
| 两卡等高 1440×900 / 1024 | PASS | bottom 差 0px（1440：705/705；1024：705/705；另测 500 高视口同样 0px） |
| 步骤序号不重复 | PASS | 卡片标题仅「中文（zh-CN）」「英文（en-US）」 |
| 单卡一个主按钮；禁用态非实心 | PASS | 各状态每卡 `.btn-primary:not(.hidden)` ≤1；禁用提交钮背景 `rgb(249,250,251)`，非 accent `rgb(63,91,217)` |
| 工具栏分组（1440 一行；390 折行、搜索占满一行） | PASS | 1440 三组中线均在 y=136（栏高 78px）；390 搜索框 316px = 容器内容宽，组间距 20px，无参差 |
| 表格密度 ≥7 行 / 行高 ≤96px | PASS | 3111(13条) 可见 8 行；3112(113条) 可见 8 行；maxH=79px |
| 自研播放器：键盘、aria-label、互斥、m:ss.s | **部分 PASS** | 空格播放/回车暂停、方向键 seek（1.229→1.252s）、aria-label 存在、互斥成立、`0:11.7 · 366 KB`；**但播放/暂停图标状态切换失效（见 Issues #2）** |
| 下载与时间对齐、长姓名不撑高行 | PASS | 下载为 `<a class="icon-btn">`（aria-label+title+SVG，行高 30px）；时间列 `text-align: right`；长姓名 `nowrap/hidden/ellipsis/170px` + title，行高仍 76px |
| 图标统一（无 emoji / 非 SVG） | PASS | 两页 `<img>`=0；管理端 10 个 symbol 覆盖需求清单；按钮无 emoji |
| 响应式五档无页面级横滚；<1024 单列 | PASS | 五档 ×（口令/录音/录音中/已录/管理端）overflow 全为 0；1023 宽单列 |
| 对比度 ≥10 组 ≥4.5:1 | PASS | 实时读取 CSS 变量计算 15 组，最低 4.64:1（禁用按钮 text-3/surface-2）；正文 12.9–16.5:1 |
| 无障碍不回退 | **FAIL** | `aria-current="step"` 数量 0（spec-002 要求）；其余：焦点落步骤标题、`:focus-visible` 2px 可见、`aria-live` 节点存在、reduced-motion 0.01ms、纯键盘全流程可完成（含录音） |
| spec-002 关键回归 | PASS | EC/NS/AGC 全 false；上传进度/取消/断网重试；beforeunload 未提交拦截、成功后不拦；搜索/排序/自动刷新；XSS 姓名纯文本；113 条搜索同步渲染 0ms |
| 无新增依赖 / 无新增静态资源请求 | PASS | `package.json`、lockfile、`server/`、`content/` 均未改；Network 仅 css/js/api（含 `blob:` 预览） |
| 截图证据（5 档 × 全状态 before/after） | **FAIL** | 各 11 张：1440×9、390×2、1024×1；缺 1280、768 全部状态与管理端空态 |
| 控制台无未捕获错误 | PASS | 无 pageerror / JS console error（仅预期 401 网络日志与模拟断网 ERR_FAILED） |
| 文档同步 | PASS | `specs/README.md` 已登记 spec-003；`recording/README.md` 无界面描述需同步 |

## Tests

实际执行（Node + Playwright Chromium，假麦克风 `--use-fake-device`/`tone.wav`）：

```bash
# A：结构 / 量化指标（3111 员工端+管理端；3112 大列表）     79/82 PASS
node accept003/a-metrics.mjs
# B：对比度（实时 CSS 变量）+ 准备中状态 + 截图素材          20/20 PASS
node accept003/b-contrast-states.mjs
# C：隔离服务 3113（空数据）纯键盘全流程 + 重试/取消 + 管理端 20/22 PASS
node accept003/c-fullflow.mjs
# D：播放图标类名 / 表头吸顶 / 数字一致性                    2/5 PASS（3 项真实缺陷）
node accept003/d-details.mjs
# E：窄屏录音态横滚 + tabular-nums                           4/5 PASS（1 项为脚本误测 th）
node accept003/e-narrow-tabular.mjs
```

关键数字：对比度最低 4.64:1（15 组）；行高 75–79px、可见 8 行；两卡底边差 0px；
113 条搜索渲染 0ms；纯键盘录 11.2s+11.1s 两段并提交成功；下载返回 `audio/wav` 359,118B；
EC/NS/AGC 两次 getUserMedia 均 false；五档 × 多状态页面级横滚 overflow=0。

未执行项：
- 真麦克风录音手感与真机浏览器（Chrome/Safari 实机）——沿用 spec-002 未验证项；
- 到目标 60s / 触顶 180s 自动停止、接近上限变色——需 ≥60s 实时录音，未执行；
- 上传进度百分比数值变化（本机上传毫秒级完成，仅验证进度条/aria-valuenow 出现与取消/重试路径）。

## Issues

**I1（阻断，V5 + V14 回退）步进器三态与 `aria-current` 完全失效**
- 复现：进入录音页后 `document.querySelectorAll('#step-nav .step.is-current').length === 0`，
  `[aria-current="step"]` 数量 0，`is-done` 数量 0（口令 → 姓名 → 录音 → 完成全程如此）。
- 根因：`recording/public/index.html:54` 起 `<li class="step">`，而 `recording/public/app.js:59`
  仍查询 `#step-nav .step-item` → `dom.stepItems` 为空，`setStepNav()`（app.js:214）空转。
- 影响：当前步不高亮、已完成步骤不显示对勾（`.dot .tick` 永不出现）、spec-002 的
  `aria-current="step"` 无障碍信息丢失；截图 `ui-shots-after/04` 中三步外观完全一致。

**I2（中，V11）管理端播放按钮同时显示两枚图标**
- 复现：`document.querySelector('.play-btn')` 内含 2 个 `<svg class="icon">`（use=#i-play、#i-pause），
  计算 display 均为 block，坐标分别为 (370,268,13×13) 与 (370,281,13×13)——纵向堆叠；
  点击播放后 `is-playing` 已加但两枚图标仍同时显示。放大截图：`accept003/shots/play-btn-zoom.png`。
- 根因：`recording/public/admin.js:232` `playButton.append(icon('i-play'), icon('i-pause'))`，
  而 `icon()`（admin.js:50）只设置 `class="icon"`；`style.css:1169-1179` 期望
  `.icon-play` / `.icon-pause` 类。播放中视觉无切换（仅 aria-label 正确）。

**I3（中，V11 叙述项）表头吸顶不生效**
- 复现：3112（113 条）滚动 `window.scrollTo(0, 900)` 后，`th` 的 `top=-708px`，已滚出视口。
- 根因：`.table-wrapper { overflow: auto }`（style.css:1067）无 max-height / height，
  `position: sticky` 相对该容器无滚动量可粘。

**I4（低）停止录音后数字不一致**
- 复现：录 ~1.8s 停止，卡片大号计时「1.8 秒」、徽标「已录 1.7 秒」、摘要「已录 1.7 秒（太短）」。
- 根因：`handleRecordingStop` 写入 blob 实测 `segment.seconds`（app.js:684）后未回写
  `.timer` 文本；timer 停留在最后一次 200ms 轮询值（app.js:743）。

**I5（低，V2）token 收敛不彻底**
- `style.css` :root 外硬编码色值 10 处：`#fff`×4（240/403/538/1047）、`#2a2f38`(672)、
  `#9aa3b0`(741)、`#d9a13c`(749)、`rgba()`×4（757/761/1048/1214）。
- 硬编码字号 4 处：15px(441/654/673)、18px(604)、13.5px(1080)，超出声明的 3 级主层级。
- `#count-text`（计数）未使用 tabular-nums（其余计时/时长均已用）。

**I6（低，交付证据）截图覆盖不足**
- `ui-shots` / `ui-shots-after` 各 11 张：1440×9、390×2、1024×1；缺 1280、768 全状态，
  缺管理端空态；未达到验收标准的"1440/1280/1024/768/390 × 各状态逐屏 before/after"。

反例逐条结论（自设 ≥5 个）：
1. 纯键盘完成员工端全流程（口令→姓名→两段录音→提交）：PASS，全程无鼠标；
2. 卡片四态（准备中/录音中/已录/偏短）与提交摘要交叉核对：PASS，无状态错位；
3. 390 工具栏/表格/提交区参差与遮挡：PASS，无溢出、搜索独占一行、表格容器内滚动；
4. 播放器边界（连点、播到结尾、切歌、末尾 seek 再播）：PASS（互斥 true/true→true/false 修正后成立）；
5. 长文稿 + 低窗口（1440×500 / 1024×500）等高：PASS；长短文稿下卡底差 0px；
6. 禁用/悬停/聚焦三态辨识：PASS（禁用 4.64:1、hover 变深、focus-visible 2px 外框）；
7. 上传取消/断网/重试与 spec-002 一致性：PASS；beforeunload 拦截/放行：PASS。

## Regression Risks

- 修复 I1 时需同时回归 `setStepNav` 的 `aria-current` 增删与 `.dot .tick` 显示，避免步进器回退到 spec-002 旧结构；建议统一类名 `step`（HTML 已用）并更新 JS 选择器。
- 修复 I2 时无论选择"两图标加类"还是"单图标换 use href"，都要复测播放中/暂停/ended 三态图标与 `aria-label` 同步。
- 修复 I3 需给 `.table-wrapper` 加高度约束或撤销该声明；加 max-height 会引入表体内部纵向滚动，需复测 390 下横向滚动与粘顶叠加行为。
- 修复 I4 若改为停止后写入实测秒数，需保持 `aria-hidden` 计时与摘要同源，避免出现第三个数字。
- 本报告未修改任何业务代码；3113 隔离测试服务已在验收结束后停止，测试数据保留在 `accept003/empty-data`，重启命令见 `accept003/`（脚本内 BASE 常量）。

## Required Rework

1. 修复步进器：使 `#step-nav .step` 被 JS 正确选取，恢复当前步/已完成态与 `aria-current="step"`（I1）。
2. 修复播放按钮图标：使播放/暂停图标按状态切换，任一状态下只显示一枚（I2）。
3. 使表头吸顶真实生效（给表格容器高度约束或调整方案并验证），或与用户确认撤销该需求（I3）。
4. 统一停止后计时数字（I4）。
5. 按 V2 收敛残余硬编码色值/字号与计数 tabular-nums（I5）。
6. 补齐 1280/768 与空态的 before/after 截图证据（I6）。

以上 1–3 为必须返工项，4–6 建议同批修复；完成后需由新的独立验收 Agent 复验 I1–I3
的可复现指标（`is-current=1`、`aria-current=1`、播放按钮可见 SVG=1、滚动后表头可见）。