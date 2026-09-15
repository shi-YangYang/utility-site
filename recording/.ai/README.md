# .ai/ —— 本项目的 Agent 工作留痕

本目录存放 `recording` 子项目的 Agent 协作留痕。四个子目录的职责：

| 目录 | 放什么 |
|---|---|
| `decisions/` | 重要决策留痕。架构方案、数据模型、接口设计、第三方服务、业务规则、技术栈变更、用户明确否决的方案、需要偿还的技术债。格式见根 `AGENTS.md` 第 19 节。 |
| `workflows/` | 本项目特有的工作流说明（如特殊的验收步骤、需要人工介入的环节）。 |
| `prompts/` | 本项目使用的固定提示词模板（如交给子 Agent 的任务交接模板）。 |
| `rules/` | 本项目特有的、比 `AGENTS.md` 更细的开发规则。 |

**重要对话结论、需求变化和影响后续开发的信息必须落在这里，不能只存在于聊天上下文里。**

## 决策索引

| 编号 | 主题 |
|---|---|
| [001](./decisions/001-workflow-tier.md) | 工作流分档判定为 FULL |
| [002](./decisions/002-tech-stack.md) | 技术栈选型：Node 内置 http + 原生前端 |
| [003](./decisions/003-identity-and-access.md) | 身份识别与访问控制：口令 + 姓名不校验 |
| [004](./decisions/004-audio-pipeline.md) | 音频链路：关闭浏览器后处理 + 统一转 WAV |
| [005](./decisions/005-resubmit-policy.md) | 重复提交按姓名覆盖 |
| [006](./decisions/006-docker-and-ci.md) | Docker 部署与 CI/CD 方向，及根目录结构冲突 |
| [007](./decisions/007-upload-abort-and-timeout.md) | 上传中断与超时的资源回收（第一轮返工产物） |
| [008](./decisions/008-ui-ux-polish.md) | UI/UX 与流程优化的方向与取舍（spec-002） |
| [009](./decisions/009-recording-start-guard.md) | 录音启动的并发守卫（spec-002 返工产物） |