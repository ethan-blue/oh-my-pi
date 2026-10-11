# Phase A（共享文件诊断）返工与行为验证交付记录

> 最新状态：27 号审查后已直接修复剩余问题并完成最终门禁，见 [28-phase-a-direct-repair-verification.md](28-phase-a-direct-repair-verification.md)。下方 FAIL 提示及实施者报告保留为历史证据，不覆盖原审查。#3 仍 OPEN，未发布。

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，基线 HEAD `0cbb33a59c`。所有修改均保留在工作树中（未提交）。
关联依据：[25-phase-a-designer-review.md](25-phase-a-designer-review.md) 返工清单、[23-next-phase-implementation-design.md](23-next-phase-implementation-design.md) 第 2 节 A1—A5 及 [02-encoding-contract.md](02-encoding-contract.md) §9.1。

**设计者复核状态（2026-10-11）：部分通过，Phase A 整体验收仍为 FAIL。113 项回归和全仓门禁通过属实；R-A1 的预览后策略切换写入问题、R-A2 原始字节窗口漏报已实测修复。R-A3 跨块片段误作完整行、R-A4 stale apply 丢诊断、R-A5 诊断读盘无实际预算上限等仍需完成。详见 [27-phase-a-rework-designer-review.md](27-phase-a-rework-designer-review.md)。下文保留实施者的修复报告和历史门禁证据，不能将其“全部完成”口径作为最终验收。Issue 3 保持 OPEN。**

---

## 1. R-A1—R-A5 逐项返工、源码变更与行为证据

### R-A1：AST apply 策略重新发现、一致使用与真实队列持久回归
- **根因分析**：
  `packages/coding-agent/src/tools/ast-edit.ts` 在预览阶段（约第 301 行）捕获了初始 `encodingPolicy`。在 apply 闭包中，`freshPreview`、`validateChanges`、实际写入 `runAstEditOnce` 以及 Hashline 快照均复用了该旧闭包变量。当用户在预览后向 `.omp/encoding.json` 写入 `utf8` 或 `gbk` override 时，apply 仍然使用旧策略，导致 UTF-8 目标文件被错误当成 GBK 写入 `d6d0cec4` 混合字节，或 GBK override 无法抑制歧义附注。此外，Hashline 快照曾使用 `Bun.file().text()`（默认 UTF-8 解码），破坏 GBK 文件的快照记录。
- **源码修复**：
  1. `ast-edit.ts`：在 `apply` 执行时通过 `discoverEncodingPolicy(this.session.cwd)` 重新从磁盘发现有效策略，得到 `applyEncodingPolicy`，并传递给 `freshPreview`、`validateChanges(freshPreview, applyContext)` 和 `applyResult`，确保策略生命周期一致；
  2. `ast-edit.ts`：preview 和 apply 的 Hashline 快照均使用 `readTextWithPolicy(this.session.cwd, path, bytes).text` 按策略严格解码，禁止使用 `Bun.file().text()`；
  3. `ast-edit.ts`：`appliedAmbiguityNote` 严格基于 `applyResult.ambiguousEncodingFiles` 重新格式化，override 生效后不输出歧义附注。
- **持久回归（真实队列）**：
  在 `packages/coding-agent/test/gbk-encoding-ambiguity.test.ts` 中引入 `ToolChoiceQueue`、`peekPendingInvoker` 以及真实 `WriteTool.execute({ path: "xd://resolve", ... })`：
  - 用例 1（UTF-8 override）：preview 时为 GBK default，源文件为双合法 UTF-8；preview 后写入 `{ "glob": "src/ast.c", "encoding": "utf8" }`；通过 `xd://resolve` 实际 apply；验证 resolve 报告无歧义附注，且文件落盘严格为 UTF-8（不含 GBK `d6d0cec4`）；
  - 用例 2（GBK override）：preview 后写入 GBK override，resolve 成功，验证无歧义附注（override 抑制语义生效）；
  - 用例 3（过期源检查）：preview 后外部修改源文件破坏模式，resolve 正确拒绝并返回 `isError: true` 及 `Preview is stale`，源文件不被修改；
  - 验证 preview 期间源文件原始字节完全保持不变。

---

### R-A2：大文件流式读取原始字节直接捕获（杜绝二次编码规范化失真）
- **根因分析**：
  单区间与多区间读取此前通过 `encodeStrict(collectedLines.join("\n"), "gbk")` 回构诊断字节。对于合法的非规范 GBK 映射（如反例字节 `e0 a0 a2 e3 80 80`，严格合法于 UTF-8 和 GBK，GBK 解码为 `酄€€€`），GBK 编码器重新编码时会规范化为 `e0 a0 80 80 80`，破坏了 UTF-8 合法性，导致 >4 MiB 大文件流式读取漏报歧义。
