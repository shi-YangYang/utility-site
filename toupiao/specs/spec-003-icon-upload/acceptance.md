# Acceptance — spec-003 后台手动上传候选图标

## Result

**PASS**（2026-11-04，独立验收）

验收范围：spec-003 全部 A1–A8、上传 API 的权限/内容/大小/文件名/编号/并发/重扫、后台 1440/375
UI、Docker 可写卷与非 root 上传、31 张现有图标、spec-001/002 高风险回归、文档与仓库卫生。

环境：macOS / Node **v24.20.0** / npm **11.19.0** / Docker **29.7.2** / Compose **v5.5.1** /
系统 Chrome（Playwright-core `channel: chrome`，headless）。测试使用临时 `DATA_DIR`、
`ICONS_DIR`、临时端口与临时 Docker compose；**未读取或打印仓库 `.env`**，未提交、未改动
既有 3001/5173 开发服务与既有容器。

复验说明：首轮独立反例发现 3 项不满足 Spec（只有 PNG 签名 / 真实 PNG 截断仍返回 200；
`00_` + 01–98 时误报 99 上限）。实施者修复后，本次基于**当前工作区代码**重新执行全部官方
命令、21 项 API 反例、9 项 UI、8 项回归与 Docker 临时 compose，以下结论均来自修复后代码。
验收 Agent 未修改业务代码，仅写入本文件与两个状态行。

## Spec Coverage

| 条目 | 结论 | 实际证据（均为本次独立执行） |
|---|---|---|
| **A1** 管理员可见「上传图标」面板；未登录/员工 401/403 | PASS | 独立浏览器脚本：1440 与 375 下 `[data-testid="icon-upload-panel"]` 可见，显示「当前 31 / 99」，`accept="image/png"`、`multiple`，位置在钉钉面板之后、图标表之前；API：匿名 `POST /api/admin/icons` → **401 `ADMIN_AUTH_REQUIRED`**，员工会话 → **403 `ADMIN_REQUIRED`**，管理员 → **200**；未授权请求不落盘。 |
| **A2** 上传 1 张 PNG 成功、落盘 `NN_名称.png`、前台轮询出现且 0 票 | PASS | 临时 31 张目录：上传 `UI验收图标.png` → 200，`added[0] = {id:"32", name:"UI验收图标", file:"32_UI验收图标.png"}`；后台计数 31→32、表格 32 行、逐张状态「#32 UI验收图标」、汇总「成功上传 1 张」；前台**不刷新**，新图在 **3899 ms** 内出现，`0 票`，`naturalWidth>0`；E2E 同样验证 31→32。 |
| **A3** 多张逐张上传；成功/部分失败均正确展示；后台计数更新 | PASS | 多选 2 张 → 2 个成功状态、汇总「成功上传 2 张」、计数 32→34；再选 1 张有效 + 1 张非 PNG → 汇总「成功上传 1 张，失败 1 张」，失败项显示「仅支持完整有效的 PNG 图片」，计数 34→35，失败不阻塞成功项。 |
| **A4** 非 PNG/空/截断/超 5MB/文件名异常被拒且有可读提示 | PASS | 独立 API 反例 **21/21**：文本、空文件、5 字节截断头、**仅 8 字节 PNG 签名**、**真实 PNG 去掉 IEND** 均 **400 `INVALID_IMAGE`** 且不落盘；>5 MB（含 chunked 传输）→ **413 `PAYLOAD_TOO_LARGE`**，不落盘；正好 5 MB → 200，落盘大小 5,242,880 B；错误/缺失 Content-Type → 400；multipart → 400（不走 multipart）。文件名 13 个反例（`../../evil.png`、`..\..\evil.png`、控制字符、中文、空格、`32_测试.png`、空名、`..`、`01_.png`、超长 60 字等）全部落在 `ICONS_DIR` 内，名称清洗/40 字截断正确；跨源 `Origin` → 403。 |
| **A5** 编号取最小空位、并发不冲突、99 上限、目录自动创建 | PASS | 目录 `01,02,04` → 分配 **03**；并发 5 张 → ID 唯一 `03,05,06,07,08`，全部落盘，0 个 `.upload-*.tmp`；99 张 → **409 `ICON_LIMIT_REACHED`** 且不落盘；`ICONS_DIR` 不存在 → 上传自动 `mkdir -p` 并立即生效；只读目录 → 500 且提示 `ICONS_DIR`/权限，服务仍 healthy；`00_` 不再占用编号，`00_` + 01–98 时仍分配 **99**。 |
| **A6** 上传后无需重启；已有投票/用户/开关不变；关闭投票仍可上传 | PASS | 已有 2 票、1 位用户：上传后公众/后台 state 立即 6→7，新图 0 票，`totalVotes=2`、`votersCount=1`、`myVotes` 与用户不变；关闭投票后上传仍 200，`votingOpen=false`、票数不变；外部新增文件经 `createIconStore.reload()` 后 6→7；`/icons/<新文件>` → 200 `image/png`；服务重启后新图标与投票仍在。 |
| **A7** `npm test` / `npm run build` / `npm run test:e2e` 全绿，E2E 覆盖上传 | PASS | `npm test` **58/58 pass，0 fail**（duration 3.39 s）；`npm run build` exit 0（Vite 7.3.7，41 modules）；`npm run test:e2e` exit 0，**23/23 步**通过，含临时 31 张目录 → 后台上传 1 张 → 31→32 → 前台免重启 0 票 → 非 PNG 错误 → 钉钉登录/投票/CSV/重置。 |
| **A8** Docker 卷可写、非 root 可上传；文档同步；图标不入库 | PASS | 临时 compose 构建当前代码镜像：容器 **healthy**、`uid=1000(node)`、`/app/assets/icons` 与 `/app/data` 均 `rw=true`；匿名上传 **401**，管理员上传 200，宿主目录出现 `32_后台上传.png`，`/api/state` 立即 31→32 且新图 0 票；镜像本身（无挂载）图标 **0**、无 `.env`、无 `node_modules`、无 `tests/specs`；`down` 后容器/网络清理。README/AGENTS/docs/tech-stack/assets README 均写 31 张、后台上传、可写卷；`git add -n toupiao` 不含 `.env`/`data`/`dist`/`node_modules`/`e2e/artifacts`/图标 PNG；仓库 31 张图标 SHA-1 全程未变。 |

