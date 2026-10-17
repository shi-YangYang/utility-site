# AGENTS.md — screenshot-ledger

本文件是 screenshot-ledger 的项目说明，**继承工具站根目录 `AGENTS.md` 的全部通用规范**。
两者冲突时，以根目录规范为准；本文件只补充本项目特有的信息。

## 这是什么

Android 截图记账 App：导入京东/淘宝/拼多多付款截图，LLM 识别金额/商户/时间，确认后本地记账、按月汇总、多格式导出。

## 档位

workflow_tier: LIGHT（用户明确指定；按 6.1 判据本应为 FULL，风险已知）

## 怎么跑

- 开发预览：`npx expo start`，手机用 Expo Go 扫码（需先配置 `.env`）
- 打 APK：`cd android && ./gradlew assembleRelease`，产物在
  `android/app/build/outputs/apk/release/`（按 ABI 拆分，arm64 约 31MB）

## 本项目特有约束

- **LLM API Key 打包写入 APK**：配置在项目根 `.env`（不入仓库），需与
  `.env.example` 的变量名一致；Key 单独申请、设额度上限。此为用户知情决策。
- **每次发新 APK 前递增 `app.json` 的 `android.versionCode`**（连同 `version`）：
  老用户覆盖安装升级依赖 versionCode 不回退；改动后跑 `npx expo prebuild -p android`
  同步到原生工程再打包。
- 正式签名依赖本机 `release.keystore` + `keystore.properties`（均不入仓库）：
  签名不同的包之间不能覆盖安装，最早一版 debug 签名 APK 与后续包互不兼容。
- 数据库存放在设备本地（expo-sqlite，schema v3），无后端、无同步；schema 变更
  必须通过迁移函数并向前兼容老数据。
