# Phase A 直接修复与最终验证

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`。
分支：`feat/gbk-text-io`；HEAD：`0cbb33a59cfe256f931735042b7101cb4f901ca9`。
依据：[23 号设计](23-next-phase-implementation-design.md)、[25 号审查](25-phase-a-designer-review.md)和[27 号独立返工审查](27-phase-a-rework-designer-review.md)。用户已授权设计者直接参与修复。

**结论：27 号已复现的 R-A3/R-A4/R-A5 剩余问题完成修复，Phase A 本轮收口 PASS。此前认可的 R-A1/R-A2 保留并通过最终回归。这里的 PASS 限于共享文件诊断、下列工具行为与本机门禁；不代表 PTY/eval 后续阶段、Unix、真实模型或 E630 已验收，也不代表已发布。**

全部既有未提交修改保留，未 reset/restore。没有提交、推送、发布、覆盖旧 ZIP、评论或关闭 #3，也没有修改 memory。#3 的既有 OPEN 状态未改变。

## 1. 先复现，再修复

先将 27 号的三个实际反例加入 `packages/coding-agent/test/gbk-encoding-ambiguity.test.ts`，仅选择这三个回归运行：**修复前 0 passed / 3 failed；第一轮针对性修复后 3 passed / 0 failed / 17 assertions**。这不是把历史 113 项通过当作缺陷已消除。

| 问题 | 直接修复 | 持久行为证据 |
| --- | --- | --- |
| R-A3：chunk 首段被误作完整行 | `tools/read.ts` 的失败诊断接收已有 `currentLineLength/currentLineChunks`，先核对已保留的完整前缀，再有界拼接原始完整行；未保存前缀或未取得完整行不作确定性证明 | `8191×61 + 81 e4 b8 ad 0a` 跨块行严格 GBK 合法、UTF-8 非法；后续 `ff` 触发严格读取失败，但不再伪称第 1 行是 UTF-8 |
| R-A3：范围和不完整状态 | 已扫描但不在所选范围的行使用 `checked window bytes`；残片/缺前缀使用 unavailable，保留实际严格解码错误 | 跨块完整 UTF-8/GBK 失败行仍给准确行级证明；读取第 1000 行时前缀失败不叫 displayed window；未终止非法片段报告 fragment 且原 bytes 不变 |
| R-A4：stale apply 丢掉 fresh 附注 | `tools/ast-edit.ts` 在 stale 分支之前生成本次 `applyResult` 的共享诊断文本，并附到保留错误状态的结果 | 真实 ToolChoiceQueue + WriteTool `xd://resolve`：新源双合法时显示 fresh 附注；新源 ASCII 时不沿用 preview 附注；两种场景均 isError、源 bytes 不变 |
| R-A5：读完才检查预算 | `encoding/index.ts::readGbkAmbiguityDiagnostic` 用 `Bun.file().slice(0, 4MiB + 1).bytes()`，探测字节只判断超额；write 复用这个入口 | 实际 WriteTool 的受控 stat→增长边界，真实文件增长为 4MiB+1024；第一笔诊断获取不超过 4MiB+1，结果报告 budget，正常授权保存仍成功 |
| R-A5：I/O 失败静默 | 有界诊断读取失败返回 `unavailable/io`；write 呈现附注，正常保存校验独立执行 | 只让诊断 slice 的 bytes 失败，真实 WriteTool 最后写入正确内容，并明确说明诊断未取得 |
| 补充 R-A1：嵌套策略使 TS/native 判断不一致 | `resolveFileEncoding/readTextWithPolicy` 支持显式捕获策略；AST preview/apply 分别将本次发现的同一策略传入 native、稳定性预检与快照，null 显式表示本次无策略，禁止意外再次 discovery | GBK 会话下嵌套 UTF-8 配置导致非规范 GBK bytes 的稳定性保护被跳过；新增真实预览回归修复前 0/1，修复后预览和 queued apply 都拒绝规范化、bytes 不变，失败的 action 仍保留可处理 |

stat→增长用例使用临时文件及同步进度回调构造确定性故障接缝；不是声称抓到了实际外部进程的偶然竞争。记录新增诊断读取与原保存稳定性校验读取分别计算，未削弱后者。

## 2. 共享状态和原生贯通

### TypeScript

`src/encoding/index.ts` 扩展现有 helper，复用 native strict codec、matcher 和 UTF-8 predicate：

| 字段 | 语义 |
| --- | --- |
| `kind` | ambiguous、checked、invalid-gbk、invalid-gbk-utf8、not-applicable、unavailable 分开；未检查不能当作没有歧义 |
| `scope` | file 或 window；窗口证明不外推整文件 |
| `checkedRange` | 实际检查的字节数；窗口另带起始行和行数；unavailable 的已完整检查字节数为 0 |
| `complete` | 是否得到该诊断范围的完整证据；not-applicable 不声称完成字符集验证 |
| `reason` | unavailable 的 budget、io 或 fragment 原因 |
| `notice` | 按实际状态提供可见文本；无资格的路径保持静默 |