## Tests

### 官方命令（实际执行）

| 命令 | 结果 |
|---|---|
| `npm test` | **58 tests / 58 pass / 0 fail / 0 skipped**；`duration_ms 3389.39` |
| `npm run build` | exit 0；Vite 7.3.7，41 modules，289 ms；`dist/index.html` 0.88 kB、CSS 24.12 kB、JS 141.10 kB |
| `npm run test:e2e` | exit 0；**23 个步骤全部通过**；输出「✅ E2E 全部通过」；截图/CSV 在 `toupiao/e2e/artifacts/`（gitignore） |

31 张现有图标：01–20 为原有 277–279×190–192，21–31 为 640×640；逐张 `isValidPng` **31/31**
通过，前台 `naturalWidth>0` **31/31**，仓库文件 SHA-1 全程未变。

### 独立验收脚本（断言由验收 Agent 编写，复用 `tests/helpers.js` 脚手架）

| 脚本 | 结果 | 覆盖重点 |
|---|---|---|
| `/tmp/toupiao-acceptance-003/adversarial.mjs` | **21/21 通过** | 权限矩阵、multipart、非 PNG/空/截断/仅签名/真实截断、5 MB 边界与 chunked、文件名穿越/控制字符/中文/空名、最小空位、并发 5 张、99 上限、目录创建/只读、立即生效、关闭投票、reload/静态图、重启持久化、Origin、安全头、`00_` 编号 |
| `/tmp/toupiao-acceptance-003/ui.mjs` | **9/9 通过** | 31 张 `naturalWidth>0`；后台面板/31/99/多选/顺序；上传 1 张 31→32；前台 3899 ms 出现 0 票；多选 2 张；部分失败；35 张全部加载；1440/375 无页面横向滚动；无开发模式/解释性文案 |
| `/tmp/toupiao-acceptance-003/regression.mjs` | **8/8 通过** | 5 票上限 + 6 并发（5 成功 + 1×409）、取消/改投、关闭冻结/重开、CSV BOM/表头/公式注入、RESET 保留用户、管理员 401×10→429、钉钉配置与公开状态隐私、未配置登录 302、会话篡改 401 |

