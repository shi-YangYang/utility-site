# Decision 003 — 钉钉配置后台化 + AppSecret 加密，删除 mock 登录

## Context

MVP 阶段钉钉凭据只能写在 `.env`，并保留了 `AUTH_MODE=mock` 的本地姓名登录。
用户 2026-11-04 明确要求：

1. 产品里不再有 mock 登录、开发模式标识或入口；
2. 管理员在后台填写站点地址、AppKey、AppSecret、corpId，保存后立即生效，不用改服务器文件或重启；
3. 全量清理重复/无意义的 UI（状态栏登录入口、hero 我的票数、0 票排名等）。

这同时带来一个安全约束：AppSecret 不能以明文进 SQLite，否则数据库或备份泄露就等于凭据泄露。

## Decision

- 只保留钉钉扫码 OAuth2；删除 `AUTH_MODE`、`POST /api/auth/mock`、前端 mock 姓名表单与
  `authMode` 字段。旧 `.env` 的 `AUTH_MODE` 直接忽略，不做兼容。
- 钉钉配置存 `settings` 表：
  `dingtalk.app_key`、`dingtalk.app_secret_enc`、`dingtalk.corp_id`、
  `dingtalk.public_base_url`。解析顺序为 **数据库非空值 > 环境变量 > 空**；
  `.env` 的 `DINGTALK_*` / `PUBLIC_BASE_URL` 降级为可选引导值，缺凭据不再启动失败。
- `configured = appKey && appSecret && publicBaseUrl`；回调地址由站点地址 +
  `/api/auth/callback` 生成，后台只读展示并可复制。每次请求读取配置，保存后立即生效。
- AppSecret 使用 AES-256-GCM 加密：12B 随机 IV、16B tag，密钥由 `SESSION_SECRET` 经
  HKDF-SHA256 派生；存储格式 `v1:base64url(iv|tag|ciphertext)`。管理接口只返回
  `hasSecret`，绝不回传明文或密文；日志只记录“配置已更新”。
- 解密失败（如换过 `SESSION_SECRET`）视为未配置并警告一次，不崩溃；管理员重新填写即可恢复。
- 新增 `GET/PUT /api/admin/dingtalk`，管理员会话保护；PUT 校验 URL、长度、控制字符与
  生产 HTTPS（localhost / 127.0.0.1 允许 http）；AppSecret 省略表示保留原密文，
  首次配置且无环境变量引导值时必须提供。
- E2E 用本地假钉钉服务完成真实跳转/回调；仅 `NODE_ENV=test` 时允许
  `DINGTALK_TEST_BASE` 覆盖钉钉 endpoint，生产完全忽略。它不是开发者模式，不出现在 UI。
- 前端：登录弹窗只留标题 + “使用钉钉登录”；未配置时 toast“登录暂未开放”；
  状态栏只留状态 pill + 已投 x/5；hero 只留总票数/参与人数；0 票卡片不显示排名；
  管理端投票开关面板补状态 pill。

## Reason

- 运维不需要 SSH 改 `.env` 或重启容器就能完成钉钉接入；域名/回调变化也能即时修正。
- 删除 mock 消除了“误开公网即可冒充任意员工”的产品级风险，也符合用户明确要求。
- 加密落库让数据库与备份不直接包含 AppSecret；密钥复用已有的 `SESSION_SECRET`，
  不新增配置项或运行时依赖（Node 内置 `crypto`）。
- 环境变量仍可作为首次部署/CI 的引导值，保持向后可用，同时不强迫使用者把凭据写进文件。

## Alternatives

- **继续只走环境变量**：需要改服务器文件并重启，不满足用户“后台配置、保存即生效”的要求，否决。
- **AppSecret 明文存 SQLite**：实现最简单，但数据库/备份泄露即凭据泄露，否决。
- **保留 `AUTH_MODE=mock` 但隐藏入口**：仍是可被误开的产品级后门，用户明确要求删除，否决。
- **单独配置文件/挂载卷**：多一个文件与权限问题，且容器内原子更新不如 SQLite 事务直接，否决。
- **用 `ADMIN_PASSWORD` 派生加密密钥**：管理员改口令会导致 AppSecret 失效，且口令用途混杂，否决。

## Consequences

- 更换 `SESSION_SECRET` 会让已保存的 AppSecret 无法解密：后台显示未配置，必须重新填写；
  README 与部署手册已注明。
- 数据库备份包含密文；`SESSION_SECRET` 必须与备份分开保管，泄露 `SESSION_SECRET` 等于可解密。
- 测试不再通过 HTTP mock 登录：接口测试直接注入签名会话；E2E 用假钉钉 provider。
- 一套部署只对应一个钉钉企业应用；多租户/多应用不在本决策范围内。
- 旧的 `AUTH_MODE`、`/api/auth/mock` 不再可用；升级后无需迁移数据，投票/用户/开关不受影响。
