# toupiao 运维与钉钉接入手册

面向部署者。开发命令见 [`../README.md`](../README.md)，技术约束见
[`../constitution/tech-stack.md`](../constitution/tech-stack.md)。

## 1. 前置条件

- 一台已装 Docker + compose 插件的服务器（与 recording 共用同一台即可）。
- 仅本机直接运行（`npm start` / `npm run dev`）需要 **Node.js 24+**；Docker 镜像已内置。
- 一个可访问的 **HTTPS 域名**（真实钉钉登录必需；钉钉要求回调地址与备案域名匹配）。
- 钉钉企业内部应用的 AppKey / AppSecret（可选 corpId）。
- 20 张候选图（不在 git 里，需单独上传）。

端口已登记在 [`../../deploy/ports.md`](../../deploy/ports.md)：应用 `3001`（仅本机），
对外 HTTPS `3100`（共享 Caddy）。若服务器上 3001 被占用，改 `HOST_PORT` 并同步端口表。

## 2. 钉钉应用配置

1. 打开[钉钉开发者后台](https://open-dev.dingtalk.com/) → 应用开发 → 企业内部应用 → 创建应用。
2. 记录 **AppKey** 与 **AppSecret**。
3. 在“登录与分享 / 登录”中配置**登录回调地址**：
   `https://<你的域名>/api/auth/callback`
   - 必须与 `PUBLIC_BASE_URL + /api/auth/callback` **逐字符一致**（协议、域名、路径）。
   - 钉钉通常要求 HTTPS 与已备案域名；IP 地址一般不可用。
4. 如需限定企业，填 `DINGTALK_CORP_ID`；不填则允许扫码用户登录。
5. 权限：读取用户基本信息（昵称、头像、unionId）。本项目只用这三项。

> 回调地址配错的表现：钉钉侧报 `redirect_uri` 不匹配，或回调后拿不到 code。
> 先改钉钉后台，再改 `.env`，两边必须一致。

## 3. 首次部署

```bash
# 服务器上，仓库已 clone 到 /srv/utility-site
cd /srv/utility-site
git pull --ff-only

cd toupiao
cp .env.example .env
# 编辑 .env：
#   AUTH_MODE=dingtalk
#   PUBLIC_BASE_URL=https://vote.example.com
#   DINGTALK_APP_KEY=...
#   DINGTALK_APP_SECRET=...
#   DINGTALK_CORP_ID=...（可选）
#   ADMIN_PASSWORD=<至少 8 位随机>
#   SESSION_SECRET=<openssl rand -hex 32>
chmod 600 .env

# 上传 20 张图（在本地仓库根执行，或服务器上用 scp）
# scp -r toupiao/assets/icons/*.png <用户>@<服务器>:/srv/utility-site/toupiao/assets/icons/

mkdir -p data assets/icons
# 让容器内 node 用户（uid 1000）可写
sudo chown -R 1000:1000 data

docker compose up -d --build
docker compose ps          # 期望 healthy
docker compose logs -f
```

访问 `http://<服务器IP>:3001/api/health` 应返回 `{"ok":true}`（仅本机/内网调试）。

## 4. 反向代理与 HTTPS

在 `deploy/proxy/Caddyfile` 增加（先确认 3100 已在 `ports.md` 登记，
并在 `deploy/proxy/docker-compose.yml` 取消 3100 映射的注释）：

```caddy
https://vote.example.com {
    reverse_proxy host.docker.internal:3001
}
```

- 有域名：Caddy 自动签发证书；域名解析到服务器，80/443 可达。
- 只有内网 IP：Caddy 自签证书可以起 HTTPS，但**钉钉回调通常不接受 IP**，
  真实登录仍需要域名；内网演示可先用 `AUTH_MODE=mock`。
- 改完代理后执行 `./deploy/scripts/deploy.sh proxy`。

`PUBLIC_BASE_URL` 必须是对外 HTTPS 地址（不是 `http://IP:3001`），否则回调地址拼错。

## 5. 上线检查清单

- [ ] `.env` 里 `AUTH_MODE=dingtalk`，且 AppKey/AppSecret/`PUBLIC_BASE_URL` 已填。
- [ ] `ADMIN_PASSWORD` 不是示例值，长度 ≥ 8；`SESSION_SECRET` ≥ 32 位随机。
- [ ] 钉钉后台回调地址与 `PUBLIC_BASE_URL/api/auth/callback` 完全一致。
- [ ] `assets/icons/` 有 20 张 PNG；`/api/state` 的 `iconsAvailable=true`。
- [ ] `data/` 属主为 1000，容器重启后投票仍在。
- [ ] 用管理员登录 → 试投 1 票 → 取消 → 关闭投票 → 再投被拒 → 重新开启。
- [ ] 前台未登录看不到任何姓名；后台明细能看到。
- [ ] 导出 CSV 用 Excel 打开中文正常。
- [ ] 真实钉钉扫码能从手机完成一次登录，回跳后显示昵称。

## 6. 备份与恢复

数据只有一个 SQLite 文件（WAL 模式还有 `-wal` / `-shm`）。最稳妥：

```bash
cd /srv/utility-site/toupiao
docker compose stop
cp -a data/toupiao.db* /backup/toupiao-$(date +%F)/
docker compose start
```

或使用 SQLite 在线备份：

```bash
docker compose exec toupiao node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/app/data/toupiao.db');
db.exec(\"VACUUM INTO '/app/data/backup.db'\");
"
```

恢复：停容器 → 用备份覆盖 `data/toupiao.db*` → 启动。

## 7. 常见问题

| 现象 | 排查 |
|---|---|
| 启动即退出，日志提示缺配置 | 检查 `.env` 是否在当前目录、`AUTH_MODE` 与凭据是否匹配 |
| 点登录没反应/400 | `AUTH_MODE=mock` 时没有钉钉跳转，属正常；线上应为 `dingtalk` |
| 钉钉报 redirect_uri 不匹配 | 钉钉后台回调地址 = `PUBLIC_BASE_URL` + `/api/auth/callback`，逐字符核对 |
| 回跳后仍显示未登录 | 反代是否传 `X-Forwarded-Proto: https`；`PUBLIC_BASE_URL` 是否 https；cookie 是否被浏览器拦截 |
| 页面没有图标 | 上传图片到 `assets/icons/`，重启容器；看日志的扫描条数 |
| 数据目录不可写 | `sudo chown -R 1000:1000 data` |
| 后台登录 429 | 限流生效，等 5 分钟；确认没有脚本反复试口令 |
| 重置按钮无效 | 需在确认框输入大写的 `RESET` |

## 8. 安全注意

- `.env` 权限 600，绝不提交；`SESSION_SECRET` 泄露等于可伪造任意会话。
- 管理口令不要与其它系统复用；建议 16 位以上随机串。
- 应用端口 3001 不要对公网开放，只让 Caddy 访问。
- 重置投票不可恢复；重要节点先备份数据库。
- 若把 `AUTH_MODE=mock` 误开到公网，任何人都能冒充任意姓名投票——上线前务必确认。
