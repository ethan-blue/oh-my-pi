# Phase A（共享文件诊断）实现与验证交付记录

> 最新状态：用户授权设计者直接修复后，27 号剩余反例完成收口，当前证据见 [28-phase-a-direct-repair-verification.md](28-phase-a-direct-repair-verification.md)。本文件及下方审查说明是历史记录，保留，不代表最新 verdict。#3 仍 OPEN，未发布。

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，基线 HEAD `0cbb33a59c`。所有修改均保留在工作树中（未提交）。
关联依据：[23-next-phase-implementation-design.md](23-next-phase-implementation-design.md) 第 2 节 A1—A5。

**历史交付说明（2026-10-11）：本交付记录为第一轮实施记录。经 [25 号设计者复核](25-phase-a-designer-review.md) 判定不通过；实施者随后提交 [26 号返工报告](26-phase-a-rework-verification.md)。最新 [27 号设计者复核](27-phase-a-rework-designer-review.md) 认可已验证的修复，但 Phase A 整体验收仍为 FAIL；不能将历史门禁或实施者“全部完成”声明当作最终验收。Issue 3 保持 OPEN。**

---

## 1. Phase A（A1—A5）具体实现与代码文件

### A1. 扩展共享诊断语义（明确 file/window 作用域与已验证范围）
- **文件**：`packages/coding-agent/src/encoding/index.ts`
- **实现**：
  - 定义 `AmbiguityNoticeOptions { scope?: "file" | "window"; window?: { startLine?: number; lineCount?: number } }`。
  - `gbkUtf8AmbiguityNotice`：当 `options?.scope === "window"` 时，消息头追加 `(lines N-M)` 或 `(line N)`，正文描述调整为 `displayed window bytes are also valid UTF-8`；缺省时保持原整文件 `same bytes are also valid UTF-8` 文本，100% 保持向前兼容。
  - `gbkDecodeFailureUtf8Hint`：支持相同窗口选项，窗口模式下描述为 `displayed window bytes are valid UTF-8 and invalid GBK, so this window cannot be a GBK window`。
- **文件**：`crates/pi-natives/src/encoding.rs`
- **实现**：
  - 从 `transcode_search_strict` 抽取引擎级共享实现 `decode_source_strict(bytes, path, policy, context_hint)`，返回 `StrictDecodedSource { text, utf8_ambiguous }`。
  - 严格 GBK 解码失败时保留字节 offset，并在 bytes 满足严格合法 UTF-8 时追加确定性提示。`transcode_search_strict` 保留原 grep 专用上下文。

### A2. write 工具与 LSP 预检诊断接入
- **文件**：`packages/coding-agent/src/tools/write.ts`
- **实现**：
  - 在 `WriteTool.execute` 写盘前，对已有普通文件（`existing.isFile()` 且 ≤4 MiB）判断策略；若命中 GBK include/default 且无显式 override，尝试读取原字节进行 `gbkUtf8AmbiguityNotice` 判定。
  - 成功判定歧义时，将 `[...提示用户当前按 GBK 解码，但字节也合法于 UTF-8...]` 附注附加于结果文本块。
  - 新文件、显式 override、纯 ASCII、非 GBK 文件不进行读盘与附注；歧义仅提示，不阻止写入，落盘仍按严格 GBK。
- **文件**：`packages/coding-agent/src/lsp/edits.ts`、`src/lsp/client.ts`、`src/lsp/tool.ts`、`src/lsp/utils.ts`
- **实现**：
  - `edits.ts`：在 `precheckTextOpEncodings` 中复用已加载的 `state.bytes`（≤4 MiB），检查 `gbkUtf8AmbiguityNotice` 并收集到 `encodingNotes`（去重），避免额外重复读盘；`WorkspaceEditResult` 增加 `encodingNotes?: string[]` 字段；未满足 GBK 表达性时维持 zero-write 拒绝。
  - `client.ts`：`applyWorkspaceEditWithLsp` 返回 `WorkspaceEditApplyOutcome`（`string[] & { encodingNotes?: string[] }`），保持数组兼容性同时透传诊断。
  - `tool.ts`：在 `rename` 与 `code_actions` 结果中呈现 `encodingNotes`。
  - `utils.ts`：`applyCodeAction` 传播 `encodingNotes`。

