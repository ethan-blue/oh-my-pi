# Phase A 设计者复核与返工交接

日期：2026-10-11。工作目录：`D:\Projects\GitProjects\oh-my-pi`。
分支：`feat/gbk-text-io`；HEAD：`0cbb33a59cfe256f931735042b7101cb4f901ca9`。
依据：[23 号批准设计](23-next-phase-implementation-design.md)、[24 号实施报告](24-phase-a-implementation-and-verification.md)及当前未提交代码。

**判定：Phase A FAIL。构建与已有门禁 PASS；A1—A5 完整验收不成立。先完成本文件返工，复核通过后再进入 B/C。**

## 1. 本轮独立证据与保留事项

本轮读取交付附件、根 AGENTS.md、当前状态/diff、23/24 设计与相关调用链；重建 native，再执行九文件回归。同时运行全仓 check 与 Rust 门禁。通过真实 ReadTool、AstEditTool、WriteTool 的 `xd://resolve` 以及真实 ToolChoiceQueue，在临时目录执行反例；临时目录随后清理，未改用户源码或测试。

| 项目 | 本轮实测 | 证据与边界 |
| --- | --- | --- |
| `bun run build:native` | PASS，退出 0 | win32-x64-modern，142 exports；构建日志仍有 1 条 linker warning，不称零警告 |
| 重建后 native SHA256 | `c6a5c4740b3cdbcc745d67665b669fb1c709c7c7050e3df535533e398d53bbe5` | 本轮 TS 门禁与反例使用此产物 |
| 九文件 GBK | PASS，105 passed / 0 failed / 383 assertions | 10.28 秒；认可门禁数字，不能据此宣称缺失场景也通过 |
| `bun check` | PASS，退出 0 | 全仓检查通过 |
| `bun run test:rs` | PASS，3038 passed / 4 skipped | runnable doctest 1 passed；跳过不计为通过 |
| `git diff --check` | PASS | 最终文档改动后再次检查 |
| GitHub #3 | OPEN | 本轮只读查询，无评论/关闭/发布 |
| Unix、symlink、真实 native reader abort | 不新增通过结论 | 保留既有 UNVERIFIED / ENVIRONMENT BLOCKED 边界 |

门禁日志位于 `%TEMP%\ompg-designer-phase-a-native.log`、`ompg-designer-phase-a-check.log`、`ompg-designer-phase-a-rust.log`、`ompg-designer-phase-a-gbk.log`。临时日志不是永久发布证据；下轮应记录自己的日志及产物 hash。

构建前 hash 与实施者报告的 `625f95ea…` 一致；本轮重建后得到上表 hash。未据此断言构建可复现或实施者报告造假，也不把旧 hash 冒充本轮测试产物。

认可并保留：Rust 从既有 search 解码适配中抽出了 `decode_source_strict`；AST 复用 strict codec 而非另写字符表；AST 的歧义集合与 parseErrors 分开；LSP 已有 bytes 被复用且结果有消费入口；原 R1—R5 门禁仍通过。无需推倒这些实现。

## 2. R-A1：AST apply 使用过期策略，可写出错误编码（P1，发布阻断）

文件：`packages/coding-agent/src/tools/ast-edit.ts`。预览约第 302 行发现并捕获 `encodingPolicy`；apply 约第 478—492 行的 freshPreview 与最终写入都继续使用同一个旧 JSON。重新读取了源文件，不等于重新读取了策略。

### 复现与实际结果

1. 临时项目策略为 GBK default、include `src/**`、无 override。
2. `src/ast.c` 原始字节为 UTF-8 的 `// 中文\nint x = 1;\n`，也是严格合法 GBK。
3. 用真实 AstEditTool 预览：`pat: "int $VAR = 1;"`，`out: "int $VAR = sizeof(\"中文\");"`。预览不写盘，注册真实待决 action。
4. 预览后向策略加入 `{ "glob": "src/ast.c", "encoding": "utf8" }`。
5. 用真实 WriteTool 写 `xd://resolve`，执行待决 apply。

实际：工具返回 `Applied 1 replacement in 1 file`，仍带旧 GBK 歧义附注；新插入字符串被编码为 `d6 d0 ce c4`。最终文件 bytes：

```text
2f2f20e4b8ade696870a696e742078203d2073697a656f662822d6d0cec422293b0a
```

严格 UTF-8 校验失败。本次 apply 已经把当前应为 UTF-8 的文件写成了混合字节。另一个反例将策略改为显式 GBK override，实际 apply 仍显示歧义提示，违反 override 抑制语义。

### 修复与验收

