# Decision 002 — 钉钉扫码 OAuth2 + 本地 mock 双模式

## Context

投票站需要可信的员工身份，且用户提到 corpId。钉钉有两种常见接入方式：
工作台内免登（`dd.requestAuthCode`，只能在钉钉客户端内、依赖 corpId）与
扫码/账号 OAuth2（浏览器可用，依赖 AppKey/AppSecret + 回调地址）。
当前没有真实凭据与域名，需要先能开发和验收。

## Decision

- 主路径采用钉钉 **OAuth2 扫码/账号登录**：`/api/auth/login` 跳转
  `login.dingtalk.com/oauth2/auth`，回调校验 state 后用 code 换 token，
  再取用户 unionId/nick/avatar；配置了 corpId 时在授权 URL 带 `corpId`。
- 本地开发增加 `AUTH_MODE=mock`：输入姓名即建立稳定假身份，界面显著标注“开发模式”；
  `dingtalk` 模式下 mock 接口不可用。
- 管理端不使用钉钉身份，改用独立 `ADMIN_PASSWORD` + 签名会话，避免把管理员权限
  绑定到某个钉钉账号的配置上。

## Reason

扫码 OAuth2 在浏览器和钉钉内置浏览器都能用，不要求用户必须先进入工作台；
mock 模式让没有凭据/域名时也能完整验收；独立管理员口令让后台在钉钉应用尚未配置好时
仍可运维（也避免管理员账号同时是投票人的身份混淆）。

## Alternatives

- 工作台免登：体验更顺，但只能在钉钉客户端内打开，且需要 corpId + jsapi 权限，
  在没有真实应用的阶段无法验证，否决为主路径。
- 只做 mock：无法上线，否决。
- 管理员走钉钉白名单：需要额外的管理员 ID 配置与联调，当前收益不足，暂不采用。

## Consequences

- 真实登录必须有 HTTPS 域名与钉钉回调配置；域名未就绪前只能 mock 演示。
- 管理员与员工是两套会话；管理员不能投票。若未来要求“管理员也能投”，需另开 Spec。
- mock 模式若误开到公网会允许冒充，启动日志与界面必须持续提示，部署文档列入上线检查。