### A3. AST 的原生诊断链路（不经 TS LSP，走原生 candidate）
- **文件**：`crates/pi-natives/src/ast.rs`
- **实现**：
  - `AstFindResult` 与 `AstReplaceResult` 增加 N-API 字段 `pub ambiguous_encoding_files: Option<Vec<String>>`。
  - `read_candidate_source` 改用 `crate::encoding::decode_source_strict`，返回 `(String, bool)`（包含 `utf8_ambiguous` 标记）。GBK 解码失败时返回带 offset 和 UTF-8 提示的错误。
  - `ast_find_blocking` 与 `ast_edit_blocking`：在候选文件读取时收集 `utf8_ambiguous` 文件（上限 10，独立于 `parse_errors`），设置到结果中。
  - 重新构建 native 产物，生成更新的 `packages/natives/native/index.d.ts` 与 `index.js`。
- **文件**：`packages/coding-agent/src/tools/ast-grep.ts`、`src/tools/ast-edit.ts`
- **实现**：
  - `ast-grep.ts`：多目标与单目标结果均收集 `ambiguousEncodingFiles`，在匹配或零匹配结果中作为警告附注呈现。
  - `ast-edit.ts`：`AstEditAggregatedResult` 增加 `ambiguousEncodingFiles`；在预览（dry-run `result`）和实际应用（`applyResult`）中分别呈现本次实际观察到的歧义文件附注。

### A4. read >4 MiB 的流式窗口诊断
- **文件**：`packages/coding-agent/src/tools/read.ts`
- **实现**：
  - `streamLinesFromFile`：在 `decodeLine()` 中，当严格 GBK 解码单行失败时，尝试 `gbkDecodeFailureUtf8Hint` 并附带窗口行号信息 `(line N)`。
  - 单区间读取（`ReadTool.execute`）：当 `fileSize > SNAPSHOT_MAX_BYTES`（4 MiB）且为 GBK include/default 管理文件时，对实际收集到的完整行文本（≤4 MiB 预算）进行 GBK 编码并执行 `gbkUtf8AmbiguityNotice`，输出带 `(lines N-M)` 的窗口歧义附注。
  - 多区间读取（`#readLocalFileMultiRange`）：在各区间的流式分块窗口中收集窗口歧义附注，存入 `notices`。
  - 不进行任何未搜索文件尾部扫描；尾部含有非法 UTF-8 字节不影响前面所读合法窗口的歧义诊断。

### A5. 行为验收套件
- **文件**：`packages/coding-agent/test/gbk-encoding-ambiguity.test.ts`
- **新增用例（8 个）**：
  1. `write tool pre-checks existing ambiguous file and attaches scoped notice`：写已有双合法文件附注歧义并落盘严格 GBK。
  2. `write tool to a new file raises no ambiguity notice`：新建文件无歧义附注。
  3. `write tool with an explicit utf8 override raises no ambiguity notice`：显式 override 抑制歧义附注。
  4. `LSP applyWorkspaceEdit returns encodingNotes for ambiguous files`：LSP 预检返回 `encodingNotes`。
  5. `AST grep reports ambiguous files in warning note`：ast_grep 在结果中报告歧义文件。
  6. `AST grep names proven UTF-8 bytes when GBK decode fails`：ast_grep 在 GBK 失败时报告确定性 UTF-8 提示。
  7. `AST edit preview and apply surface ambiguity note`：ast_edit 预览和应用均包含歧义附注。
  8. `streamLinesFromFile on >4 MiB file produces window-scoped ambiguity notice without tail scan`：>4 MiB 文件流式读取产出窗口级 `(lines 1-8)` 附注，尾部 0xFF 0xFF 字节不干扰窗口判定，无尾部扫描。

---

## 2. 最新完整协议路径覆盖矩阵

