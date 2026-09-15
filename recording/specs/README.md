# Specs — recording

本目录存放本子项目的所有需求规格。规范见工具站根 `AGENTS.md` 第 15–17 节。

## 目录约定

```text
specs/
├── README.md           ← 本文件
├── _template/          ← 新 Spec 的骨架，复制它开始
│   ├── spec.md
│   ├── plan.md
│   ── acceptance.md
── spec-XXX-short-name/
    ├── spec.md         ← 要实现什么、怎样算完成（需求本身）
    ├── plan.md         ← 怎么实施（可随调研完善，但不得改变需求）
    ├── acceptance.md   ← 验收 Agent 的结论，PASS / FAIL
    ── rework.md       ← 可选，返工时创建
```

命名格式：`spec-XXX-short-name`，编号三位递增，short-name 用 kebab-case。

## 各文件职责

- **spec.md** —— 定义需求。关键决策未确认前不得进入实施。
- **plan.md** —— 定义实施路径。可以随代码调研完善，但不得绕过 spec 改需求。
- **acceptance.md** —— 由**独立于实施者**的验收 Agent 填写，结果只能是 PASS 或 FAIL。
  发现问题时返回问题，验收 Agent **不得**自己修改业务代码。

## 当前 Spec

| 编号 | 名称 | 状态 |
|---|---|---|
| spec-001 | MVP 录音收集 | PASS（返工后复验通过；第二轮为协调 Agent 自验，非独立验收，见 `acceptance.md`） |
| spec-002 | 界面与流程优化 | PASS（第二轮独立复验通过；第一轮 FAIL 的 E7 竞态已修复，见 `acceptance.md`） |
| spec-003 | 界面重设计（视觉与排版） | PASS（第二轮为协调 Agent 自验，非独立；见 `spec-003-visual-redesign/acceptance.md`） |