在 apply 生命周期重新发现有效策略，供本次 freshPreview、编码预检与实际写入一致使用；不得复用预览闭包中的旧 JSON。复用现有策略 discovery/cache，禁止另建策略解析器。策略若在预检与写入间变化，按既有失败机制清楚拒绝或重新验证，不能把不同策略下的预检当作写入证明；不承诺抵抗任意外部并发写入的事务。

持久测试必须走真实队列和 `WriteTool.execute({path: "xd://resolve", ...})`，分别证明：预览前后原 bytes 不变；GBK override 后无歧义附注；UTF-8 override 后含中文替换严格落为 UTF-8；源内容变化后使用新输入；失败保持正确源 bytes。核查 preview/apply Hashline 快照仍按策略解码，避免本次修复继续用 `.text()` 把 GBK 当 UTF-8。

## 3. R-A2：大文件用重新编码的文本作原始字节证据，漏报（P2）

文件：`packages/coding-agent/src/tools/read.ts` 约第 1585 与 2449 行。
单区间和多区间都使用 `encodeStrict(collectedLines.join("\n"), "gbk")` 构造诊断 bytes。严格解码后重新编码可能规范化字节；它不等于原文件窗口。

### 字节反例

```text
原始 bytes：e0 a0 a2 e3 80 80
严格 UTF-8：合法
严格 GBK：合法，文本为 酄€€€
GBK decode→encode 后：e0 a0 80 80 80
重新编码后的 bytes：不是合法 UTF-8
```

GBK `a2 e3` 与单字节 `80` 均可映射为欧元字符，但 encoder 选择后者；这不是猜测编码。把原始反例放在 `// ` 后，接 `\nint x = 1;\n`，再加 ASCII 行使文件超过 4 MiB。真实 `read path:1-5` 读到完整窗口，却没有 `also valid UTF-8` 附注。同样前缀的小文件整文件检查有附注。

### 修复与验收

在已有 streaming 行捕获处诊断原始 bytes，复用 currentLineChunks/pendingSegment；不要通过解码文本回构字节。复制/累积仅限实际输出的完整范围，预算有界；行分隔符、跨 chunk、seek、末行与 BOM 语义清楚。不能只在单区间修复，多区间必须共享同一路径。禁止为诊断扫描未读尾部。

将以上反例加入持久工具级回归，同时验证单区间、多区间、`:raw`、跨 chunk 字符、非首窗口、截断/预算。完整窗口标清检查范围；无法取得完整证据时可输出“不完整”，不能用残片作整文件或完整窗口结论。

## 4. R-A3：流式失败提示被前置 chunk 校验截断（P2）

文件：`packages/coding-agent/src/tools/read.ts`，约第 500—522 行新增 decodeLine 提示；第 614 行先执行 `validationDecoder.decode(chunk, {stream:true})`。

实际反例：大于 4 MiB 的文件以 UTF-8 `// 中\nint x = 1;\n` 开头，后面全为 ASCII，调用真实 `ReadTool` 的 `path:1-5`。

实际只得到 `TypeError [ERR_ENCODING_INVALID_ENCODED_DATA] ... not valid for encoding gbk` 与通用规则提示，没有 `valid UTF-8 and invalid GBK`。完整第一行已有充分证据，但在新增 decodeLine 分支之前抛错。

修复必须覆盖实际先失败的校验路径，保留严格错误拒绝，不通过删除 fatal 校验放宽原契约。不把整块、seek 前缀或未显示尾部误标为输出窗口。复用 bounded 原始行/范围，在证据完整时给确定性提示；残片或未知范围只报告真实错误和不完整。测试实际 ToolError、诊断范围与源 bytes 不变，而非单独调用 hint helper 就称接通。

## 5. R-A4：AST 无替换分支丢弃已有诊断（P2）

文件：`packages/coding-agent/src/tools/ast-edit.ts` 约第 368 行。
`encodingAmbiguityNote` 已生成，但 `totalReplacements === 0` 的提前 return 只输出 parse/grammar 消息，没有附注。

实际：UTF-8 双合法 `// 中文\nint x = 1;\n`，AST 模式 `int $VAR = 999;`，输出仅 `No replacements made`。读取了有歧义的候选文件，零匹配不应使观察到的来源消失。

复用共同结果格式化，补零替换、零匹配/错误共存以及 override 抑制回归；不把诊断塞进 parseErrors。apply 的零替换也核查其独立消费者，不复用旧预览附注。

## 6. R-A5：共享诊断完整性、列表和预算仍未满足 A1（P2）

以下与上面真实写坏反例分开，不扩大成“所有保存都失效”：

