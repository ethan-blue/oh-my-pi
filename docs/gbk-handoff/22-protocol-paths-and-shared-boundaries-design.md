# 共享边界现状、协议覆盖与待办清单

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，基线 HEAD `0cbb33a59c`。所有修改均保留在工作树中（未提交）。
关联文档：[17-g4-g5-protocol-verification.md](17-g4-g5-protocol-verification.md)、[19-rework-final-review.md](19-rework-final-review.md)、[20-g4-g5-third-round-verification.md](20-g4-g5-third-round-verification.md)、[21-third-round-designer-review.md](21-third-round-designer-review.md)。

**设计者复核补充：本文件是当前入口与覆盖清单，未实现剩余路径，也未给出完整的新增接口、生命周期与验收设计。实际执行方案及已批准的范围见 [23 号文档](23-next-phase-implementation-design.md)，不能把本文件的现状限制当成禁止后续接入的合同。**

---

## 1. 背景与交付目标

设计者在 [21 号文档](21-third-round-designer-review.md) 第 7 节中已独立验收 R3 执行器持久回归修补（P2），判定为 **PASS**。本文件记录实际共享读取、写入、输出捕获入口的当前实现、诊断对象（整文件 vs 搜索/读取窗口）、复用机制、不可逆边界及待验证清单。新增接口、实现顺序与验收按 23 号执行。

---

## 2. 实际共享边界的当前实现

### 2.1 文本读取边界（`read` 工具）

- **入口**：`packages/coding-agent/src/tools/read.ts`
- **分界点**：`SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024`（4 MiB）
- **≤4 MiB 缓冲读取**：
  - **对象**：整文件字节（`wholeFileBytes`）。
  - **机制**：
    - 成功路径：若文件命中 GBK include 策略且未命中显式 override，调用 `gbkUtf8AmbiguityNotice(cwd, path, wholeFileBytes)` 进行字节有效性判定（无 BOM ∧ 含 >0x7F ∧ 严格合法 UTF-8）。若判定为双合法，在模型可见的首个文本块尾部追加 `[...提示用户当前按 GBK 解码，但字节也合法于 UTF-8...]`；选择器（`:raw`、行范围、摘要）仅控制呈现内容，不改变整文件诊断对象。
    - 失败路径：当 strict GBK 解码抛出异常时，通过 `gbkDecodeFailureUtf8Hint(path, wholeFileBytes)` 输出确定性结论：“字节合法于 UTF-8 且不合法于 GBK”。
- **>4 MiB 流式读取**：
  - **对象**：按需流式分块窗口（避免对数百 MB 甚至 GB 级大文件全量物化造成 OOM）。
  - **机制**：
    - 不设置 `wholeFileBytes`，不扫描未搜索的文件尾部以伪造整文件 UTF-8 证明；
    - 成功路径不输出歧义附注（不宣称未验证的结论）；
    - 失败路径退回通用指引（“Check the GBK policy; use an explicit utf8 override if this file is UTF-8”），不提供虚假的“确定性”判定。

### 2.2 文本编辑与写入边界（`edit` / `write` / `LSP` / `ast_edit`）

- **`edit` 工具（replace / patch / hashline 经 `#write`）**：
  - **入口**：`packages/coding-agent/src/edit/index.ts`（`#write` 与 `execute`）
  - **机制**：在首次写盘前，若目标为已有文件且文件大小 ≤ `EDIT_ENCODING_PRECHECK_MAX_BYTES`（4 MiB），尽力而为读取原字节并调用 `gbkUtf8AmbiguityNotice`。若存在歧义，收集至 `encodingNotes` 并随 `AgentToolResult` 文本块返回。落盘前通过 `assertSourceEncoding` 确保新内容字符可被目标编码严格表达。
- **`write` 工具**：
  - **入口**：`packages/coding-agent/src/tools/write.ts`
  - **当前范围**：没有为 G4 收集原文件歧义附注，目标编码经 `resolveWriteEncoding` + `assertSourceEncoding` + `encodeStrict("gbk")` 校验。这不是“工具永不读取旧文件”的保证：`assertNotTruncatedFileReadProjection` 在需要时会经 `readCurrentWriteSource` 读取旧文件。本轮设计者已在 23 号批准有限的诊断接入，不阻止覆盖写入、不自动改编码。