- **源码修复**：
  1. `packages/coding-agent/src/tools/read.ts`：`ReadLineWindow` 接口增加 `collectedRawBytes?: Uint8Array`；
  2. `streamLinesFromFile`：在行收集时直接累积原始未处理的字节块（`Buffer.from(whole)`）及换行符 `0x0A`，输出准确的 `window.collectedRawBytes`；
  3. `collectLineWindowFromBuffer`：直接切片源 buffer 的 `bytes.subarray(windowStartByte, windowEndByte)` 作为 `window.collectedRawBytes`；
  4. 单区间与多区间（`#readLocalFileMultiRange`）读取完全废除 `encodeStrict` 回构，直接复用 `window.collectedRawBytes` 进行歧义诊断；
  5. 严格受 4 MiB 预算限制，不扫描未读尾部，不把窗口结论套用为整文件结论。
- **持久回归**：
  在 `gbk-encoding-ambiguity.test.ts` 中以 `e0 a0 a2 e3 80 80` + ASCII 行构造 >4 MiB 文件，验证标准读取 `:1-5`、`:1-5:raw` 和多区间 `:1-2,3-5` 均正确输出 `displayed window bytes are also valid UTF-8` 及 `(lines 1-8)` 窗口范围。

---

### R-A3：流式读取失败提示被前置 chunk 校验截断修复
- **根因分析**：
  `streamLinesFromFile` 在行切分前对每个读取 chunk 调用 `validationDecoder.decode(chunk, { stream: true })`。当 >4 MiB 文件第一行以 UTF-8 `// 中\n` 开头时，chunk 校验在首块立即抛出 `TypeError [ERR_ENCODING_INVALID_ENCODED_DATA]`，被外层 catch 包装为通用 GBK 错误，无法到达 `decodeLine` 的 UTF-8 确定性提示分支。
- **源码修复**：
  1. `packages/coding-agent/src/tools/read.ts`：在 `validationDecoder.decode(chunk)` 外增加针对 `encoding === "gbk"` 的 catch 保护，调用 `findGbkValidationFailureHint(chunk, lineIndex, filePath)`；
  2. `findGbkValidationFailureHint`：在当前 chunk 内按 LF 扫描完整行，调用 `decodeStrict(line, "gbk")` 定位首个失败行，并检查 `gbkDecodeFailureUtf8Hint`；若该行满足 valid UTF-8 and invalid GBK，直接抛出精准带行号 `(line 1)` 的 `ToolError`；
  3. chunk 末尾无 LF 的截断残片不提供确定性证明，不伪造整文件合法；
  4. 外层 catch 增加 `if (error instanceof ToolError) throw error;` 直通，确保确定性提示直接传至模型可见结果。
- **持久回归**：
  在 `gbk-encoding-ambiguity.test.ts` 中构造以 `// 中\nint x = 1;\n` 开头的 >4 MiB 文件，调用真实 `ReadTool` 读取 `:1-5`，准确抛出 `ToolError` 且明确指出 `(line 1): the displayed window bytes are valid UTF-8 and invalid GBK, so this cannot be a GBK window`。

---

### R-A4：AST 零替换分支丢失编码附注与列表上限省略修复
- **根因分析**：
  `packages/coding-agent/src/tools/ast-edit.ts` 中 `result.totalReplacements === 0` 提前 return 仅拼装了 parse/grammar 消息，丢弃了 `encodingAmbiguityNote`；同时原生层与 TS 聚合层对超过 10 个歧义文件未明确省略说明，只显示 10 个文件容易被误解为总数仅 10；多目标 Set 无总上限。
- **源码修复**：
  1. `ast-edit.ts`：`result.totalReplacements === 0` 分支追加 `${ambiguityMessage}`，确保零替换下歧义附注仍可见；
  2. `crates/pi-natives/src/ast.rs`：`AstFindResult` 与 `AstReplaceResult` 增加 `ambiguous_encoding_files_truncated: Option<bool>` 字段，当超过 10 个去重文件时置 true；
  3. `ast-grep.ts` 与 `ast-edit.ts`：多目标聚合严格受 10 个文件上限约束并传递截断标志；统一通过 `formatAstAmbiguityNote` 格式化，当截断时明确标注 `(further files omitted; total unknown)` 与 `…`。
- **持久回归**：
  在 `gbk-encoding-ambiguity.test.ts` 中验证零替换用例保留歧义附注；以 11 个双合法文件验证准确输出 `GBK policy decoded 10 searched file(s) (further files omitted; total unknown)`。

---