| 项 | 当前证据 | 需要补全 |
| --- | --- | --- |
| TS 双合法前置条件 | `gbkUtf8AmbiguityNotice` 只检查 UTF-8 predicate；直接对 UTF-8 `// 中\n...` 返回“decoded as GBK”，尽管 strict GBK 失败 | 复用 strict codec，区分已验证双合法与严格 GBK 失败；验证来源不得靠调用者默契 |
| write 保持原保护 | 上述非法 GBK 输入的真实 WriteTool 被 `assertStableGbkBytes` 拒绝，原文件不变 | 不误报 write 已写坏；复用原保护，补有资格的原 bytes 诊断证据及错误口径 |
| write 诊断读失败 | 当前 catch 静默；`stat <=4MiB` 后 `.bytes()` 仍全量读取变化中的文件 | 诊断未取得应可见；额外读盘自身有界，不能仅以读前 stat 代替实际预算 |
| metadata | options 只有 scope/行号，没有 kind 与 completeness；Rust 只有布尔值 | 最小扩展现有结果类型，表达已检查范围和完整/不完整/未取得；不另建 I/O 框架 |
| AST 列表 | 真实 11 个双合法文件仅说“10 searched file(s)”，不报告省略 1；多目标 TS Set 又无总上限 | 原生和最终聚合上限 10 个去重对象，报告省略计数或明确总数未知，不能伪造精确数 |
| LSP 列表 | 真实 11 文件 WorkspaceEdit：11 applied、11 encodingNotes | 结果渲染集合有总上限及省略说明；成功操作数量与诊断列表限制分开 |
| AST 大文件 | `decode_source_strict` 对全部 candidate bytes 执行额外 UTF-8 ambiguity 检查，无 4MiB 诊断限制 | 区分正常解析所需全文与额外诊断预算；超预算不宣称取得整文件证明 |

原有 ASCII 文件的“不附注”可以保留；24 号“纯 ASCII 不进行读盘”表述不成立：当前代码需要先读旧 bytes 才判断，不能把无附注等同无 I/O。

诊断列表计数要基于实际去重对象；若为严格有界内存不能精确统计去重总数，应明确“存在更多/总数未知”，不能把重复项当不同文件得出精确省略数。不要为这项报告保存所有文件正文或建立无限集合。

## 7. 回归证据缺口与补全顺序

新增测试名 `AST edit preview and apply surface ambiguity note`（`gbk-encoding-ambiguity.test.ts` 约第 308 行）只执行 AstEditTool.execute 并断言文本；夹具无 getToolChoiceQueue/peekPendingInvoker，没有 actual apply。本轮通过真实队列证明 preview 时文件未变，因此不能据此宣称 apply 验收通过。

建议依赖顺序：

1. **先复现再修 R-A1**：实际 pending action、策略切换、含中文落盘、fresh source 与快照。完成最严重写入问题。
2. **统一 R-A5 的基本数据/证明条件**：保留 strict codec 和 policy discovery，确定 kind/scope/range/completeness 与预算；不得自动更改编码。
3. **接通 R-A2/R-A3**：共享真实原始窗口诊断，修复成功与失败路径；保留 chunk 严格校验与原读取限制。
4. **补 R-A4 和 R-A5 集合/消费者**：零匹配、10+列表、write 诊断未取得、LSP rename/code_actions 实际模型可见结果。
5. **完成 23 A5 原矩阵**：override utf8/gbk、ASCII、禁用/未管理、BOM、非法输入、表达性拒绝 zero-write、预检后 I/O 故障 executed-prefix、跨块/截断/预算。复用已有有效用例，不为了计数重复测试。
6. **稳定 Rust 后构建及门禁**：build:native → 新增/九文件 native TS 回归；bun check、bun run test:rs 与必要相邻套件。记录新 hash 和真实数字。
7. **同步文档**：02 合同明确新语义；24 留历史门禁并纠正“完整完成/真实 apply 已验证”口径；新建下一轮交付记录逐条回应本文件。Unix/symlink/abort 等独立缺口继续如实列出。

有意义的新增失败回归必须在修复前证明反例会失败，修复后通过；不用 source-grep、放宽断言、提前 return 或 mock.module 代替实际行为。故障接缝可用于确定性 I/O 验证，但要明确与真实系统/原生线程 abort 的证明层级不同。

## 8. 可完整复制给实现 AI 的 Prompt

