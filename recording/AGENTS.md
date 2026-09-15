# AGENTS.md — recording

本文件是 `recording` 子项目的项目说明，**继承工具站根目录 `AGENTS.md` 的全部通用规范**。
两者冲突时，以根目录规范为准；本文件只补充本项目特有的信息。

## 这是什么

公司内部用的语音样本采集工具：员工在网页上录一段中文、一段英文并上传，
管理员在网页上查看所有员工的提交情况。只做收集，不做分析。

## 档位

workflow_tier: FULL

判档理由：存在服务端（录音要上传）、存在数据持久化（录音落盘 + 员工索引），
不满足根规范 6.1 中 LIGHT 档的前两条。

## 项目模式

project_mode: NEW

## 项目结构

```text
recording/
├── AGENTS.md                 ← 本文件
├── README.md
├── .gitignore                ← 只忽略本项目的 data/，理由见文件内注释
├── .env.example
├── Dockerfile / .dockerignore
├── constitution/             ← mission / roadmap / tech-stack
├── specs/                    ← README + _template + 各 spec
├── .ai/                      ← decisions / workflows / prompts / rules
├── docs/
├── content/
│   └── passages.json         ← 朗读文稿（纯数据，改文本不用动代码）
├── server/                   ← 业务代码：后端。入口 server/index.js
├── public/                   ← 业务代码：前端静态页面
│   ├── index.html            ← 员工端
│   └── admin.html            ← 管理端
└── data/                     ← 运行时数据（gitignore），非源码
```

## 技术栈摘要

Node.js + 原生 HTML/JS；两个静态页面、零构建；ffmpeg 转码为 WAV；
数据以文件系统 + JSON 索引方式存储。详见 [`constitution/tech-stack.md`](./constitution/tech-stack.md)。

## 本项目特有约束

- **只做收集，不做分析。** 任何音色分析、转写、比对功能都超出本项目范围。
- **朗读稿是数据不是代码。** 改动只在 `content/passages.json`，不要把文稿硬编码进页面或服务端逻辑。
- **录音必须关闭浏览器的音频后处理**（`echoCancellation` / `noiseSuppression` / `autoGainControl`
  全部关掉）。这些默认开启的处理会改变音色，直接破坏样本价值。
- **员工姓名来自用户输入，不可信。** 用于文件路径前必须消毒，禁止路径穿越。
- **口令只在服务端校验。** 不得把口令写进前端代码或前端可见的接口返回里。
- `data/` 只放运行时数据，不要提交任何录音样例。

## 常用命令

```bash
npm install     # 安装依赖
npm start       # 启动服务，默认 http://localhost:3000
```

测试与检查命令见 `constitution/tech-stack.md`。本项目当前**没有引入测试框架**，
验收以实际启动服务、真实调用接口为准。