先判定是否为 GBK default 且没有 override，再做额外诊断。完整 ASCII 无附注，显式 UTF-8/GBK override 不附歧义或额外不可用提示。既有 BOM 冲突、严格编码拒绝和 zero-write 保护保留。

write 与 edit 共用有界获取函数，避免 edit 继续使用 `.bytes()` 后才比大小的旧路径。新增真实 EditTool 大文件回归证明：诊断超预算可见，授权替换仍正确保留其他 bytes。这个上限约束新增诊断，不代表正常编辑引擎无需读取全文。

有界 helper 只将获取 bytes 的异常归为 io；读取成功后策略解析/严格配置错误照常抛出。新增无效 encoding.json 回归防止把错误策略伪装成“诊断读失败”。

read 使用已捕获原 bytes，保留非规范 GBK 映射测试。诊断副本累计之前检查 4MiB；超过时丢弃诊断集合并标 budget，不保留整窗后再检查。非 GBK 流式读取不再建立这份诊断副本。只显示截断预览、没有完整行时标 fragment。当前公开 read 参数还受到原有行数/显示预算限制；大范围实际测试验证的是所保留窗口与截断预览，不冒称通过参数制造了大于 4MiB 的诊断窗口。

LSP 在现有预检 bytes 上收集状态，超预算返回 unavailable 附注，不新增全文读取，不阻止原本合法的编辑。

### Rust / N-API / AST

`crates/pi-natives/src/encoding.rs` 的既有 `StrictDecodedSource` 增加 `SourceDiagnostic`，区分 NotApplicable、Checked、Ambiguous、Unavailable。AST 从 `read_candidate_source` 将专用诊断传入现有返回对象；超预算只跳过额外 UTF-8 证明，正常严格解码和解析继续。

新字段 `encodingDiagnostics` / `encodingDiagnosticsTruncated` 为可选，行对象含 path、kind、scope、checkedByteLength、complete、reason。当前输出的行是 ambiguity 或 unavailable；普通 checked/not-applicable 不增加模型噪声。原 `ambiguousEncodingFiles` 字段保留兼容，不将诊断塞进 parseErrors。

`tools/ast-grep.ts` 与 `tools/ast-edit.ts` 共用 `formatAstEncodingNotes` / `mergeAstDiagnosticEvidence`，保留路径重基、去重、总上限 10 和未知总数省略说明；preview、apply、zero、stale 分支呈现各次实际观察。

新增 native 真实调用 + 两个 AST 工具的大文件测试验证 DLL 已序列化 unavailable/budget/file/complete=false/checkedByteLength=0。Windows 路径按原 native canonical 形式带长路径前缀，测试使用系统 `path.toNamespacedPath` 精确比较，未修改断言来忽略路径。

## 3. 消费者覆盖矩阵

| 路径 | 本轮证据与范围 | 限制 |
| --- | --- | --- |
| read ≤4MiB、raw | 既有整文件双合法/严格失败、override、ASCII、BOM 回归 | 不自动选择原编码 |
| read >4MiB 普通/raw/多区间 | 保留原字节窗口回归；新跨块完整行、seek 前缀、非法片段、截断预览测试 | 只有实际保留范围；不作整文件证明，不新增尾部诊断扫描 |
| write | 实际工具歧义、预算边界、受控增长、诊断 I/O 失败、emoji zero-write | 诊断获取有界；原保存验证可能读取全文，无整批原子性承诺 |
| edit | 小文件 bytes 稳定回归、大文件预算附注与实际替换 | 正常引擎/保存读取和诊断预算分开 |
| LSP 内部预检 | 11 applied / 11 notes 的内部结果回归保留；新增大文件 budget、合法编辑仍成功 | 内部完整操作数不等于工具显示数 |
| LspTool rename/code_actions | 两个真实消费者通过既有 JSON-RPC client、WorkspaceEdit 预检与落盘：11 文件都修改，最终 10 条附注 + 1 条省略计数 | 复用 fake LSP transport，不是外部 clangd、真实模型或用户工程证明 |
| AST grep | native 结果、真实工具、11 文件列表与大文件 unavailable | 原生正常全文解析不计为新增诊断扫描 |
| AST edit | 多目标 11 文件最终集合、zero、真实 queued apply、fresh stale 诊断与 bytes | 预览后 override 修复仍通过；并非任意外部并发修改下的文件系统事务 |
| grep | 既有严格失败、双合法和窗口回归继续通过 | 本轮新增 AST metadata 不扩称已给所有 grep 模式新增 unavailable 结果 |
| Hashline | 原有快照和列截断相邻回归、GBK policy 路径继续通过 | 未新增完整真实模型编辑过程证明 |
| PTY / eval | 本轮不改，仍按 23 号 B/C 后续实施 | 不能用文件诊断通过宣称其原始输出已接入 |

