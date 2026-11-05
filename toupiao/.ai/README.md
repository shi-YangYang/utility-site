# .ai/ — toupiao 的 Agent 工作目录

| 目录 | 放什么 |
|---|---|
| `decisions/` | 重要决策。默认不写，只有同时满足根 `AGENTS.md` 19.1 三条判据的才记。 |
| `workflows/` | 本项目特有的工作流（如钉钉联调、发版前检查）。 |
| `prompts/` | 固定提示词模板。 |
| `rules/` | 比 `AGENTS.md` 更细的开发规则。 |

需求变化进 Spec，阶段计划进 `constitution/roadmap.md`，工程约束进
`constitution/tech-stack.md`；验收/返工过程只进 `acceptance.md` / `rework.md`。

## 决策索引

| 编号 | 主题 |
|---|---|
| [001](./decisions/001-icons-not-in-git.md) | 图标不入库：只读目录挂载 + 手工上传 |
| [002](./decisions/002-dingtalk-oauth2-and-mock.md) | 钉钉扫码 OAuth2 + 本地 mock 双模式（历史；mock 已由 003 删除） |
| [003](./decisions/003-dingtalk-admin-config-and-encryption.md) | 钉钉配置后台化 + AppSecret 加密，删除 mock 登录 |
