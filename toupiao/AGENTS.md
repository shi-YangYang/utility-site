# AGENTS.md — toupiao

本文件是 `toupiao` 子项目的项目说明，**继承工具站根目录 `AGENTS.md` 的全部通用规范**。
两者冲突时，以根目录规范为准；本文件只补充本项目特有的信息。

## 这是什么

Esonitro（深圳君柔科技）的 **Logo 评选投票站**：员工用钉钉登录后，在 20 个 Logo 候选稿中
最多投 5 个（可随时取消/改投）；前台实时公开排名与票数；管理员在后台查看投票明细、
开关投票、导出 CSV、重置投票。

## 档位

workflow_tier: FULL

判档理由：有服务端与数据持久化（SQLite）、接钉钉 OAuth2（需要 AppKey/AppSecret）、
有管理员权限与破坏性操作（重置投票）。不满足根规范 6.1 的 LIGHT 条件。

## 项目模式

project_mode: NEW

## 项目结构

```text
toupiao/
├── AGENTS.md                 ← 本文件
├── README.md
├── .gitignore                ← 只忽略本项目的图标与运行数据，理由见文件内注释
├── .env.example
├── Dockerfile / .dockerignore
├── docker-compose.yml
├── constitution/             ← mission / roadmap / tech-stack
├── specs/                    ← README + _template + spec-001
├── .ai/                      ← decisions / workflows / prompts / rules
├── docs/                     ← 部署与钉钉接入操作手册
├── assets/icons/             ← 20 张候选图（**不入库**，见下）
├── client/                   ← Vue 3 前台（Vite 构建）
│   ├── index.html
│   ├── vite.config.js
│   └── src/
├── server/                   ← Node 后端（零运行时依赖）
├── tests/                    ← node:test 接口/集成测试
├── e2e/                      ← Playwright-core + 本机 Chrome 的端到端测试
└── data/                     ← 运行时 SQLite（gitignore，非源码）
```

## 技术栈摘要

Vue 3 + Vue Router 4 + Vite 7；Node.js 24 内置 `http` + `node:sqlite`，零运行时 npm 依赖；
单容器 Docker（Node 托管构建后的 Vue 静态文件 + API）。详见
[`constitution/tech-stack.md`](./constitution/tech-stack.md)。

## 本项目特有约束

- **投票规则是产品硬约束**：每人最多 **5 个不同图标**，每个图标最多 1 票，投票期间可随时取消；
  不允许同一图标重复投票，不允许超过 5 票。上限在服务端强制，前端只做提示。
- **图标不入库**（用户 2026-11-04 明确要求）。`assets/icons/*.png` 被项目 `.gitignore` 忽略；
  本地构建与 Docker 通过只读目录挂载提供图标。**部署到新机器前必须手工上传这 20 张图**，
  否则页面无图可投。详见 `assets/icons/README.md`。
- **钉钉凭据只进环境变量**：`DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` / `DINGTALK_CORP_ID` /
  `SESSION_SECRET` / `ADMIN_PASSWORD` 一律不写进代码、不提交、不打印到日志。
- **mock 登录只用于本地开发**。`AUTH_MODE=mock` 时页面必须显示醒目的“开发模式”标识；
  上线必须使用 `AUTH_MODE=dingtalk`，并配置真实的钉钉应用与回调地址。
- **前台公开排名与票数**（用户 2026-11-04 决定）。前台**不得**公开投票人姓名；
  投票人明细只在管理员鉴权后可读。
- **关闭投票即冻结**：关闭后新增与取消投票都返回明确错误，已投数据不变。
- 管理端是独立口令（`ADMIN_PASSWORD`）+ 签名会话，不复用钉钉身份；管理员会话不能投票。
- 真实钉钉扫码登录要求回调地址是**已备案到钉钉应用的 HTTPS 地址**，通常需要域名。
  本阶段只准备 Docker 与端口，域名/服务器接线见 `docs/README.md`。

## 常用命令

```bash
npm install                 # 安装前端构建与测试依赖（后端无运行时依赖）
cp .env.example .env        # 填写口令与会话密钥；本地开发把 AUTH_MODE 改成 mock
npm run dev                 # 同时起后端 3001 与 Vite 5173
npm run build               # 构建 client/dist
npm start                   # 生产模式启动，默认 http://localhost:3001
npm test                    # node:test 接口/集成测试
npm run test:e2e            # 构建后跑浏览器端到端（需要本机 Chrome）
```

测试与验收的真实命令以 `constitution/tech-stack.md` 为准；**不得假设**存在 lint 或其它命令。