### Docker（临时 compose，未改动既有容器）

| 检查 | 实际结果 |
|---|---|
| 构建/启动 | 当前代码镜像构建成功；容器 `Up (healthy)`；`uid=1000(node)`；绑定挂载 `/app/assets/icons`、`/app/data` 均 `rw=true` |
| 权限 | 匿名上传 401；管理员登录 200；仅签名 PNG 400；有效 PNG 200 |
| 落盘/立即生效 | 宿主 31 张 → 上传后 32 张，出现 `32_后台上传.png`；`/api/state` 31→32，新图 0 票；容器重启后仍在 |
| 镜像内容 | 无挂载运行镜像：`/app/assets/icons` **0 个文件**、无 `.env`、无 `node_modules`、无 `tests`/`specs`；有 `client/dist` |
| 清理 | `docker compose down` 后容器/网络已移除 |

### 首轮反例与复验

| 反例 | 首轮结果 | 修复后本次结果 |
|---|---|---|
| 仅 8 字节 PNG 签名（无 IHDR/IDAT/IEND） | 200（不符合 Spec） | **400 `INVALID_IMAGE`** |
| 真实 PNG 去掉 IEND | 200（不符合 Spec） | **400 `INVALID_IMAGE`** |
| `00_` + 01–98（98 个有效编号） | 409（误报满 99） | **200，分配 99** |

### 截图（/tmp，未写仓库）

`/tmp/toupiao-acceptance-003/ui/`：

- `admin-1440-before.png`、`admin-1440-after-1.png`、`admin-1440-partial-fail.png`
- `vote-1440-after-1.png`
- `admin-375.png`、`vote-375.png`

另：`toupiao/e2e/artifacts/` 含 E2E 自带截图、CSV 与 `server.log`（已被项目 `.gitignore` 忽略）。

## Issues

**阻塞问题：无。**

非阻塞问题 / 后续事项：

1. **README 状态行仍写「spec-003 后台上传图标已实施（待独立验收）」**（`README.md` 状态段）。
   按本次交接的写入范围，验收 Agent 只被允许更新 `specs/README.md` 与
   `spec-003/spec.md` 的状态行，未改 README；协调 Agent 可在交付时同步这一句。
   不影响功能、测试或 Docker 结论。
2. **PNG 结构校验不验证 chunk CRC / 像素解码**：`isValidPng()` 校验签名、IHDR、至少一个
   IDAT 与 IEND，但翻转 IDAT 数据字节或 IHDR CRC 后仍会被接受。Spec 只要求校验 PNG 文件头
   与拒绝截断文件，故不构成本次阻塞项；若未来要求「解码级有效」，可再加 CRC/解码校验。
   残余风险低（仅管理员可上传，静态图以 `image/png` + `nosniff` 提供）。

## Regression Risks

- `ICON_FILE_PATTERN` 收紧为仅 01–99 后，手工放入的 `00_*.png` 会被扫描忽略；当前仓库无
  `00_` 文件，且 00 本来不是合法编号，不影响现有 31 张。
- 完整 PNG 结构校验会拒绝缺少 IDAT/IEND 的畸形文件；现有 31 张全部通过校验（逐张
  `isValidPng` 实测 31/31），E2E 上传也正常。
- 5 MB 边界允许合法 PNG 后附尾随字节（本次边界用例即真实 PNG + 填充），与「上传什么 PNG
  就存什么」一致；不会影响浏览器显示。
- 现有投票/用户/开关/CSV/重置/限流/钉钉配置均通过 `npm test` 58 项、E2E 23 步与独立回归
  8 项；Docker 镜像未 COPY 图标、未包含 `.env`/`node_modules`。
- 仓库 31 张图标 SHA-1 全程未变；E2E/UI/Docker 均使用临时目录，仓库 `assets/icons` 仍 31 张。

## Required Rework

无（阻塞项已修复并复验通过）。

建议的非阻塞收尾：协调 Agent 更新 `README.md` 的 spec-003 状态句；是否补 PNG CRC/解码校验
可作为后续增强，不阻塞本 Spec。
