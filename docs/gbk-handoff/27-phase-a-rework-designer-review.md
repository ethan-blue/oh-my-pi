# Phase A 返工复核：已通过项与剩余收口

> 后续直接修复：用户已授权设计者参与，本文复现的问题现已完成持久回归与修复，最终门禁及范围见 [28-phase-a-direct-repair-verification.md](28-phase-a-direct-repair-verification.md)。下文保留修复前独立审查、FAIL 判定与原交接 Prompt，不删反例或用新计数覆盖历史证据。

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`。
分支：`feat/gbk-text-io`；HEAD：`0cbb33a59cfe256f931735042b7101cb4f901ca9`。
依据：[23 号设计](23-next-phase-implementation-design.md)、[25 号返工要求](25-phase-a-designer-review.md)、[26 号实施报告](26-phase-a-rework-verification.md)与本轮当前代码。

**判定：部分 PASS，Phase A 整体仍 FAIL。R-A1 的实际编码写坏反例已修复，R-A2 的原始字节窗口反例已修复；不要求重做这些已通过项。剩余集中在 R-A3/R-A4/R-A5 和验收证据，完成后再复核并进入 B/C。**

## 1. 独立门禁与产物

| 项 | 本轮实测结果 |
| --- | --- |
| `bun run build:native` | PASS，退出 0；优化构建 3m38s，142 exports；仍有 1 条 linker warning，不称零警告 |
| 本轮重建 native SHA256 | `fa930c6b3c4fbfde8505ad07bb7119cb39be79c984508fb4a0e58b06865e627f` |
| 九文件 GBK | PASS，113 passed / 0 failed / 409 assertions，15.33s |
| `bun check` | PASS，退出 0 |
| `bun run test:rs` | PASS，3038 passed / 4 skipped；runnable doctest 1 passed |
| `git diff --check` | PASS；文档写入后再检查 |
| GitHub #3 | OPEN，本轮只读查询 |

构建前 native hash 与实施者的 `4d7ee32e…` 一致；重建后是上表新 hash。所有本轮 native TS 回归与临时工具反例使用重建后的产物。未声称构建可复现，也不把旧 hash 写成新产物。

日志：`%TEMP%\ompg-designer-phase-a-rework-native.log`、`ompg-designer-phase-a-rework-check.log`、`ompg-designer-phase-a-rework-rust.log`、`ompg-designer-phase-a-rework-gbk.log`。额外反例是独立临时工具调用，不计入上述 113 个持久测试。

Unix、symlink、真实 native reader abort 保持先前 UNVERIFIED / ENVIRONMENT BLOCKED；本轮没有新增这些方面的证明。

## 2. 认可且不重做的修复

| 原问题 | 本轮验证 | 判定范围 |
| --- | --- | --- |
| R-A1：preview 后切 UTF-8 override，中文替换写成 GBK | 真实 ToolChoiceQueue + WriteTool `xd://resolve`；预览不变源 bytes；实际 apply 成功，严格 UTF-8 中有 `sizeof("中文")`，无歧义附注 | PASS，此具体 P1 反例已消除 |
| R-A1：preview 后显式 GBK override 仍提示歧义 | 同样真实 apply，严格 GBK 中有中文替换，无歧义附注 | PASS |
| R-A1：快照用默认 UTF-8 读 GBK | preview/apply 改用 readTextWithPolicy，源码确认；不是完整后续 Hashline 编辑端到端证明 | 实现改善保留，不扩大证据 |
| R-A2：非规范 GBK 映射 `e0a0a2e38080` 漏报 | 实际 >4MiB ReadTool，`:1-5`、`:1-5:raw`、`:1-2,3-5` 均有原始窗口附注 | PASS，禁止退回文本二次编码 |
| R-A3：首块完整行的确定性提示未接通 | UTF-8 `// 中\nint x = 1;\n` + ASCII 大文件，实际 read 有确定性提示 | 此场景 PASS；跨块仍 FAIL，见下节 |
| R-A4：preview 零替换无附注 | 实际 AstEditTool 零替换带附注 | 此分支 PASS；stale apply 仍 FAIL |
| R-A5：TS helper 只凭 UTF-8 合法就称双合法 | 对 UTF-8 合法/GBK 非法输入，helper 现在不返回双合法附注 | PASS，strict codec 分流保留 |
| R-A5：列表渲染 | 原生/TS AST cap 和 omitted 标志、LSP 工具 formatter cap 已写入 | 认可实现；新增测试未完整验证所有实际消费者 |

