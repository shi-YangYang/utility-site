# screenshot-ledger —— 截图记账（Android）

导入京东、淘宝、拼多多等付款截图，由 LLM 识别金额与商户，一键记账并按月与分类汇总。
数据只存在手机本地（SQLite），没有账号、没有服务端；打 APK 分发给同事使用。

## 功能

- 单张或批量（最多 10 张）截图识别，结果可改再保存；失败可重试或手动填写
- 分类可自定义：表单里「分类 → 管理」进入分类管理页，可新增/删除；识别提示词跟随自定义列表
- 重复导入有提醒；识别不到交易时间时预填当前时间并提示
- 账本按日分组、可编辑删除；汇总按月看收支与分类占比
- 汇总页「导出账目」：Excel（.xlsx）/ CSV / PDF（汇总+明细）/ PNG 汇总卡，
  范围可选本月或全部，导出后走系统分享（微信、邮件、文件管理器）

## 运行（开发预览）

需要 Node 20+，手机安装 [Expo Go](https://expo.dev/go)（选 SDK 57）。

```sh
npm install
cp .env.example .env    # 填入 LLM 配置，见下节
npx expo start          # 手机与电脑同一 Wi-Fi，扫码
```

## 配置

`.env` 只有三项，模板见 [`.env.example`](./.env.example)：

| 变量 | 说明 |
|---|---|
| `EXPO_PUBLIC_LLM_BASE_URL` | OpenAI 兼容接口地址 |
| `EXPO_PUBLIC_LLM_MODEL` | 多模态模型（能看图），如 `qwen3.7-plus` |
| `EXPO_PUBLIC_LLM_API_KEY` | API Key |

阿里云百炼的 Key 与地址严格配套，混用会 401：按量付费（`sk-` 开头）用
`https://dashscope.aliyuncs.com/compatible-mode/v1`；Token Plan（`sk-sp-` 开头）用
`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
其他 OpenAI 兼容服务商填自己的地址即可。

> `EXPO_PUBLIC_*` 会被编译进 APK，任何拿到安装包的人都能提取——这是有意接受的取舍。
> 请单独申请一把 Key、设置额度上限，只分发给可信的同事；泄露后轮换 Key 并重新打包。

## 打包 APK

需要 JDK 17 + Android SDK（装 Android Studio 最省事）。

```sh
npm install
cp .env.example .env    # 确认这里是你想打进包里的配置
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# 产物按 CPU 架构拆分（各约 30MB）：
#   app-arm64-v8a-release.apk    ← 现代手机，发给同事用这个
#   app-armeabi-v7a-release.apk  ← 老机型备用
```

- **正式签名**：使用本机的 `release.keystore`，密码在 `keystore.properties`（两者都不入库，
  由 `plugins/with-release-build.js` 在 prebuild 时注入）。**请自行备份这两个文件**，
  丢失后无法对已安装的 App 覆盖升级；之前装过 debug 签名版本的手机需先卸载再装。
- **体积**：仅打包 arm64/armv7 两种架构并压缩原生库（从全架构 109MB 降到 ~30MB）。
  要调整架构或恢复全架构包，改插件里的 `include` / `universalApk` 即可。
- 没有本地 Android 环境时可用 `eas build -p android --profile preview` 云构建（需 Expo 账号）。

## 开发

```sh
npm test           # Jest：金额/日期/汇总/表单/导出（Excel/CSV/PDF）/LLM 解析与客户端，65 个用例
npm run typecheck  # tsc --noEmit
```

页面在 `src/app/`（expo-router），纯逻辑在 `src/lib/`（可单测），数据层在 `src/db/`（SQLite）。

## 状态

- 已通过：`tsc`、Jest 65/65（含本地 HTTP mock 的 LLM 客户端测试）、Android bundle 导出、`expo-doctor` 21/21
- 真机：单张识别 → 保存 → 汇总 已验证；批量流程与导出待复测
- 未执行：`prebuild + gradlew` 的实际 APK 构建（开发机无 JDK/Android SDK）
- 隐私：截图会发送给配置的 LLM 服务商用于识别；账目只在本机，卸载即删（可用「导出 CSV」自行备份）
