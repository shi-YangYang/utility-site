# .ai/ —— 本项目的 Agent 工作目录

本目录存放 `recording` 子项目的 Agent 协作文件。四个子目录的职责：

| 目录 | 放什么 |
|---|---|
| `decisions/` | 重要决策。**默认不写**，只有同时满足根 `AGENTS.md` 第 19.1 节三条判据的才记；验收 / 返工过程、实现细节、已有文档的复述一律不写。格式见根规范第 19 节。 |
| `workflows/` | 本项目特有的工作流说明（如特殊的验收步骤、需要人工介入的环节）。 |
| `prompts/` | 本项目使用的固定提示词模板（如交给子 Agent 的任务交接模板）。 |
| `rules/` | 本项目特有的、比 `AGENTS.md` 更细的开发规则。 |

**重要对话结论、需求变化和影响后续开发的信息必须落在这里，不能只存在于聊天上下文里。**
但位置要看内容：需求变化进 Spec，阶段计划进 `constitution/roadmap.md`，
工程约束进 `constitution/tech-stack.md`，只有满足 19.1 的才进 `decisions/`。

## 决策索引

| 编号 | 主题 |
|---|---|
| [002](./decisions/002-tech-stack.md) | 技术栈选型：Node 内置 http + 原生前端 |
| [003](./decisions/003-identity-and-access.md) | 身份识别与访问控制：口令 + 姓名不校验 |
| [004](./decisions/004-audio-pipeline.md) | 音频链路：关闭浏览器后处理 + 统一转 WAV |
| [005](./decisions/005-resubmit-policy.md) | 重复提交按姓名覆盖 |
| [008](./decisions/008-ui-ux-polish.md) | UI/UX 与流程优化的方向与取舍（spec-002） |

> 编号 001 / 006 / 007 / 009 已按根规范第 19 节新标准删除：它们是分档判定、
> 探索日志与返工笔记，不属于决策；其中仍有价值的约束已回写进
> `constitution/tech-stack.md`。编号留空不复用。
