# Plan — spec-003 后台手动上传候选图标

## 实施顺序

1. `server/icons.js`：store 支持 `reload()`、`allocateId()`、`saveUploadedIcon()`；
   PNG 校验、文件名清洗、临时文件+rename、串行锁。
2. `server/http.js`：`readBodyBuffer(req, limit)`（超限 413、中断 400）。
3. `server/routes/admin.js`：`POST /api/admin/icons`，管理员权限，读取原始字节，
   调用保存，重新扫描，返回 `{ok, added, total, iconsAvailable}`。
4. `server/app.js`：加路由。
5. `client/src/api.js`：`uploadIcon(file)`（`fetch` body=File，Content-Type image/png，
   `?filename=`），逐张调用。
6. `client/src/components/IconUpload.vue`：多选、列表、状态、上传、结果；插入
   `AdminDashboard`，上传完成后 emit refresh。
7. UI 样式：面板、文件列表、进度/错误、窄屏。
8. Docker：compose 图标卷改可写；docs 权限说明；README/AGENTS/tech-stack 同步。
9. 测试：`tests/icons-upload.test.js`；E2E 改用临时图标目录并增加上传步骤；
   现有 E2E 的 20 张硬编码改为动态（当前 31 张）。
10. 同步现有 31 张图标：已导入，无需代码；确认 `scanIcons` 能读到。

## 接口

```http
POST /api/admin/icons?filename=<urlencoded original name>
Content-Type: image/png
<PNG bytes>
```

成功 200：

```json
{
  "ok": true,
  "added": [{ "id": "32", "name": "新图标", "url": "/icons/32_%E6%96%B0%E5%9B%BE%E6%A0%87.png" }],
  "total": 32,
  "iconsAvailable": true
}
```

失败：`{ error, message }`，400/401/403/409/413/500。

## 测试计划

- 单元：权限矩阵、PNG 签名、5MB、空文件、文件名清洗、编号最小空位、并发 2 张、
  上限 99（用临时目录预置 99 个空文件或 mock 扫描）、重扫后 state 可见。
- E2E：复制 31 张到临时 `ICONS_DIR`，后台 `setInputFiles` 上传 1 张，
  等待后台图标数 +1，前台出现新名称、0 票；再上传非 PNG 验证错误提示。
- Docker：compose 可写卷、非 root 上传（临时 compose/数据）。
- 回归：投票/关闭/CSV/重置。

## 风险

| 风险 | 应对 |
|---|---|
| 并发分配同编号 | 串行锁 + exclusive write/rename |
| 上传文件不可写（Docker ro） | 改 rw + 文档 chown |
| 大图拖慢前台 | 5MB 上限；本次导入的 11 张已压到 640px/约 280KB |
| E2E 硬编码 20 张 | 改为动态数量并使用临时图标目录 |
| 文件名/路径注入 | 分离 basename、移除分隔符/控制字符/`..`、仅拼接固定目录 |
| 上传后白名单未更新 | 保存成功后 `iconStore.reload()`；测试立即 state |

## 预计涉及文件

后端 4、前端 3、测试 2、E2E 1、部署/文档 5。