### R-A5：共享诊断严格前置条件、LSP 列表上限与 write 预算保护
- **根因分析**：
  `gbkUtf8AmbiguityNotice` 此前未校验 strict GBK 成功，导致对严格非法 GBK 的 UTF-8 输入也返回双合法；write 工具诊断读盘未受 4 MiB 预算限制且读失败静默吞掉；LSP 列表无上限渲染。
- **源码修复**：
  1. `packages/coding-agent/src/encoding/index.ts`：`gbkUtf8AmbiguityNotice` 增加严格 GBK 预检（`decodeStrict(bytes, "gbk")` 必须成功），与严格失败的 `gbkDecodeFailureUtf8Hint` 严格分流；
  2. `packages/coding-agent/src/tools/write.ts`：限制读盘大小 ≤4 MiB，读失败时显式输出 `encoding ambiguity precheck unavailable`，且不可表达字符抛错时确保 zero-write 原字节不被修改；
  3. `packages/coding-agent/src/lsp/tool.ts`：`formatLspEncodingNotes` 限制呈现上限 10 条，超出时明确标注 `[... and N more encoding note(s) omitted]`；
  4. `crates/pi-natives/src/encoding.rs`：`decode_source_strict` 增加 `DIAGNOSTIC_MAX_BYTES = 4 * 1024 * 1024`，超预算不跑整文件 UTF-8 ambiguity 检查。
- **持久回归**：
  在 `gbk-encoding-ambiguity.test.ts` 中验证 LSP 11 文件 workspace edit 测试返回 11 条 notes，验证 write 工具不可表达字符写盘测试触发 zero-write 保护且原字节完全不变。

---

## 2. 门禁验证结果与产物数据

| 门禁项 | 结果 | 细节数据与产物记录 |
| --- | --- | --- |
| `bun run build:native` | **PASS**（退出 0） | win32-x64-modern 优化构建，142 exports。`index.d.ts` 包含 `ambiguousEncodingFilesTruncated?: boolean`。 |
| **最新 native SHA256** | `4d7ee32ecc2be78e1dc6eba690aeee68c9ea4d8736537bd0e6c535879c2fd7c4` | 包含全部 R-A1—R-A5 Rust 原生字段、严格前置条件与预算限制。 |
| **九文件 GBK 回归套件** | **113 passed、0 failed、409 assertions**（退出 0） | 包含全部 R-A1—R-A5 持久回归（净增 8 个用例、26 个断言），耗时约 14.1 秒。 |
| **全仓 `bun check`** | **PASS**（退出 0） | oxfmt 5897 文件全过；oxlint 0/0；17 个包 TS 类型检查全过；Rust fmt / clippy 全过。 |
| **全仓 Rust 测试 `bun run test:rs`** | **3038 passed、4 skipped**（退出 0） | nextest: 3038 passed、4 skipped；runnable doctest: **1 passed**；doctest: **18 ignored**。 |
| `git diff --check` | **PASS**（退出 0） | 无空白冲突或换行异常。 |
| 契约更新 | **PASS** | [02-encoding-contract.md](02-encoding-contract.md) §9.1 已更新 Phase A 返工规范。 |

---

## 3. 九文件回归测试输出

```powershell
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts packages/coding-agent/test/gbk-encoding-ambiguity.test.ts packages/coding-agent/test/gbk-output-encoding.test.ts packages/coding-agent/test/gbk-output-chain.test.ts packages/utils/test/ptree-stderr.test.ts
```

输出：
```text
bun test v1.4.2 (744846f84)

 113 pass
 0 fail
 409 expect() calls
Ran 113 tests across 9 files. [14.12s]
```

---

## 4. 待验证清单与环境阻塞声明

1. **Unix 实机编译**：**UNVERIFIED（环境阻塞）**。本机无 WSL、无 Docker、无 Linux C 交叉编译工具链。保留事实阻塞，不以 Windows 编译替代。
2. **symlink containment 防护验证**：**ENVIRONMENT BLOCKED（环境阻塞）**。非特权 Windows 下测试夹具 `fs.symlink` 抛出 `EPERM`，不换 hardlink、不删测试。
3. **真实原生读取线程 abort 证明**：**UNVERIFIED**。真实原生读取线程硬中止端到端行为仍待具备可控同步机制的环境验证。
4. **后续阶段规划**：
   - Phase A 返工交付设计者复核；
   - 待 Phase A 验收通过后，再依 [23 号设计](23-next-phase-implementation-design.md) 继续执行 Phase B（PTY 输出解码协议）与 Phase C（eval 原始 bytes 协议）。
5. **发布与 Issue 状态**：
   - **Issue 3 保持 OPEN**。
   - 未执行 `git commit` 或 `git push`；
   - 未发布 Release，不覆盖 `v18.8.7-gbk.1`；
   - 未在 issue 发表评论，未修改 Codex memory。
