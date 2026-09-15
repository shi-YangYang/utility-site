# Rework — spec-001 MVP 录音收集

## 背景

第一轮实施完成后，独立验收 Agent 给出 **FAIL**。
`spec.md`「验收标准」的 22 条 checkbox 全部通过，但「边界条件」中一条明确要求不满足：

> 上传中断：请求中断或超时不得留下半截文件或索引记录。

完整验收报告见同目录 `acceptance.md`。

## 验收发现的问题

**严重 / 阻塞 —— 上传中途断线导致临时文件与文件描述符永久泄漏。**

复现：`curl --limit-rate ... -m 1.5` 在上传过程中掐断连接。
结果：`DATA_DIR/tmp/upload-*.bin`（半截文件，约 261 KB）与进程持有的写 fd，
**65 秒后仍不回收**；连续 3 次中断 → 3 个残留文件 + 3 个 fd 常驻，只有重启进程才清。

影响：不损坏数据正确性（索引未被写入），但构成可被反复触发的文件描述符耗尽 / 磁盘占用面。

根因（初步定位，以返工实施者的实际分析为准）：

`server/routes/employee.js` 中 `req.pipe(bb)` 之后，**没有任何地方监听 `req` 的
`aborted` / `close` / `error`**。客户端断线时 busboy 不保证 emit `'close'`，于是：

- `parserFinished`（`bb.on('close'|'error')`）可能永不 resolve，处理器永远走不到 `cleanupUploads()`；
- `pendingWrites` 里的 `finished(fileStream)` 永不 settle；
- `entry.writeStream` 从始至终没有被 `destroy()`，fd 一直开着；
- 已经落到 `DATA_DIR/tmp/` 的半截文件没有任何人删。

## 返工目标

1. **客户端中断必须被检测到。** 在上传请求的生命周期里监听连接中断事件
   （`req` 的 `'aborted'` / `'close'`，以及 `res` 的 `'close'`），
   把"客户端已断开"变成一个明确的状态，让处理流程能据此收尾。
2. **中断后必须释放资源。** 已创建的写流要 `destroy()`；`tmp/` 下这一次上传产生的
   半截文件要删掉；内存缓冲要释放。
3. **中断后处理流程必须终止，不能悬挂。** `parserFinished` 与 `pendingWrites`
   不能因为断线而永不 settle。需要有超时或中断信号的兜底。
4. **不得破坏现有行为。** 现有 5 条上传路径必须保持原样：
   正常提交、口令错误拒绝、缺段、超大文件（413）、假音频（500）。
   特别是「口令错误 → 数据目录零变化」这条现有保证不能回退。
5. **超时也要覆盖。** Spec 的原文是"请求中断**或超时**"，两者都要处理。

## 返工后的验收方法（下一位验收 Agent 用）

- 中断后 **5 秒内**：该次上传在 `DATA_DIR/tmp/` 下的文件被删除；进程不再持有其写 fd。
- **连续 10 次中断**后：`DATA_DIR/tmp/` 文件数与进程打开的 fd 数**均不增长**。
- 上述 5 条现有上传路径的行为**逐条复测**，结果与返工时一致。
- `DATA_DIR/recordings/` 与 `index.json` 在任何中断场景下都不得被改动。

## 范围边界

- 只改 `recording/server/` 内的代码。不得为此引入任何新依赖。
- 不得改动 `content/`、`public/`、`constitution/`、`.ai/`、根目录文件。
- 若发现需要改 `spec.md` 才能实现，**停下来报告**，不得自行改需求。

## 不属本次返工范围（由协调 Agent 处理）

- 根 `README.md` 工具清单与根 `AGENTS.md`「当前子项目」表尚未登记 `recording`
  —— 这是协调 Agent 的收尾步骤，不在 22 条验收标准内，不构成 FAIL。
- 根 `.gitignore` 末行缺尾换行 —— 已修复。