- **`LSP` 写入与 `ast_edit`**：
  - **入口**：`packages/coding-agent/src/lsp/edits.ts`、`packages/coding-agent/src/tools/ast-edit.ts`
  - **机制**：
    - LSP 读取阶段复用 TS `readTextWithPolicy`，写入前经 `precheckTextOpEncodings` 批量检查编码。
    - AST 的主要链路不同：`ast-edit.ts` 调用 native AST；`crates/pi-natives/src/ast.rs::read_candidate_source` 严格解码，`pending_writes` 在首次写入前检查所有候选输出。它没有调用 LSP 的 TS 预检函数；当前 GBK 失败主要返回 offset，不能把 LSP 的 UTF-8 确定性提示视为 AST 已覆盖。
    - 两者的预检能让可预测的编码/声明错误在落盘前失败，不能保证后续 I/O 错误、取消、外部并发时全批次原子回滚。LSP 的 `onExecuted` 还会报告已执行前缀；AST 随后逐文件写入。当前写入结果没有 G4 歧义附注，新增诊断按 23 号执行。

### 2.3 交互式与伪终端输出边界（`PTY`）

- **入口**：`crates/pi-natives/src/pty.rs` 与 `packages/coding-agent/src/tools/bash-interactive.ts`
- **机制**：
  - 底层原生实现：`pty.rs` 的读取线程直接使用 `pi_shell::output_decode::OutputDecoder::new()`（Windows ANSI / UTF-8 自动策略增量解码），解码器内置于 PTY 读取线程，目前不接收外部编码首选参数；
  - 上层交互表现：`BashTool` 在交互式 PTY 分支显式检测 `outputEncoding`。若用户传入显式参数，输出明确提示：`Ignored outputEncoding=...: the interactive PTY path decodes with the automatic UTF-8/Windows-ANSI policy`；
  - 结构字段：`BashInteractiveResult` 中的 `outputEncoding`、`outputReplacements`、`outputEncodings`、`outputEncodingUnknownReaders` 均保持 absent（undefined），不宣称未由协议捕获的来源。

### 2.4 评测运行时与子进程输出边界（`eval runner`）

- **入口**：`packages/coding-agent/src/eval/py/runner.py` 与 `packages/coding-agent/src/eval/py/executor.ts`
- **边界划分（二者严格分开）**：
  1. **原始 bytes 捕获边界（候补可接入）**：
     - 在 `runner.py` 中，`_CAPTURE_READ_FD` 管道通过守护线程 `_drain_captured_stdout` 读取用户代码衍生的子进程（未设 `stdout=PIPE` 的子进程继承 fd 1）写入的原始字节流。
     - 当前代码使用 `codecs.getincrementaldecoder("utf-8")("replace")` 解码后封装为 NDJSON stdout 帧。这是未来在 Python 进程级接入解码器与来源报告的可行原生字节边界。
     - 此 fd-1 管道贯穿 kernel 生命周期，读取时以 `_STATE.capture_rid` 归属请求；请求结束不等于管道 EOF。`!`/`_run_shell_body` 则有独立 `stdout=PIPE`，经 `_stream_process_output` 使用 locale 编码严格解码，不能把两条路径都描述成 UTF-8/replace，也不能共用一个跨请求的 decoder 摘要当作每次执行的完整来源。
  2. **用户代码内部错误 decode 边界（不可逆，非协议对象）**：
     - 用户在 Python 单元内部自行执行的代码（如 `bytes.decode("utf-8")` 处理 GBK 数据）在产生字符串时已完成替换或乱码生成。
     - 该字符串作为合法的 Python 内部数据进入后续流程，解码层无法知晓亦无法还原原字节，属于不可逆边界。

---

## 3. 完整协议路径覆盖矩阵