apply 开始重新发现策略已经解决预览闭包过期问题；但 `validateChanges` 的 resolveWriteEncoding 与快照 readTextWithPolicy 仍会独立发现策略，不能宣称它们已绑定同一个不可变 policy snapshot。若需证明预检到写入间的策略一致性，应使用该次策略或在相应边界检查变化；不宣称能抵抗任意外部并发修改的事务。本次不把此静态边界冒充另一个已复现的编码写坏问题。

## 3. R-A3 剩余：chunk 开头的行片段被误作完整行（P2）

文件：`packages/coding-agent/src/tools/read.ts`，`findGbkValidationFailureHint` 约第 332—355 行；调用约第 668 行。

当前 helper 只排除了 chunk 末尾没有 LF 的片段，却把从 chunk 第 0 字节到第一个 LF 的片段无条件当成完整行。它既不接收该行此前的 bytes，也不知道 validationDecoder 的 GBK lead carry。chunk 边界不等于行边界。

### 可重复的实际反例

当前 `READ_CHUNK_SIZE = 8192`，构造如下 >4MiB 文件：

```text
第一行：61 重复 8191 次，随后 81 e4 b8 ad 0a
第二行：ff 0a
后面：ASCII padding line + LF 重复 240000 次
```

先独立严格验证完整第一行：GBK 合法，UTF-8 非法（包含 `81`）。第一个 chunk 刚好结束在 GBK lead `81`；第二个 chunk 从 `e4 b8 ad 0a` 开始。streaming TextDecoder 正确将 carry `81` 与 `e4` 配对，再解码 `b8 ad`，随后因第二行的 `ff` 失败。

但新 helper 对 chunk 的首段 `e4 b8 ad 0a` 单独判定：UTF-8 合法、GBK 非法，于是真实 `ReadTool.execute({path: file + ":1-5"})` 错误输出：

```text
(line 1): the displayed window bytes are valid UTF-8 and invalid GBK,
so this cannot be a GBK window
```

这与完整第 1 行的已验证事实正好相反。严格读取仍拒绝非法文件，并未写入源文件；问题是给出了错误的确定性证明和行对象。

### 收口要求

1. 复用已有 currentLineChunks/pendingSegment/currentLineLength 与行扫描状态；不要另写流式 GBK codec。
2. 只有明确从真实行边界开始且完整的 bytes，或有界拼接了前块完整前缀的实际行，才可给行级证明。未保存前缀、seek 跳过、预算丢弃、残片时标明不可完整证明，保留原严格错误。
3. 不把为了 seek 经过的行或 chunk 中未显示的行叫 displayed window；输出诊断范围与实际所验证对象一致。
4. 保留原 fatal 校验，禁止通过关闭严格校验消除反例。加入持久工具回归：上面反例不能产生第 1 行 UTF-8 证明；正常首块行仍有提示；跨块完整 UTF-8/GBK 失败行有证据则准确报告，否则明确不完整。

## 4. R-A4 剩余：stale apply 提前返回仍丢掉本次附注（P2）

文件：`packages/coding-agent/src/tools/ast-edit.ts`，约第 590—599 行；本次 `appliedAmbiguityNote` 到第 603 行之后才生成。

实际路径：GBK default 下预览双合法 `// 中文\nint x = 1;\n`，然后外部将源改为双合法 `// 中文\nint x = 999;\n`；真实 WriteTool `xd://resolve` 应用原 `int $VAR = 1;` 模式。

实际结果：`isError: true`，外部修改后的源 bytes 不变，正文只有 `Preview is stale / no longer matches; no replacements were applied...`。本次原生读取确实观察到双合法新源，但 stale 分支提前 return，没有呈现 fresh apply 的诊断。

保留错误状态、已执行前缀和真实替换数量；在构造 stale 结果前统一准备本次 applyResult 的附注，使零替换/部分替换/正常成功分别呈现本次观察。不能为了附注把 stale 变成功，也不能套用旧 preview 附注。

持久回归须在同一真实队列用例中断言：stale 的 `isError`、新源 bytes 未变、附注来自新源；再加显式 override 或新源无歧义时不沿用预览附注。当前 stale 用例只检查 isError/text，未比较源 bytes，也未验证诊断。

