# screenshot-ledger —— 截图记账（Android）

给内部同事用的 Android 记账 App：把京东、淘宝、拼多多、微信、支付宝等**付款截图**丢进来，
由 LLM 识别出金额、商户、时间等信息，一键记一笔账，并按月与分类查看汇总。

账目数据只存在手机本地（SQLite）：没有账号、没有自建服务器、不做云同步。

## 功能

- **单张记账**：选一张付款截图 → 识别 → 确认/修改 → 保存。
- **批量记账**：一次选多张（最多 10 张）→ 全部识别 → 列表核对（点卡片可改、可忽略单张）→ 一键保存全部。
- **手动兜底**：识别不出来（不是付款截图、没网、Key 失效）时可在列表里重试，或手动填写。
- **时间推断提示**：识别不到交易时间时会预填当前时间并给出提示，避免默默记错月份。
- **重复提示**：同一张截图再次导入时会提醒"可能已经记过"。
- **账本**：按日期分组列出全部记录，点进去可编辑、删除。
- **汇总**：按月查看总支出/总收入，以及各分类金额与占比。

## 配置 LLM

复制 [`.env.example`](./.env.example) 为 `.env`，填入 OpenAI 兼容接口配置：

| 变量 | 说明 |
|---|---|
| `EXPO_PUBLIC_LLM_BASE_URL` | 接口地址，如 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `EXPO_PUBLIC_LLM_MODEL` | 多模态模型名，如 `qwen3.7-plus`（能看图，纯文本模型不行） |
| `EXPO_PUBLIC_LLM_API_KEY` | API Key |

> **百炼用户注意**：Base URL 与 Key 是配套的，混用会 401 ——
> 按量付费（`sk-` 开头）用 `https://dashscope.aliyuncs.com/compatible-mode/v1`；
> Token Plan（`sk-sp-` 开头）用 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
> Token Plan 条款限定为「AI 编程工具交互式使用，不可用于应用后端」，用在本 App 前请自行评估风险。
> 详见 [`.env.example`](./.env.example) 里的注释。

> **警告**：`EXPO_PUBLIC_*` 会被编译进 APK，任何拿到安装包的人都能提取。
> 这是经过权衡后接受的设计：只分发给可信的同事；**请单独申请一把 Key 并设置额度上限**；
> 一旦泄露，只能在服务商侧轮换 Key 并重新打包。

## 怎么跑（开发预览，需要 Node）

```bash
npm install
cp .env.example .env    # 填入真实配置
npx expo start          # 手机装 Expo Go，与电脑同一网络，扫码
```

## 怎么打包 APK

打包机需要 **JDK 17 + Android SDK**（装 Android Studio 最省事），并配好 `ANDROID_HOME`。

```bash
npm install
cp .env.example .env    # 打包前确认这里是你想打进包里的配置
npx expo prebuild -p android
cd android
./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

- 默认使用 debug 签名（可直接安装给同事），正式一点的做法是自建 keystore 并在
  `android/app/build.gradle` 里配置 release 签名；**keystore 与密码不要提交进仓库**。
- 没有本地 Android 环境时，也可以用 `eas build -p android --profile preview` 云构建
  （需要 Expo 账号）。
- `android/` 是 prebuild 生成物，不入库，可随时重新生成。

## 技术栈

- React Native + Expo（SDK 57，TypeScript，expo-router）
- expo-sqlite 本地存储；金额以「分」存整数
- `expo-image-picker` 选图 → `expo-image-manipulator` 压缩 → 图片副本存 App 私有目录
- LLM：OpenAI 兼容 Chat Completions（多模态），提示词要求只输出 JSON

## 项目结构

```text
src/
├── app/                    expo-router 页面
│   ├── (tabs)/             账本（列表）与 汇总 两个 Tab
│   ├── add.tsx             截图 → 识别 → 确认流程
│   ├── manual.tsx          手动记一笔
│   └── record/[id].tsx     详情 / 编辑 / 删除
├── components/             RecordForm、ChipGroup、RecordRow
├── constants/theme.ts      颜色与分类色
├── db/                     SQLite 打开/迁移与记录 CRUD
└── lib/                    纯逻辑：金额、日期分组、汇总、表单校验、LLM 解析与客户端、图片处理
```

## 命令

```bash
npm test            # Jest（44 个用例：金额/日期/汇总/表单/LLM 解析与客户端）
npm run typecheck   # tsc --noEmit
npm run export:android  # 只验证 Metro 能否打出 Android bundle
```

## 验证状态（2026-09-19）

已执行并验证：

- `npm run typecheck` 通过；`npm test` 44/44 通过，其中 LLM 客户端用本地 HTTP 服务
  做了真实请求往返（成功、重试、401/429/超时/网络失败）。
- `npx expo export --platform android` 成功产出 Hermes bundle；已实测 `.env` 中的
  baseURL / model / key 会被内联进 bundle。
- `npx expo-doctor` 21/21 通过。

尚未执行（需要真机或 Android 构建环境）：

- 真机 UI 全流程冒烟（Expo Go 或 APK 安装到手机后走一遍截图识别）。
- `prebuild + gradlew assembleRelease` 的实际 APK 构建（本机无 JDK/Android SDK）。
