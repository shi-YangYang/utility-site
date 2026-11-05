# Decision 001 — 图标不入库

## Context

20 张 Logo 候选图共约 944KB。用户 2026-11-04 明确要求把它们移到项目目录后 gitignore。
但站点运行时必须读到这些图，Docker/CI 构建也需要它们。

## Decision

- 图片放在 `toupiao/assets/icons/`，`toupiao/.gitignore` 忽略 `*.png`；目录内保留
  `README.md` 说明命名与上传方式。
- 服务启动时从 `ICONS_DIR` 扫描白名单，按编号提供 `/icons/<file>`。
- Docker 不把图标 COPY 进镜像，改为只读卷挂载 `./assets/icons:/app/assets/icons:ro`。
- 部署到新机器时手工上传图片；缺图时服务不崩，页面显示空状态、后台显示警告。

## Reason

尊重用户“图标不入库”的明确决定；同时用挂载 + 启动扫描避免图片缺失导致构建失败，
并把“需要手工上传”这个运维成本显式写进 README 与部署清单。

## Alternatives

- 图标入库：部署最省事，但违背用户要求。
- 构建时下载：需要额外的对象存储/网络依赖，不必要。
- 图标转 base64 进代码：会把 1MB 二进制塞进源码，且更难替换，否决。

## Consequences

- `git pull` 不会带来图片；新环境部署必须多一步 `scp`。
- CI 构建不依赖图片，因此图标缺失不会让 CI 失败，但上线前必须人工核对
  `iconsAvailable`。
- 未来若图标需要在线管理，应另开 Spec，而不是把图片塞回仓库。
