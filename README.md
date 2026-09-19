# 工具站（Utility-Site）

一个仓库，装很多个互不相干的小工具：每个工具一个文件夹，各有自己的依赖、构建与 `README.md`，
互不引用、互不影响。全部规范见 [AGENTS.md](./AGENTS.md)。

## 工具清单

| 工具 | 说明 | 状态 |
|---|---|---|
| [recording](./recording/) | 公司内部语音样本采集：网页录中英文两段并上传，管理员查看提交、试听与下载 | MVP 已完成 |
| [screenshot-ledger](./screenshot-ledger/) | Android 截图记账：LLM 识别京东/淘宝/拼多多等付款截图，一键记账、按月汇总 | 待批量复测与 APK 构建 |
| [deploy](./deploy/) | 全站部署与运维：反向代理、端口分配表、部署脚本与 CI/CD（非业务工具） | 已就位 |

## 用法

每个工具的用法见其目录下的 `README.md`。

## 协作规则

- 默认在 `dev` 开发，PR 合并到 `main`；CI 只校验 PR 改动的子项目；部署需在
  Actions 里手动运行 CD（合并不会自动部署）
- 新增工具：建 kebab-case 文件夹 + `README.md`，并在本文工具清单与
  [AGENTS.md](./AGENTS.md) 的「当前子项目」表各登记一行
- 一次提交只包含一个子项目的改动