rename 测试最初遗漏项目加载完成通知而超时；已复用现有 progress begin/end 协议修正 fake 服务，不增加 timeout、不 mock 实际 applyWorkspaceEdit。两消费者断言实际收到 rename/codeAction 请求、最终正文及全部文件内容。

R-A1 原 preview 闭包过期反例继续通过；本轮又实测并修复嵌套目录策略导致的稳定性预检偏差。preview 与 apply 各自在开始时 discovery，本次 native 输入、TS validateChanges 与快照解码均显式复用该策略；后续 apply 重新发现磁盘配置。没有为此新增第二套 codec/matcher，也不把绑定编码选择宣称为能抵抗任意外部并发文件改写的文件系统事务。

## 4. 最终门禁与产物

| 门禁 | 最终结果 |
| --- | --- |
| `bun run build:native` | PASS，退出 0；win32-x64-modern 优化构建 2m51s，142 exports；仍有 1 条既有 linker warning |
| native SHA256 | `aef2be78aa3397f33435020f4c38b94cf7a759c5a93bf636632d6bb50e65845c` |
| 九文件 GBK | PASS，**127 passed / 0 failed / 464 assertions**，15.92s；27 号基线 113 增加 14 个持久用例 |
| 完整 `tools/lsp-regressions.test.ts` | PASS，**126 passed / 5 skipped / 0 failed / 459 assertions**；新增两个消费者包含在此数字中，不重复计数 |
| 五文件相邻 read/AST/edit | PASS，**31 passed / 0 failed / 117 assertions** |
| `bun check` | PASS，退出 0；oxfmt 5897 文件、oxlint、17 包类型检查、cargo fmt/clippy `-D warnings` |
| `bun run test:rs` | PASS，**3038 passed / 4 skipped**；runnable doctest 1 passed、18 ignored；本轮没有新增 Rust 测试，不虚报增长 |
| `git diff --check` | PASS，退出 0；最终文档更新后再核对 |

Rust 源码稳定后重建 native，后续仅 TS/文档调整，全部最终原生 TS 测试使用上表产物。绑定由 build:native 生成，未手工修改；本轮没有新增 RPC wire 字段，无需再次 gen:rpc。

初次 bun check 在测试 wrapper 的 Bun.file/slice 重载转发处发现 4 个类型错误，已改为保留 BunFile 类型的 Reflect.apply，针对性 I/O 回归重跑通过。最终全仓检查在所有源码修复之后重新运行退出 0，不将前次失败隐藏为通过。

测试曾错误假设公开 read 参数可得到大于 4MiB 的窗口，实际受现有行数/显示预算限制。最终回归明确验证所保留完整窗口和截断-only 预览，不放宽完整性断言来声称超预算真实工具路径已发生。

日志均在 `%TEMP%`：`ompg-direct-repair-before.log`、`ompg-direct-repair-first.log`、`ompg-direct-repair-native.log`、`ompg-direct-repair-gbk.log`、`ompg-direct-repair-check.log`、`ompg-direct-repair-rust.log`、`ompg-direct-repair-lsp.log`、`ompg-direct-repair-adjacent.log`、`ompg-direct-repair-io.log`、`ompg-direct-repair-edit-budget.log`、`ompg-direct-repair-policy-before.log`、`ompg-direct-repair-policy-after.log`。日志不提交仓库。

## 5. 复跑入口与兼容边界

```powershell
bun run build:native
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts packages/coding-agent/test/gbk-output-encoding.test.ts packages/coding-agent/test/gbk-output-chain.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-encoding-ambiguity.test.ts packages/utils/test/ptree-stderr.test.ts
bun test packages/coding-agent/test/tools/lsp-regressions.test.ts
bun test packages/coding-agent/test/read-single-pass.test.ts packages/coding-agent/test/read-multi-range.test.ts packages/coding-agent/test/read-column-truncation-snapshot.test.ts packages/coding-agent/test/legacy-pi-ast-behavior.test.ts packages/coding-agent/test/edit-blackbox.test.ts
bun check
bun run test:rs
git diff --check
```

诊断是附注而非新增自动转换机制。未管理 UTF-8、显式 override、正常严格保存、Hashline、既有输出来源字段和执行前缀契约保留；AST 新字段可选，但旧 native 不能提供新 metadata，源码与 native 仍须成套构建/交付。未声称修改上游 core 后未来版本零维护，也未完成性能基准或发布安装验证。

## 6. 后续状态

1. 保留 24/26 实施报告及 25/27 审查提示，增加本轮最终入口，不覆盖历史失败证据。
2. 23 号 B（PTY）、C（eval）尚未实施；按其生命周期和原始 bytes 合同继续，不能靠默认 UTF-8/0 填充未知来源。
3. Unix 实机、symlink containment 的 Windows EPERM、真实 native reader abort、真实模型/E630 仍是先前 UNVERIFIED / ENVIRONMENT BLOCKED；本轮未安装 WSL、未改权限或替换测试。
4. 尚未 commit/push/release/关闭 #3；后续发布仍需新版本号、下载验包及完整范围验收，不覆盖 v18.8.7-gbk.1。
