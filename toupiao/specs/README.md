# Specs — toupiao

本目录存放本子项目的所有需求规格。规范见工具站根 `AGENTS.md` 第 15–17 节。

## 目录约定

```text
specs/
├── README.md           ← 本文件
├── _template/          ← 新 Spec 的骨架，复制它开始
│   ├── spec.md
│   ├── plan.md
│   └── acceptance.md
└── spec-XXX-short-name/
    ├── spec.md         ← 要实现什么、怎样算完成（需求本身）
    ├── plan.md         ← 怎么实施（可随调研完善，但不得改变需求）
    ├── acceptance.md   ← 验收 Agent 的结论，PASS / FAIL
    └── rework.md       ← 可选，返工时创建
```

命名格式：`spec-XXX-short-name`，编号三位递增，short-name 用 kebab-case。

## 当前 Spec

| 编号 | 名称 | 状态 |
|---|---|---|
| spec-001 | MVP Logo 投票 | PASS（2026-11-04，独立验收；非阻塞建议见 `acceptance.md`） |
| spec-002 | 钉钉配置后台化与 UI 整改 | PASS（2026-11-04，独立验收；见 `spec-002-dingtalk-admin-config/acceptance.md`） |
| spec-003 | 后台手动上传候选图标 | PASS（2026-11-04，独立验收；首轮 3 项反例修复后复验；见 `spec-003-icon-upload/acceptance.md`） |
