# Issue 3 G4/G5 第三轮验证与返工交付记录

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，基线 HEAD `0cbb33a59c`。所有修改均保留在工作树中（未提交）。前续交接文档：[17-g4-g5-protocol-verification.md](17-g4-g5-protocol-verification.md)、[18-g4-g5-designer-review.md](18-g4-g5-designer-review.md)、[19-rework-final-review.md](19-rework-final-review.md)、[21-third-round-designer-review.md](21-third-round-designer-review.md)。

**结论：已按 21 号设计者独立复核要求完成 R3 执行器边界持久回归与口径校正。已测试的 Windows 实现范围通过；整体 issue 3 仍保持 OPEN，未提交、推送、发布、评论或关闭。**

---

## 1. 逐项状态与执行结果（对照 19/21 号复核要求）

| 序号 | 任务项 | 状态 | 实际结果与证据校正 |
| --- | --- | --- | --- |
| 1 | Unix 实机编译环境核查 | **UNVERIFIED（环境阻塞）** | 查询 WSL 返回退出码 1（系统提示未安装 WSL）；Docker 未安装（`where docker` 查无结果）；本机无 Linux C 交叉编译工具链（pcre2-sys 构建脚本受阻）。严格遵循约束：**不自动安装 WSL、不修改用户系统权限、不删除依赖或测试假冒通过**，事实保留为环境阻塞，留待真实 Unix 环境复核。 |
| 2 | R3 持久消费方回归与原生捕获证明边界 | **PASS（执行器及消费方持久回归） / UNVERIFIED（真实原生线程终止端到端）** | 证据分层明确区分：<br>1. **Executor 结构回归**：复用 `Shell.prototype.run` 接缝（非直接 mock 执行器），由真实 `executeBash` 运行。断言 `outputEncoding` 与 `outputReplacements` 必须为 `undefined`（负契约），`outputEncodings` 与 `outputEncodingUnknownReaders` 完整保留。此断言能有效捕捉执行器把 undefined 误设为默认值或丢失来源字段的退化。<br>2. **BashTool Formatter 格式化回归**：在同一接缝下调用真实 `BashTool`，调用链经真实执行器生成包含 `output decode provenance incomplete (1 output reader(s) did not finish); observed: GBK via the Windows ANSI code page (cp936) — the encoding of some output is unknown` 的提示，且不声明统一 UTF-8/cp936。纯未知分支（2 unknown readers）正确输出无 `observed:` 前缀的提示。<br>3. **Rust 聚合单测**：在 `crates/pi-shell/src/shell.rs` 新增 `provenance_with_unknown_readers_withholds_totals_and_uniform` 单测，直接检验 `ShellRunResult::with_provenance` 在有未知 reader 时严格将 uniform 与 total 设为 `None`，保留 `output_encodings` 与 `output_encoding_unknown_readers`。<br>4. **N-API 桥**：`pi-natives` 结构字段映射通过。<br>5. **真实原生线程终止端到端证明**：UNVERIFIED。明确将上述 mock 边界回归与真实原生读取线程被 abort 的端到端证明分开，不以 mock 推定真实线程终止。 |
| 3 | symlink containment 防护验证 | **ENVIRONMENT BLOCKED（环境阻塞）** | 本机环境运行 probe：Windows 环境下由于未开启开发者模式且无 `SeCreateSymbolicLinkPrivilege` 特权，`fs.symlink` 抛出 `EPERM: operation not permitted`，此为测试夹具在非特权环境下的系统阻塞，并非产品逻辑失败。严格遵循约束：**不能换成 hardlink 称通过、不能修改系统权限或跳过测试后报通过**，保持 ENVIRONMENT BLOCKED。 |
| 4 | 剩余协议路径边界（按 17/20 号覆盖矩阵核定） | **已核定（详见第 2 节矩阵）** | 详见下文路径覆盖矩阵。明确各路径对象是整文件还是搜索/读取窗口，复用已有 decoder/codec，不扫描未搜索大文件尾部，不添加频率猜测。PTY 交互在 `bash.ts` 中显式附注提示忽略参数；用户代码内部错误 decode 后的合法字符串不可逆。 |
| 5 | 跨主机测试跳过口径与负缓存 TTL 模拟时钟 | **PASS** | 1. **跨主机跳过口径**：`packages/coding-agent/test/gbk-output-chain.test.ts` 中共有 **7 处** `it.skipIf(!hostAcpIsCp936())`。本轮在当前 CP936 主机上验证全部执行通过，未实跑非 CP936 主机的跳过报告。<br>2. **负缓存 TTL 模拟时钟**：在 `packages/coding-agent/test/gbk-validation.test.ts` 的 `a newly created policy is found once the negative TTL passes (R4)` 中，在**第一次 discovery 前**通过 `spyOn(Date, "now").mockImplementation(() => simulatedTime)` 冻结时钟，在异步创建目录、写入文件及 `fs.utimes` 期间保持时钟完全冻结；在断言 TTL 内负缓存命中后显式推移 `simulatedTime += 1100`，彻底消除异步 I/O 耗时超过 TTL 导致的偶发时序失败，无 sleep、无放宽断言。 |

