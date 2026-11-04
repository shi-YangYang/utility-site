# toupiao 运维与钉钉接入手册

面向部署者。开发命令见 [`../README.md`](../README.md)，技术约束见
[`../constitution/tech-stack.md`](../constitution/tech-stack.md)。

## 1. 前置条件

- 一台已装 Docker + compose 插件的服务器（与 recording 共用同一台即可）。
- 仅本机直接运行（`npm start` / `npm run dev`）需要 **Node.js 24+**；Docker 镜像已内置。
- 一个可访问的 **HTTPS 域名**（真实钉钉登录必需；钉钉要求回调地址与备案域名匹配）。
- 钉钉企业内部应用的 AppKey / AppSecret（可选 corpId）。
- 31 张候选图（不在 git 里，需单独上传；也可启动后由管理员在后台逐张上传）。

端口已登记在 [`../../deploy/ports.md`](../../deploy/ports.md)：应用 `3001`（仅本机），
对外 HTTPS `3100`（共享 Caddy）。若服务器上 3001 被占用，改 `HOST_PORT` 并同步端口表。

## 2. 钉钉应用配置

1. 打开[钉钉开发者后台](https://open-dev.dingtalk.com/) → 应用开发 → 企业内部应用 → 创建应用。
2. 记录 **AppKey** 与 **AppSecret**。
3. 在“登录与分享 / 登录”中配置**登录回调地址**。这个地址由本站后台生成：
   部署完成后登录 `/admin` → 「钉钉登录」→ 复制“回调地址”，形如
   `https://<你的域名>/api/auth/callback`。
   - 必须与后台面板显示的地址**逐字符一致**（协议、域名、路径）。
   - 钉钉通常要求 HTTPS 与已备案域名；IP 地址一般不可用。
4. 如需限定企业，填 `corpId`；不填则允许扫码用户登录。
5. 权限：读取用户基本信息（昵称、头像、unionId）。本项目只用这三项。

> 回调地址配错的表现：钉钉侧报 `redirect_uri` 不匹配，或回调后拿不到 code。
> 先改钉钉后台，再改本站后台的站点地址，两边必须一致。

## 3. 首次部署

```bash
# 服务器上，仓库已 clone 到 /srv/utility-site
cd /srv/utility-site
git pull --ff-only

cd toupiao
cp .env.example .env
# 编辑 .env，至少填：
#   ADMIN_PASSWORD=<至少 8 位随机>
#   SESSION_SECRET=<openssl rand -hex 32>
#
# 钉钉配置可以留空，启动后在管理后台填写。也可以在这里填可选引导值：
#   PUBLIC_BASE_URL=https://vote.example.com
#   DINGTALK_APP_KEY=...
#   DINGTALK_APP_SECRET=...
#   DINGTALK_CORP_ID=...（可选）
chmod 600 .env

# 上传 31 张图（在本地仓库根执行，或服务器上用 scp）
# scp -r toupiao/assets/icons/*.png <用户>@<服务器>:/srv/utility-site/toupiao/assets/icons/

mkdir -p data assets/icons
# 让容器内 node 用户（uid 1000）可写：SQLite 与后台上传都要写
sudo chown -R 1000:1000 data assets/icons

docker compose up -d --build
docker compose ps          # 期望 healthy（未配置钉钉也应 healthy）
docker compose logs -f
```

访问 `http://<服务器IP>:3001/api/health` 应返回 `{"ok":true}`（仅本机/内网调试）。

## 4. 在管理后台配置钉钉

1. 打开 `https://<你的域名>/admin`，用 `ADMIN_PASSWORD` 登录。
2. 在「钉钉登录」面板填写：
   - 站点地址：对外 HTTPS 地址，如 `https://vote.example.com`（本地调试可用
     `http://localhost:3001` / `http://127.0.0.1:3001`；用 `npm run dev` 时填 Vite 地址
     `http://localhost:5173`）；
   - AppKey、AppSecret；
   - corpId（可选）。
3. 保存后立即生效，无需重启；状态 pill 变为“已配置”。
4. 复制面板中的“回调地址”，填到钉钉应用的登录回调地址（见第 2 节）。
5. 回到前台点「使用钉钉登录」验证。

注意：

- AppSecret 加密后存进 `data/toupiao.db`，后台只显示“已保存/已配置”，接口只返回 `hasSecret`，
  不会回显明文或密文。
- **更换 `SESSION_SECRET` 后，已保存的 AppSecret 无法解密**：后台显示未配置，重新填写即可。
- 后台把 AppKey/corpId/站点地址留空保存会删除数据库值并回退到 `.env` 引导值；AppSecret 留空表示保留原密文；首次配置且无环境变量引导值时必须提供 AppSecret。
- 未配置钉钉时员工点登录会提示“登录暂未开放”，管理员仍可正常使用后台。

### 本地调试（localhost）

钉钉允许把 `http://localhost:<port>` 作为本地调试回调，但**不要省略端口**：

- `npm run dev` 时站点地址填 `http://localhost:5173`
  （不是 `http://127.0.0.1`；后者默认 80 端口，站点并不在 80）。
- 钉钉后台的“重定向 URL / 回调域名”要加 `http://localhost:5173`；
  若该字段要求完整地址，则填 `http://localhost:5173/api/auth/callback`，
  与后台面板显示的“回调地址”逐字符一致。
- 浏览器也用 `http://localhost:5173` 打开；回调会经 Vite 的 `/api` 代理到 `3001`，
  不需要额外开端口。
- 改完钉钉后台后按控制台要求保存/发布应用，再重新点「使用钉钉登录」。

如果钉钉后台不接受 `localhost`，用 cloudflared / ngrok 之类把 5173 映射到一个 HTTPS
地址，把站点地址改成该 HTTPS 地址，并把对应回调填进钉钉后台即可。

## 5. 上传候选图标

管理员登录 `/admin`，在「钉钉登录」下方的「上传图标」面板操作：

- 一次可选择多张 PNG（`accept="image/png"` + 多选），点「开始上传」后逐张上传；
  单张失败不影响其它文件。
- 单张 ≤ **5 MB**，服务端校验 PNG 结构（签名 + IHDR/IDAT/IEND）；文件名会去掉 `.png`、可选 `NN_` 前缀、
  路径分隔符/控制字符/`..`，最多 40 字。编号取 01–99 中最小空位，最多 **99 张**。
- 每张显示等待/上传中/成功（新编号与名称）/失败原因；成功后后台图标表立即刷新，
  前台下一次轮询出现新图标（0 票），不需要重启容器。
- 文件直接写入宿主 `assets/icons/`（容器内 `/app/assets/icons`），不写数据库、不入库。
- 宿主目录必须可写：`sudo chown -R 1000:1000 assets/icons`。目录不可写时接口返回
  500 并提示检查 `ICONS_DIR` 权限；目录不存在时上传会自动创建。
- 本阶段后台只支持**新增**。删除、排序、替换仍需运维手工处理；手工改文件后重启容器生效。

## 6. 反向代理与 HTTPS

在 `deploy/proxy/Caddyfile` 增加（先确认 3100 已在 `ports.md` 登记，
并在 `deploy/proxy/docker-compose.yml` 取消 3100 映射的注释）：

```caddy
https://vote.example.com {
    reverse_proxy host.docker.internal:3001
}
```

- 有域名：Caddy 自动签发证书；域名解析到服务器，80/443 可达。
- 只有内网 IP：Caddy 自签证书可以起 HTTPS，但**钉钉回调通常不接受 IP**，
  真实登录仍需要域名。
- 改完代理后执行 `./deploy/scripts/deploy.sh proxy`。

后台保存的站点地址必须是**对外 HTTPS 地址**（不是 `http://IP:3001`），否则回调地址拼错。

## 7. 上线检查清单

- [ ] `.env` 里 `ADMIN_PASSWORD` 不是示例值，长度 ≥ 8；`SESSION_SECRET` ≥ 32 位随机。
- [ ] 管理员能在 `/admin` 登录。
- [ ] 「钉钉登录」面板状态为“已配置”，站点地址是对外 HTTPS。
- [ ] 钉钉后台回调地址与面板复制的地址完全一致。
- [ ] `assets/icons/` 有 31 张 PNG；`/api/state` 的 `iconsAvailable=true`。
- [ ] `data/` 与 `assets/icons/` 属主为 1000（可写），容器重启后投票仍在。
- [ ] 后台「上传图标」上传 1 张 PNG 成功，图标数 +1，前台出现且 0 票（不重启）。
- [ ] 上传非 PNG 显示可读错误；上传后刷新页面图标仍在。
- [ ] 用员工账号扫码登录 → 试投 1 票 → 取消 → 关闭投票 → 再投被拒 → 重新开启。
- [ ] 前台未登录看不到任何姓名；后台明细能看到。
- [ ] 导出 CSV 用 Excel 打开中文正常。
- [ ] 真实钉钉扫码能从手机完成一次登录，回跳后显示昵称。

## 8. 备份与恢复

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

> 备份文件里包含加密后的 AppSecret。真正能解密它的密钥在 `SESSION_SECRET`，
> 两者要分开保管；更换 `SESSION_SECRET` 后需要在后台重新填写 AppSecret。
>
> 候选图不在数据库里，也不在 git 里；后台上传的图片同样只存在宿主 `assets/icons/`。
> 需要完整恢复时一并备份该目录（`cp -a assets/icons /backup/toupiao-$(date +%F)/`）。

## 9. 常见问题

| 现象 | 排查 |
|---|---|
| 启动即退出，日志提示缺配置 | 检查 `.env` 是否在当前目录，`ADMIN_PASSWORD` / `SESSION_SECRET` 是否填写 |
| 点登录提示“登录暂未开放” | 后台「钉钉登录」未配置，或 AppSecret 因更换 `SESSION_SECRET` 无法解密；重新填写并保存 |
| 钉钉报 redirect_uri 不匹配 | 钉钉后台回调地址 = 后台面板显示的回调地址，逐字符核对 |
| 回跳后仍显示未登录 | 反代是否传 `X-Forwarded-Proto: https`；后台站点地址是否 https；cookie 是否被浏览器拦截 |
| 后台显示“未配置”但环境变量有值 | 数据库里保存了无法解密的 AppSecret 密文会遮蔽环境变量；在后台重新填写 AppSecret，或删除对应 settings 键 |
| 页面没有图标 | 把图片放进 `assets/icons/`（31 张）或在后台「上传图标」；看日志的扫描条数 |
| 后台上传图标返回 500 | 宿主 `assets/icons` 对容器内 uid 1000 不可写；`sudo chown -R 1000:1000 assets/icons` |
| 后台上传提示已达上限 | 编号 01–99 已用满 99 张；先由运维清理不需要的图片 |
| 数据目录不可写 | `sudo chown -R 1000:1000 data assets/icons` |
| 后台登录 429 | 限流生效，等 5 分钟；确认没有脚本反复试口令 |
| 重置按钮无效 | 需在确认框输入大写的 `RESET` |

## 10. 安全注意

- `.env` 权限 600，绝不提交；`SESSION_SECRET` 泄露等于可伪造任意会话，也可解密已存 AppSecret。
- 管理口令不要与其它系统复用；建议 16 位以上随机串。
- 应用端口 3001 不要对公网开放，只让 Caddy 访问。
- 重置投票不可恢复；重要节点先备份数据库。
- 图标上传仅管理员可用：未登录 401、员工 403；服务端校验 PNG 结构与 5 MB 上限，
  文件名清洗后只拼接固定 `ICONS_DIR`，不会写出目录。上传内容不写数据库。
- AppSecret 只应通过后台填写；不要写进代码、日志或聊天记录。接口只返回 `hasSecret`，
  数据库保存的是 AES-256-GCM 密文。
- `DINGTALK_TEST_BASE` 是测试专用（仅 `NODE_ENV=test` 生效），生产环境不要设置。