| 路径 | G4（文件歧义诊断） | G5（输出解码来源） | 边界与对象说明 |
| --- | --- | --- | --- |
| read ≤4 MiB（含 `:raw`/多区间/摘要） | **已覆盖** | 不适用 | 对象为 `wholeFileBytes` 整文件；成功时在首文本块附注歧义，strict GBK 失败时优先确定性提示。 |
| read >4 MiB 流式 | **已覆盖（窗口级）** | 不适用 | 对象为所读取的行窗口（≤4 MiB 预算）；成功标注带 `(lines ...)` 窗口附注，行失败给行级提示；不扫描未读尾部，不把窗口合法性套用为整文件合法性。 |
| grep（单文件/递归/流式） | **已覆盖** | 不适用 | 对象为实际搜索窗口（经 `transcode_search_strict`）；去重收集歧义文件（上限 10）并入 warningNote。 |
| edit（replace/patch/hashline 经 #write） | **已覆盖** | 不适用 | 写前对 ≤4 MiB 已有文件预检，附注随编辑结果返回。 |
| write 工具 | **已覆盖** | 不适用 | 对已有普通文件（≤4 MiB，GBK default）写前预检附注，写入不因歧义被阻止，落盘仍按严格 GBK；新文件/override/未管理不读盘。 |
| LSP 文本修改（rename / code_actions） | **已覆盖** | 不适用 | 在 `precheckTextOpEncodings` 复用已加载 bytes 收集 `encodingNotes` 并呈现；编码预检失败维持 zero-write。 |
| AST（ast_grep & ast_edit） | **已覆盖** | 不适用 | 原生 `read_candidate_source` 复用 `decode_source_strict`，失败附确定性提示，成功返回 `ambiguous_encoding_files`；preview 与 apply 分别呈现。 |
| bash 内嵌 shell（单命令/链/管道/溢出） | 不适用 | **已覆盖** | 单读取方、逐段聚合、跳段零贡献、捕获溢出仍计、管道单读取方。 |
| bash `:async:` 后台 | 不适用 | **已覆盖** | 字段透传；超时/取消结果按未落定 absent。 |
| 受保护 build（双流 + full-stderr） | 不适用 | **已覆盖** | 双流聚合（两流一致为 uniform，两流不同保留混合来源）。 |
| PTY 交互路径 | 不适用 | **待 Phase B** | 解码在 pty.rs（auto 语义），无显式参数/标注；`bash.ts` 中传入 `outputEncoding` 会产生忽略提示。 |
| eval runner 捕获边界（fd-1、`!` 子进程） | 不适用 | **待 Phase C** | runner 仍接触原始 bytes，是可接入本协议的真实边界；与用户代码内部错误 decode 严格分开。 |
| 用户代码内部错误 decode | 不适用 | **不适用（不可逆）** | 输入已是合法错误文本，非协议恢复对象。 |

---

## 3. 门禁验证结果与日志数据

| 门禁项 | 结果 | 细节数据与产物记录 |
| --- | --- | --- |
| `bun run build:native` | **PASS**（退出 0） | win32-x64-modern 优化构建，142 exports。`index.d.ts` 自动生成包含 `ambiguousEncodingFiles` 字段。 |
| **最新 native SHA256** | `625f95ea884fbe31b79b5633ebc64aaa68b4ffa4c3e4f17c84e6d285d679828e` | 包含 Phase A Rust 共享解码与 AST 歧义收集的新本地二进制。 |
| **九文件 GBK 回归套件** | **105 passed、0 failed、383 assertions**（退出 0） | 净增 8 个 A5 行为回归用例，耗时约 9.3 秒。 |
| **全仓 `bun check`** | **PASS**（退出 0） | oxfmt 5897 文件全过；oxlint 0/0；17 个包 TypeScript 类型检查全过；Rust fmt / clippy 全过。 |
| **全仓 Rust 测试 `bun run test:rs`** | **3038 passed、4 skipped**（退出 0） | nextest: 3038 passed、4 skipped；runnable doctest: **1 passed**；doctest: **18 ignored**。 |
| `git diff --check` | **PASS**（退出 0） | 无空白冲突或换行异常。 |

---

## 4. 九文件回归测试命令与实际输出

```powershell
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts packages/coding-agent/test/gbk-encoding-ambiguity.test.ts packages/coding-agent/test/gbk-output-encoding.test.ts packages/coding-agent/test/gbk-output-chain.test.ts packages/utils/test/ptree-stderr.test.ts
```

输出：
```text
bun test v1.4.2 (744846f84)

 105 pass
 0 fail
 383 expect() calls
Ran 105 tests across 9 files. [9.34s]
```

---

## 5. 待验证清单与环境阻塞声明

1. **Unix 实机编译**：**UNVERIFIED（环境阻塞）**。本机无 WSL、无 Docker、无 Linux C 交叉编译工具链。保留事实阻塞，不以 Windows 编译替代。
2. **symlink containment 防护验证**：**ENVIRONMENT BLOCKED（环境阻塞）**。非特权 Windows 下测试夹具 `fs.symlink` 抛出 `EPERM`，不换 hardlink、不删测试。
3. **真实原生读取线程 abort 证明**：**UNVERIFIED**。真实原生读取线程硬中止端到端行为仍待具备可控同步机制的环境验证。
4. **后续阶段规划**：
   - Phase B：PTY 输出解码协议接入（参数与来源报告透传）；
   - Phase C：eval 原始 bytes 协议接入（`runner.py` 原始字节 NDJSON 帧传输并在 host 端复用 native decoder 解码）。
5. **发布与 Issue 状态**：
   - **Issue 3 保持 OPEN**。
   - 未执行 `git commit` 或 `git push`；
   - 未发布 Release，不覆盖 `v18.8.7-gbk.1`；
   - 未在 issue 发表评论，未修改 Codex memory。