---

## 2. 路径覆盖矩阵（逐路径边界与对象）

| 路径 | G4（文件歧义诊断） | G5（输出解码来源） | 边界与对象说明 |
| --- | --- | --- | --- |
| read ≤4 MiB（含 `:raw`/多区间/摘要） | 已覆盖 | 不适用 | 该分支通过 `wholeFileBytes` 缓冲整文件进行歧义判定，选择器控制展示范围（非 grep 式搜索窗口）；成功时附注歧义，strict GBK 失败时优先确定性提示。 |
| read >4 MiB 流式 | 未覆盖 | 不适用 | 诊断对象为流式读取；无整文件 UTF-8 判定，不标注歧义、失败仅通用指引；不加未搜索尾部扫描，不宣称未验证结论。 |
| grep（单文件/递归/流式） | 已覆盖 | 不适用 | 诊断对象为实际搜索窗口；去重收集歧义文件（上限 10）并入 warningNote。 |
| edit（replace/patch/hashline 经 #write） | 已覆盖 | 不适用 | 写前预检（≤4 MiB 尽力而为），附注随编辑结果。 |
| write 工具 | 未覆盖 | 不适用 | 不读原字节、无附注（协议面在 read/raw/grep/edit；写入路径加诊断或阻止须设计者批准）。 |
| LSP 读取 / LSP 写入 / ast_edit | 读取已覆盖（失败提示） | 不适用 | 写入结果无歧义附注（未覆盖）。 |
| bash 内嵌 shell（单命令/链/管道/溢出） | 不适用 | 已覆盖 | 单读取方、逐段聚合、跳段零贡献、捕获溢出仍计、管道单读取方。 |
| bash `:async:` 后台 | 不适用 | 已覆盖 | 字段透传；超时/取消结果按未落定 absent。 |
| 受保护 build（双流 + full-stderr） | 不适用 | 已覆盖 | 双流聚合（两流一致为 uniform，两流不同保留混合来源）。 |
| PTY 交互路径 | 不适用 | 未覆盖 | 解码在 pty.rs（auto 语义），无显式参数/标注；`bash.ts` 中若传入 `outputEncoding` 会产生忽略提示。 |
| eval runner 捕获边界（fd-1、`!` 子进程） | 不适用 | 未覆盖（候补） | runner 仍接触原始 bytes，是可接入本协议的真实边界，当前未接入；用户代码内部错误 decode 后的合法字符串不可恢复。 |
| 用户代码内部错误 decode | 不适用 | 不适用（不可恢复） | 输入已是合法错误文本，非协议恢复对象。 |

---

## 3. 门禁验证结果与日志数据