## 5. R-A5 剩余：预算检查在全量读取之后（P2）

文件：`packages/coding-agent/src/tools/write.ts` 第 967—970 行。
当前仍为 `await Bun.file(absolutePath).bytes()`，然后才检查 `oldBytes.byteLength <= 4MiB`。这是分析预算检查，不是获取预算上限。读前 stat 与读后的 size guard 都不能限制已经完成的全量读盘和分配。

### 确定性故障接缝实测

对临时文件初始 `int x = 1;\n`，使用 spyOn 包装真实 fs.stat：取得小文件 stat 后、返回该 stat 前，把磁盘文件增长为 `4MiB + 1024` 个 ASCII `61`。包装真实 Bun.file().bytes 只记录返回长度与调用位置，不伪造 bytes；运行真实 WriteTool。

记录到第 967 行诊断读盘实际取得 **4195328 bytes**，超过 4194304 的预算。工具最后成功写入 11 bytes，结果没有任何诊断未取得/超预算提示。第二次大文件读取来自第 1020 行原保存校验，必须与新增诊断读取分开；本问题不把原保存所需全文校验错误地计为新增诊断预算。

这是确定性受控 I/O 接缝证明，不声称在本机偶然观察到了外部并发进程。既有 GBK write 保护不因此被判失效，也不授权重写原保存机制。

### 收口要求

- 复用现有 Bun.file.slice 或适用的有界读 helper，在取得 bytes 的阶段限制新增诊断读盘。允许最多 4MiB 诊断正文加至多 1 字节超额探测；探测字节不用于整文件合法性证明。正常保存/稳定性校验保持原契约。
- 超预算、读取失败、范围不完整必须有明确 unavailable/incomplete 状态与原因，不能以 undefined 同时表示“没有歧义”和“没有检查”。不能仅读前缀便输出 same bytes 整文件结论。
- TS `AmbiguityNoticeOptions` 仍只有 scope/行号，Rust StrictDecodedSource 仍只有 bool；25 要求的 kind/range/completeness 尚未落实。最小扩展已有结果类型与格式化即可，不建立第二套 I/O 框架。超预算 AST 诊断目前静默跳过，需可区分未检查。
- 不要求所有 ASCII/未管理文件增加噪声；只将实际有资格、但无法取得完整诊断的 GBK 对象状态如实表达。
- 加入确定性 stat→增长、诊断读失败、预算边界测试，验证有界获取与实际工具结果；当前新增 emoji zero-write 测试不验证这些条件。

## 6. 验收覆盖与复用要求

已通过的 113 个测试是回归基线。下列测试名称/报告仍扩大了证据：

| 当前测试/报告 | 真正覆盖 | 需要补充 |
| --- | --- | --- |
| `LSP applyWorkspaceEdit caps notes at 10 with explicit omission count` | 内部 WorkspaceEditResult 有 11 applied、11 notes | 实际 LspTool rename/code_actions 结果的 10 条上限与省略说明；不能只把 expect(11) 改为 expect(10) 冒充消费者 |
| `AST grep and edit report capped ambiguous files...` | 只执行 AstGrepTool | AstEditTool 及多目标最终集合、去重/截断提示 |
| stale preview 回归 | isError 与 stale 文本 | 源 bytes、fresh 诊断与 override 抑制 |
| 首块失败提示 | 完整行恰在同一 chunk | 真实跨块完整性与错误范围 |

AST 两个工具现在分别复制了同一个 `formatAstAmbiguityNote`，未做到一个共享 formatter。按根 AGENTS.md 的复用规则，收敛到合适的已有公共位置；不再复制第三份，避免后续 kind/completeness 两处不同步。

保留 23 A5 的 BOM、禁用/未管理、显式 utf8/gbk override、zero-write、I/O executed-prefix、跨块/截断/预算验收要求。可复用原有效用例，不为计数重复测试；尚缺证据逐条注明，不用“全套通过”覆盖未执行分支。

## 7. 直接复制给实现 AI 的 Prompt

