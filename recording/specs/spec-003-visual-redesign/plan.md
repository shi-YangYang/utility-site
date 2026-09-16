# Plan — spec-003 界面重设计（视觉与排版）

> 描述**如何实施**已确认的 Spec。可随代码调研完善，但不得绕过 Spec 改变需求本身。

## 涉及模块

- `public/index.html`、`public/app.js` —— 员工端结构与渲染
- `public/admin.html`、`public/admin.js` —— 管理端结构与渲染（含自研精简播放器）
- `public/style.css` —— token、骨架、组件、两页样式与响应式
- `specs/README.md` —— 登记 spec-003
- **不改** `server/`、`content/`、`constitution/`、根目录文件

## 修改顺序

1. **设计基线（CSS 为主）**：建立 `:root` token（颜色/字号/间距/圆角/阴影）、
   body 纵向 flex 骨架与贴底页脚、统一容器与水平内边距。先在两个页面
   用现有 DOM 验证 1440 / 390 下骨架正确，再继续。
2. **组件层**：三种按钮与五种状态、输入框、徽标、提示条、空态、步骤器。
   这一层尽量只改 CSS；步骤器按需微调 HTML 结构。
3. **员工端重排**：去掉卡片标题的重复序号；卡头精简为"语言 + 状态"；
   控制区收拢为固定底部一行（主按钮 / 计时 / 进度 / 电平）；
   提交区改为摘要式区块；完成页改为聚焦布局。
   `app.js` 的**状态管理与流程逻辑不动**，只调整渲染函数与少量 DOM 引用。
4. **管理端重排**：工具栏按「筛选 | 设置 | 操作」分组；表格行高收紧；
   新增自研播放器组件（内联 SVG + `<button>` + `input[type=range]` + 时间文本），
   替换 `buildSegmentCell` 中的 `<audio>`；下载改图标按钮；时长格式化 `m:ss.s`。
5. **图标**：在两页 HTML 中以内联 `<svg><symbol>` 定义图标集（零请求复用），
   替换现有文本/emoji 图标位。
6. **量化回归**：多视口截图（before/after）+ 脚本化度量断言；跑 spec-002 关键回归。
7. **文档**：`specs/README.md` 登记；README 若描述界面能力则同步。

理由：先骨架后组件再页面，避免在未定的间距/色板上反复返工；
员工端先行（核心流程），管理端后做（改动面最大的是表格与播放器）。

## 数据流

无接口与数据流变化。唯一新增：管理端表格里的自研播放器直接控制页面内的
`<audio>` 元素（`play/pause`、`currentTime`、`timeupdate`），
音频仍走既有 `/api/admin/audio/:id/:segment`（Range）接口；不新增请求类型。

## 接口变化

无。

## 测试计划

复用 spec-002 的 Playwright / Chromium / 假麦克风资产（不再重建环境），新增：

- **量化断言脚本**（对新构建的服务）：
  - 页脚贴底：`document.documentElement.scrollHeight === innerHeight`（内容不足一屏时），
    输出页脚底边与视口底差值；
  - 两卡等高：录音页两卡片 `getBoundingClientRect().bottom` 差值 ≤1px（1440/1024）；
  - 表格密度：8 条记录时首屏可见行数 ≥7（1440×900）；
  - 无页面级横滚：五档视口 `scrollWidth ≤ innerWidth+1`；
  - 对比度：用 WCAG 公式计算新 token 组合（≥10 组，≥4.5:1）；
  - 图标：`document.querySelectorAll('img, emoji 文本')` 抽查，确认功能图标均为 SVG；
  - 播放器：键盘可聚焦、空格/回车切换播放、方向键调节进度、`aria-label` 存在、
    播放互斥成立。
- **多视口截图**：1440/1280/1024/768/390 × 员工端（口令/姓名/录音空闲/录音中/
  已录/完成）+ 管理端（登录/列表/空态），存证据目录，人工复核排版整齐度。
- **spec-002 关键回归**（脚本化）：录音约束 EC/NS/AGC、上传进度/取消/重试、
  beforeunload、搜索/排序/自动刷新、XSS 姓名、100 条搜索 <200ms、focus-visible、
  reduced-motion。
- **无法自动验证**：整体"好看"与否属主观判断，由截图交用户复核；真麦克风录音
  手感沿用 spec-002 的未验证项。

## 风险

1. **渲染重构触碰录音状态机**：`app.js` 的 `recording/pending/meter/submit`
   状态与 DOM 节点绑定较多，改动时保持状态字段与流程函数不变，只改视图；
   竞态守卫（spec-002 返工产物）不得被破坏，需复跑竞态用例。
2. **自研播放器**：要处理 `loadedmetadata` 时长、Range 跳转、播放互斥、
   键盘可达；Safari 对 range 样式与 `currentTime` 设置的行为需实测。
3. **CSS 大改导致无障碍回退**：对比度、focus-visible、aria 结构需在改动后逐项复核。
4. **表格 100 条性能**：自研播放器不能每行都创建重量级监听；
   采用事件委托（在 tbody 上监听点击/输入）。
5. **窄屏折行**：工具栏分组在 390 下容易参差，需以固定断点与网格约束。

## 迁移策略

无。既有数据与接口不变。

## 预计涉及文件

```text
recording/public/index.html
recording/public/app.js
recording/public/admin.html
recording/public/admin.js
recording/public/style.css
recording/specs/README.md
```