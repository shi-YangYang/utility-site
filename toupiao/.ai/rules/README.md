# rules

本项目特有规则（根 `AGENTS.md` 与 `toupiao/AGENTS.md` 之外的补充）：

- 所有写操作必须校验 Origin；新增接口沿用 `http.js` 的统一错误体。
- 任何涉及投票数量的改动，必须同时补 `tests/votes.test.js` 的并发/边界用例。
- 不得在前端 bundle 中出现 `ADMIN_PASSWORD`、`SESSION_SECRET`、钉钉 Secret。
- 不得为了“好看”引入 UI 组件库或 CSS 框架；样式写在 `client/src/styles.css` 与组件 scoped 样式中。
