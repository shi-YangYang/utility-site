# workflows

本项目特有工作流：

- **钉钉联调**：真实凭据只在本地/服务器 `.env` 中，联调前确认回调地址与
  `PUBLIC_BASE_URL` 一致；联调记录不写入仓库。
- **发版前**：`npm test` → `npm run build` → `npm run test:e2e` → Docker smoke →
  核对 `iconsAvailable` 与端口表。
- 验收流程与工具站根规范一致（Spec → 实施 → 独立验收）。