| 路径 | G4（文件歧义诊断） | G5（输出解码来源） | 边界与对象定义 |
| --- | --- | --- | --- |
| read ≤4 MiB（含 `:raw`/多区间/摘要） | **已覆盖** | 不适用 | 对象为 `wholeFileBytes` 整文件；成功时在首文本块附注歧义，strict GBK 失败时优先确定性提示。 |
| read >4 MiB 流式 | **未覆盖** | 不适用 | 对象为流式读取窗口；无整文件判定，不加尾部扫描，失败退回通用指引。 |
| grep（单文件/递归/流式） | **已覆盖** | 不适用 | 对象为实际搜索窗口（经 `transcode_search_strict`）；去重收集歧义文件并入 warningNote。 |
| edit（replace/patch/hashline 经 #write） | **已覆盖** | 不适用 | 写前对 ≤4 MiB 已有文件预检，附注随编辑结果返回。 |
| write 工具 | **未覆盖** | 不适用 | 不读原字节、无附注（协议面在 read/raw/grep/edit；写入路径加诊断须设计者批准）。 |
| LSP 读取 / LSP 写入 | 读取失败提示已覆盖；成功歧义/写入附注未覆盖 | 不适用 | LSP 经 TS `readTextWithPolicy` 和预检；不承诺 I/O 失败的整批事务。 |
| ast_edit 原生读取 / 写入 | 严格 codec 已接入；G4 成功歧义/确定性失败提示未覆盖 | 不适用 | native `read_candidate_source` 与 `pending_writes`，不是 TS LSP 调用链；不得把严格解码通过等同诊断协议全部覆盖。 |
| bash 内嵌 shell（单命令/链/管道/溢出） | 不适用 | **已覆盖** | 单读取方、逐段聚合、跳段零贡献、捕获溢出仍计、管道单读取方。 |
| bash `:async:` 后台 | 不适用 | **已覆盖** | 字段透传；超时/取消结果按未落定 absent。 |
| 受保护 build（双流 + full-stderr） | 不适用 | **已覆盖** | 双流聚合（两流一致为 uniform，两流不同保留混合来源）。 |
| PTY 交互路径 | 不适用 | **未覆盖** | 解码在 pty.rs（auto 语义），无显式参数/标注；`bash.ts` 中传入 `outputEncoding` 会产生忽略提示。 |
| eval runner fd-1 捕获边界 | 不适用 | **未覆盖** | kernel 生命周期管道，当前 UTF-8/replace；请求归属、残留多字节与完成边界须单独处理。 |
| eval runner `!` 子进程 | 不适用 | **未覆盖** | 每个子进程独立 PIPE，当前 locale/strict，经 `_stream_process_output`；可按每流生命周期接入。 |
| 用户代码内部错误 decode | 不适用 | **不适用（不可逆）** | 输入已是合法错误文本，非协议恢复对象。 |

---

## 4. 门禁验证结果与数字基线

| 门禁项 | 结果 | 细节指标与记录 |
| --- | --- | --- |
| **九文件 GBK 回归套件** | **97 passed、0 failed、366 assertions**（退出 0） | 包含 7 处 skipIf 守卫；包含经 `Shell.prototype.run` 接缝驱动真实 `executeBash` 与 `BashTool` 的 2 个持久回归。 |
| **全仓 `bun check`** | **PASS**（退出 0） | oxfmt（5897 文件）、oxlint（0/0）、全部 17 包 TS 类型检查、Rust fmt / clippy 全部通过。 |
| **全仓 Rust 测试 `bun run test:rs`** | **3038 passed、4 skipped**（退出 0） | nextest: 3038 passed、4 skipped；runnable doctest: **1 passed**；doctest: **18 ignored**。 |
| `git diff --check` | **PASS**（退出 0） | 无空白冲突或换行异常。 |
| **Native 二进制 SHA256 记录** | 实现者前次：`b439767f55434b702ba777ff69c0f299b3a7880e7eb5768ff6ff275dd97a0a29`<br>设计者独立重建：`8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480` | 普通 native 动态库不包含 `#[test]` 代码；新增 Rust 单测经 `test:rs` 执行。两次 hash 分别记录。 |

---

## 5. 待验证清单与环境阻塞声明

1. **Unix 实机编译**：**UNVERIFIED（环境阻塞）**。本机无 WSL、无 Docker、无 Linux C 交叉编译工具链。严格遵守约束不私自安装或修改权限，事实保留。
2. **symlink containment 防护验证**：**ENVIRONMENT BLOCKED（环境阻塞）**。非特权 Windows 下测试夹具 `fs.symlink` 抛出 `EPERM`，不换 hardlink、不删测试、不假冒通过。
3. **真实原生读取线程 abort 证明**：**UNVERIFIED**。目前已完成真实 `executeBash` 和 `BashTool` 在 `Shell.prototype.run` 接缝下的持久回归；真实原生读取线程硬中止端到端行为仍待具备可控同步机制的环境验证。
4. **GitHub Issue 3 状态**：维持 **OPEN**。未执行提交（commit）、推送（push）、发布（release）或 issue 关闭操作，不修改 Codex memory。

## 6. 设计者本轮审查边界（2026-10-11）

设计者静态核对了 read/write/LSP/native AST/PTY/Python runner 的实际入口，并校正上述链路和保证。第 4 节数字为已有实现基线/实现者报告，本轮文档审查没有重新执行全套测试；检查了磁盘 native hash 与 `git diff --check`，#3 仍 OPEN。不能把门禁数字当作尚未实现路径的验收。第 5 节真实 reader 未完成分支的“可控同步”是测试接缝工作，不能仅归为缺少外部主机环境；Unix/symlink 的环境阻塞单列保留。