```text
你是 ompg Phase A 返工工程师。仓库 D:\Projects\GitProjects\oh-my-pi，分支 feat/gbk-text-io，HEAD 0cbb33a59cfe256f931735042b7101cb4f901ca9。先读 AGENTS.md、当前 git status/diff、02 合同、23 设计、24 交付与 25-phase-a-designer-review.md。保留全部未提交工作。21 已验收项不重做；105/3038 是已有门禁基线，不是本次新功能验收证明。

当前 Phase A 不通过；先完整返工 25 的 R-A1—R-A5，不进入 PTY/eval B/C。最先修 ast-edit apply 捕获旧 encodingPolicy：真实 preview 后添加 utf8 override，再 resolve 含中文替换，当前会返回成功却插入 GBK d6d0cec4，使文件非法 UTF-8。apply 重新发现策略，并给本次 freshPreview/预检/写入一致使用；不复用预览 JSON。用真实 ToolChoiceQueue、session pending invoker 与 WriteTool 的 xd://resolve 完成持久回归。显式 gbk override 后不应仍有歧义附注；源变化后诊断来自新输入。核查预览和应用快照按正确策略解码。

复用共享 strict codec、Rust predicate、现有 policy discovery 与 decode_source_strict，不自写字符表/检测器/第二套 I/O。双合法必须先 strict GBK 成功，再验证完整原 bytes 的 UTF-8；非法 GBK 的确定性提示是独立分支。GBK default、override、ASCII/BOM、禁用/未管理语义保持。最小扩展现有诊断结果明确 kind、file/window、实际检查范围、complete/incomplete/unavailable。

修复 read 单/多区间的 encodeStrict(collectedLines.join(...))：它不是原始字节。原始 e0a0a2e38080 同时合法 UTF-8/GBK，GBK 重新编码变 e0a0808080，导致当前 >4MiB read 漏报；用该非规范 GBK 映射做持久工具回归。只诊断原 streaming 捕获的完整原始窗口，有界复制/聚合；不扫 seek 前缀或未读尾部。正确处理原分隔符、跨 chunk、末行、非首窗口、BOM、截断和预算。

修复流式失败提示实际被 validationDecoder.decode(chunk) 抢先截断：>4MiB、UTF-8 '// 中\nint x = 1;\n' 加 ASCII 尾部，实际 read :1-5 当前只有通用 GBK 错误。把完整原 bytes 的证明接到真正失败路径；不删除 fatal 校验放宽严格读取。残片不给确定性证明，错误范围准确，不声称整个文件合法。

修复 AST zero replacements 提前 return 丢失编码附注，核查 preview/apply、零匹配、parse-error 共存消费者。列表最终只呈现上限10个去重对象，省略/未知总数要明确：现在 11 AST 文件只报告10没有省略说明，LSP 11文件返回11条附注，多目标 AST Set 也没有最终总上限。不要用无限集合或虚构精确去重总数实现省略计数。

write 诊断读失败不应静默冒充已完成检查；额外读盘真正受4MiB预算约束，而非只靠读取前 stat。复用底层稳定字节保护，设计者已证明非法 GBK 原文件的真实 WriteTool 被拒绝且 bytes 不变，不能改成无条件覆盖或宣称已写坏。AST 正常解析全文与额外 UTF-8 诊断预算分开，超预算没有整文件证明。

新增回归先复现失败后修复通过。补真实 AST apply、LSP rename/code_actions 模型可见输出、write未取得诊断、override utf8/gbk、BOM、禁用/未管理、ASCII、UTF8合法GBK非法、表达性错误zero-write、I/O失败executed-prefix、跨块/截断/预算。复用原测试及可控故障夹具，不 source-grep、不 mock.module、不跳过/放宽断言制造通过。别把 precheck 写成整批 I/O 原子回滚。

Rust 稳定后先 bun run build:native，记完整SHA256，生成绑定走正常构建，再跑九文件GBK及新增回归；全仓 bun check、bun run test:rs 和必要相邻检查。区分 PASS/FAIL/SKIPPED/UNVERIFIED，写实际数字与日志。更新02合同、24历史交付口径并新建返工证据文档，逐条回应25及23 A5。已有完整完成声明已被设计者撤销，不能只改文档绕过源码返工。

源码增删改只走 edit/apply_patch/write，不经 shell Python/sed/perl 改写。禁止 reset/restore 用户工作、未授权 commit/push、发布/覆盖release、GitHub评论或关闭#3、修改memory。不得安装WSL/工具链、改系统权限、改E630或停止用户进程。Unix/symlink/真实reader abort维持真实阻塞/未验证。完成后提交设计者复核，先报告实际修复和仍缺什么；Phase A复核通过再进入23的B/C。
```

## 9. 本轮工作树与发布状态

设计者本轮只新建本文件、在 24 号顶部更正验收状态，并执行构建和只读/临时夹具验证。未直接修改实现 AI 的源码或测试，既有未提交工作保留。#3 保持 OPEN；没有提交、推送、GitHub 评论、关闭 issue、发布或修改 memory。