| 门禁项 | 结果 | 细节指标与产物记录 |
| --- | --- | --- |
| `bun run build:native` | **PASS**（退出 0） | 本地 win32-x64-modern 优化构建，142 exports。普通 native 库由当前源码构建，不包含 `#[test]` 代码。 |
| **native SHA256 记录** | 实现者前次：`b439767f55434b702ba777ff69c0f299b3a7880e7eb5768ff6ff275dd97a0a29`<br>设计者重建：`8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480` | 两次产物 hash 不同，未执行可复现构建审计，具体差异原因未验证；分开记录，不混充为同一次构建。新增 Rust 单测另经 `test:rs` 独立执行。 |
| **九文件 GBK 回归套件** | **97 passed、0 failed、366 assertions**（退出 0） | 包含 7 处 skipIf 条件跳过守卫；包含经 `Shell.prototype.run` 接缝驱动真实 `executeBash` 与 `BashTool` 的 2 个持久回归，断言数净增至 366。 |
| **全仓 `bun check`** | **PASS**（退出 0） | 1. `oxlint`: 0 错误 0 警告<br>2. `oxfmt`: 5897 个文件全部格式正确<br>3. TypeScript: 全部 17 个包类型检查一次性通过<br>4. Rust: `cargo fmt --check` 与 `cargo clippy -D warnings` 干净通过。 |
| **全仓 Rust 测试 `bun run test:rs`** | **3038 passed、4 skipped**（退出 0） | nextest: 3038 passed、4 skipped；runnable doctest: **1 passed**；doctest: **18 ignored**（按 21 号要求分开统计）。 |
| `git diff --check` | **PASS**（退出 0） | 无空白冲突或换行异常。 |
| symlink containment 用例 | **ENVIRONMENT BLOCKED** | 保持原有环境阻塞状态，不篡改、不假冒通过。 |
| Unix 实机编译 | **UNVERIFIED** | 本机无可用工具链，如实记录阻塞，不以 Windows 编译替代。 |

---

## 4. 九文件回归测试命令与实际输出

```powershell
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts packages/coding-agent/test/gbk-encoding-ambiguity.test.ts packages/coding-agent/test/gbk-output-encoding.test.ts packages/coding-agent/test/gbk-output-chain.test.ts packages/utils/test/ptree-stderr.test.ts
```

输出：
```text
bun test v1.4.2 (744846f84)

 97 pass
 0 fail
 366 expect() calls
Ran 97 tests across 9 files. [16.91s]
```

---

## 5. GitHub 与发布状态

- **Issue 3 保持 OPEN**：未执行关闭、评论操作。
- **Git 状态**：工作树代码保留，未执行 `git commit` 或 `git push`。
- **发布状态**：未创建或发布新版本，未覆盖 `v18.8.7-gbk.1`。
- **Codex Memory**：未做任何修改。
- 全部交付物等待设计者复核。

## 6. 定点修补设计者验收与证据限定（2026-10-11）

第 1 节 R3 的 **Executor / BashTool 持久回归 PASS**，设计者已独立复跑九文件 97/0、366 assertions，单独 R3 2/0、17 assertions，`bun check` 退出 0，Rust 3038 passed/4 skipped、doctest 1 passed/18 ignored。完整验收及后续交接见 [21 号第 7 节](21-third-round-designer-review.md#7-p2-定点修补最终验收2026-10-11最新)。本次定点修补已通过，整体 #3 尚未完成。

第 1 节的“N-API 桥映射通过”限于源码映射、类型/编译核对，以及已有普通已知/混合来源 native 回归；**未知 reader 穿过 N-API 的真实端到端行为仍 UNVERIFIED**。新的 Shell.run spy 回归验证真实执行器和消费者，不能把该 mock 作为原生桥或实际 reader abort 的证明。两次 native hash 的差异原因未审计，不能据此推定环境变量或时间戳为根因。