```text
你负责 ompg Phase A 最后收口，仓库 D:\Projects\GitProjects\oh-my-pi，feat/gbk-text-io，HEAD 0cbb33a59cfe256f931735042b7101cb4f901ca9。先读 AGENTS.md、当前 git status/diff、02 合同、23/25 设计、26 报告及27-phase-a-rework-designer-review.md。所有未提交代码保留，不 reset/restore。

27 已独立通过113/113 GBK、bun check、Rust3038/4 skipped，认可 R-A1 的预览后策略切换实际写入修复与 R-A2 的非规范GBK原字节窗口修复，别推倒或重做这些已通过项。Phase A整体仍FAIL，只收口 R-A3/R-A4/R-A5 与真实消费者证据，暂不进入 B/C。

先写持久失败回归，再修 read.ts::findGbkValidationFailureHint。当前READ_CHUNK_SIZE=8192，第一行是61重复8191次+81e4b8ad0a，第二行ff0a，后面ASCII补足>4MiB。完整第一行合法GBK、非法UTF8；第二chunk从e4b8ad0a开头，decoder继承81后第一行合法，因第二行ff失败。当前helper把该chunk开头的行片段当完整line1并给出UTF8合法/GBK非法证明，是错误结论。复用已有行前缀和扫描状态，完整原始行/窗口才给证明；缺前缀、seek、预算丢弃或截断时明确不完整。保留fatal，不重写codec，不将未显示前缀/尾部标成displayed window。保留正常首块失败提示通过。

修 ast-edit.ts 的 stalePreview 提前return：本次 appliedAmbiguityNote 必须在stale/部分应用/成功分支都根据applyResult呈现，不能沿用旧preview。真实队列+WriteTool xd://resolve，预览x=1后源改为双合法x=999，断言isError、源bytes未变且新源诊断可见；override或新源无歧义时旧附注消失。不把stale变成功、不隐瞒真实已执行前缀。预检/快照的策略一致性不许夸成事务或任意并发安全。

修 write.ts 第967行预算：await Bun.file(...).bytes()后判断长度仍然全量读盘。使用Bun.file.slice或已有有界helper，在取得诊断bytes时设上限；允许4MiB正文+至多1字节超额探测，探测不参与完整文件证明。用真实stat返回前将临时文件从小文件增长为4MiB+1024的确定性接缝，验证新增诊断获取有界且输出unavailable/incomplete；保存本身的原有全文稳定性检查独立保留。另测诊断读取失败与预算边界，别用emoji zero-write代替预算证明。

最小扩展已有共享诊断类型表达kind、file/window、实际检查范围、完整/不完整/未取得与原因；当前options scope/行号和Rust bool还未满足25。AST超诊断预算不能静默等同未发现歧义，不建立第二套I/O或编码检测框架，不自动改编码、不因歧义阻止写入。继续复用strict codec、predicate与policy discovery。ASCII/未管理路径不增加无谓提示。统一两个AST工具复制的formatAstAmbiguityNote到合适共享位置。

补真实消费者回归：当前名为LSP caps at10的测试只assert内部11 notes，必须测最终LspTool rename/code_actions上限和省略说明；当前AST grep and edit cap只运行grep，补ast_edit与多目标聚合。按23 A5核对BOM、override、禁用/未管理、zero-write、I/O executed-prefix、跨块/截断/预算，复用已有效测试，缺证据明确保留。不source-grep、不mock.module、不放宽断言/跳过制造通过。可用明确标注的确定性接缝，不能冒充真实系统并发或原生线程abort证明。

Rust稳定后先bun run build:native，记录完整hash并沿正常流程生成绑定，再跑九文件GBK及新增回归；bun check、bun run test:rs和必要相邻门禁。113/409、3038/4只是本轮基线，报告你自己的真实数字和日志。更新02合同及26历史口径，另写下一轮交付，逐条回应27：已通过保留、剩余修复、真实consumer证据、仍未验证边界分开。不要再把门禁PASS等同A1—A5完整验收。

源码增删改只走edit/apply_patch/write，不shell Python/sed/perl。未授权不commit/push、发布/覆盖release、GitHub评论/关闭#3或改memory；不安装WSL/改权限、改E630/停止用户进程。#3保持OPEN，Unix/symlink/真实reader abort按原状态记录。完成后交设计者复核，通过Phase A再执行23的B/C。
```

## 8. 本轮工作状态

只编辑审查文档与 24/26 顶部验收口径；未修改实施者源码或测试。构建、真实临时工具反例与明确的 I/O spy 接缝均已完成，临时夹具清理。未 commit/push、发布、评论、关闭 issue 或修改 memory；用户未提交工作保留。
