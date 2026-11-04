# 候选图标目录

这里放 Logo 评选的候选图，**图片本身不提交 git**（见 `../.gitignore`）。
本 README 保留在仓库里，保证目录结构与说明可见。

## 命名

`NN_名称.png`，例如 `01_无限连接.png`：

- `NN`：两位编号，决定展示顺序（01–20）；
- `名称`：显示在卡片上的中文名；
- 扩展名：`.png`。

服务启动时扫描本目录；新增/替换图片后**重启服务**生效。编号重复时保留第一个并打印警告。

## 本地

图片已就位，直接 `npm run dev` 即可。

## 部署

服务器 `git pull` 后本目录只有 README，**必须手工上传图片**：

```bash
# 在本地仓库根执行
scp -r toupiao/assets/icons/*.png <用户>@<服务器>:/srv/utility-site/toupiao/assets/icons/
```

Docker 以只读卷挂载本目录：

```yaml
- ./assets/icons:/app/assets/icons:ro
```

缺图时服务不会崩：前台显示“图标尚未上传”，后台显示警告；补齐后重启容器即可。
