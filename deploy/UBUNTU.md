# Ubuntu 服务器部署教程

> 场景：一台 Ubuntu 服务器（内网地址 `172.17.0.17`），没有域名；
> 员工与管理端通过浏览器访问：
> 员工 `https://172.17.0.17/`，管理端 `https://172.17.0.17/admin.html`。
>
> 以下命令**全部在服务器上执行**（先在你自己电脑上 SSH 登录）。
> 首次部署按顺序走完第 0–7 步即可。

---

## 0. 登录与前置检查

```bash
ssh <你的用户名>@172.17.0.17
```

```bash
lsb_release -a
hostname -I
ss -tlnp | grep -E ':80|:443|:3000' || echo "80/443/3000 端口空闲"
sudo -v
```

---

## 1. 安装 Docker

> 腾讯云等国内服务器访问 `download.docker.com` 会超时/被重置，
> 本教程默认使用**腾讯云 Docker CE 镜像源**（实测可用）。
> 若使用其他国内云，可把下面的 `mirrors.cloud.tencent.com` 换成
> `mirrors.aliyun.com`。

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://mirrors.cloud.tencent.com/docker-ce/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://mirrors.cloud.tencent.com/docker-ce/linux/ubuntu jammy stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
```

配置镜像加速（拉 node / caddy 等镜像）：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com", "https://docker.m.daocloud.io"]
}
EOF
sudo systemctl restart docker
```

验证：

```bash
docker run --rm hello-world
docker compose version
```

> 说明：`mirror.ccs.tencentyun.com` 只在腾讯云内网可用，所以放第一位；
> 后面的 daocloud 是公网备用。

---

## 2. 拉取代码

生成只读部署密钥：

```bash
ssh-keygen -t ed25519 -C "utility-site-deploy" -f ~/.ssh/utility-site -N ""
cat ~/.ssh/utility-site.pub
```

把输出的公钥粘贴到：GitHub 仓库 → Settings → Deploy keys → Add deploy key（只读，不要勾写权限）。

配置 SSH 与克隆：

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-utility
  HostName github.com
  User git
  IdentityFile ~/.ssh/utility-site
EOF
chmod 600 ~/.ssh/config

sudo mkdir -p /srv && sudo chown -R "$USER":"$USER" /srv
git clone git@github-utility:shi-YangYang/utility-site.git /srv/utility-site
cd /srv/utility-site
git checkout main
git pull
```

> **注意**：`main` 目前落后 `dev` 6 个提交（`deploy/` 等还没有）。
> 先在 GitHub 把 `dev` 合并进 `main` 再继续；急着先部署可临时执行
> `git checkout dev`（正式流程仍是合并到 main）。

确认部署脚本在：

```bash
ls /srv/utility-site/deploy/scripts/deploy.sh
```

---

## 3. 配置口令

```bash
cd /srv/utility-site
cp recording/.env.example recording/.env
openssl rand -hex 4
nano recording/.env
```

修改下面两行（把生成的管理口令记下来）：

```ini
EMPLOYEE_CODE=给员工的口令
ADMIN_CODE=生成的管理端口令
```

> `.env` 不进仓库；从仓库根执行部署脚本也会正确读取 `recording/.env`。
> 若 3000 端口被占用，再加一行 `HOST_PORT=3001`，并同步登记 `deploy/ports.md`。

---

## 4. 启动应用

```bash
cd /srv/utility-site
mkdir -p recording/data
./deploy/scripts/deploy.sh recording
```

验证：

```bash
docker compose -f recording/docker-compose.yml ps
curl -s http://127.0.0.1:3000/api/config | head -c 80
```

期望：容器 `healthy`，接口返回 JSON。

> 若报「数据目录不可写」：`sudo chown -R 1000:1000 recording/data` 后重试。

---

## 5. 配置 HTTPS（无域名，自签证书）

```bash
cd /srv/utility-site/deploy/proxy
cp Caddyfile.example Caddyfile
sed -i "s/192\.168\.3\.30/172.17.0.17/g" Caddyfile
grep -n "default_sni\|tls internal" Caddyfile
```

确认输出包含 `default_sni 172.17.0.17` 与 `tls internal`，然后启动代理：

```bash
cd /srv/utility-site
./deploy/scripts/deploy.sh proxy
curl -k https://172.17.0.17/api/config | head -c 80
```

> `default_sni` 不能删：浏览器访问 IP 时不发 SNI，缺了它 TLS 握手会失败（已实测）。
> 员工首次打开 `https://172.17.0.17/` 会提示"证书不受信任"，点「高级 → 继续前往」即可正常录音。

想消掉证书警告（可选）：导出 Caddy 根证书，装到员工电脑的「受信任的根证书颁发机构」。

```bash
docker compose -f /srv/utility-site/deploy/proxy/docker-compose.yml exec caddy \
  cat /data/caddy/pki/authorities/local/root.crt > /tmp/caddy-root.crt
```

---

## 6. 防火墙

```bash
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw enable
sudo ufw status
```

> 3000 不需要对外开放，反向代理在服务器内部访问它。

---

## 7. 验收

1. 手机/电脑打开 `https://172.17.0.17/` → 输员工口令 → 填姓名 → 录中英文各一段 → 试听 → 提交。
2. 打开 `https://172.17.0.17/admin.html` → 输管理口令 → 列表可见记录，能试听、下载。
3. 服务器上查看日志：

```bash
docker compose -f /srv/utility-site/recording/docker-compose.yml logs --tail 20
```

---

## 8. 日常更新

**手动**：

```bash
cd /srv/utility-site
git pull --ff-only
./deploy/scripts/deploy.sh recording
```

**自动 CD（可选）**：

1. 在本机生成专用密钥：`ssh-keygen -t ed25519 -f ~/github-cd -N ""`
2. 公钥追加到服务器：`cat ~/github-cd.pub >> ~/.ssh/authorized_keys`
3. GitHub 仓库 → Settings → Secrets and variables → Actions：
   - Secret：`SSH_HOST` = `172.17.0.17`；`SSH_USER` = 你的登录用户；`SSH_KEY` = `~/github-cd` 私钥全文
   - Variable：`DEPLOY_PATH` = `/srv/utility-site`
4. 之后：`dev` 开发 → 发 PR（CI 校验改动项）→ 合并 `main` → CD 自动部署。
5. 未配置凭据时 CD 会跳过并提示；也可在 Actions 里手动运行 CD 补部署。

---

## 9. 备份（建议）

```bash
sudo mkdir -p /srv/backup
crontab -e
```

加入一行（每天 3 点打包，保留 7 天）：

```cron
0 3 * * * tar czf /srv/backup/recording-$(date +\%F).tar.gz -C /srv/utility-site/recording data && find /srv/backup -name 'recording-*.tar.gz' -mtime +7 -delete
```

---

## 常见问题

| 现象 | 处理 |
|---|---|
| 员工端提示"不是安全上下文" | 用 `https://172.17.0.17/`，不要用 `http://172.17.0.17:3000` |
| 浏览器证书警告 | 点「继续前往」；或安装 Caddy 根证书（见第 5 步） |
| TLS 握手失败 / ERR_SSL | Caddyfile 缺 `default_sni`，或 IP 没替换成功 |
| 执行 docker 报 permission denied | `newgrp docker` 或退出重新登录 |
| 数据目录不可写 | `sudo chown -R 1000:1000 recording/data` |
| 3000 被占用 | `recording/.env` 设 `HOST_PORT=3001`，并在 `deploy/ports.md` 登记 |
| 员工手机打不开页面 | 确认手机与服务器网络互通（`172.17.0.17` 需在内网/VPN 可达范围内） |