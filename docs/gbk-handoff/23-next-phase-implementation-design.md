# 下一阶段编码协议接入设计与实现 Prompt

日期：2026-10-11。目录 `D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，HEAD `0cbb33a59c`。现有全部未提交工作保留。本文为设计者批准的后续实现范围，不是实现完成报告。

## 1. 审查结论与本次决策

21 号第 7 节的 P2 持久回归已经 PASS，不再重做。22 号可作为入口清单，但其原“完整接入设计”缺少新增接口、请求/流生命周期和验收；本轮只静态核对并修改文档，没有重跑全套门禁，更没有完成新协议路径。

本次核对得到的关键事实：

| 事实 | 源码入口 | 实施含义 |
| --- | --- | --- |
| write 有条件读取旧文件 | `tools/write.ts::readCurrentWriteSource`、`assertNotTruncatedFileReadProjection` | “无 G4 附注”是现状，不是禁止读取的合同；可复用已有缓冲，避免同调用重复读盘 |
| LSP 预检与实际 apply 分开 | `lsp/edits.ts::precheckTextOpEncodings`、`applyWorkspaceEdit`、`onExecuted` | 编码错误可零写失败；I/O/取消的执行前缀不能声称事务回滚 |
| AST 主要链路在 Rust | `crates/pi-natives/src/ast.rs::read_candidate_source`、`pending_writes` | 不调用 TS readTextWithPolicy/LSP 预检；诊断在已有字节读取处计算并经 native 结果透传 |
| 大文件行读取主要在 TS | `tools/read.ts::streamLinesFromFile` | 当前按行聚合 bytes 并用严格 codec；不要误改不存在的 native fs 入口 |
| PTY 已共用 OutputDecoder | `crates/pi-natives/src/pty.rs` | 扩展参数和摘要，保留现有读线程/队列/排空机制 |
| fd-1 与 `!` 的捕获生命周期不同 | `eval/py/runner.py::_drain_captured_stdout`、`_stream_process_output` | 前者 process-wide UTF-8/replace，后者每个子进程 locale/strict；必须分开接入 |

**已批准：**为本地受策略管理的读取、编辑、write、LSP、AST 增加来源明确的 G4 附注；为 PTY 和 eval 的原始 bytes 捕获增加 G5 参数与来源报告。只是诊断与捕获协议扩展，不授权因歧义阻止写入、猜测/切换文件编码、扩大策略作用域或重写保存机制。不需要再次为“给 write/LSP/AST 添加附注”申请批准。

合同 02 的现有 §9 记录的是已实现范围；实现时追加扩展语义并保留历史边界，不能借既有“未覆盖”停止工作。变更顺序：A（文件诊断）→ B（PTY）→ C（eval）。**本次实现 AI 首先完成 A 并交付可测代码，不再只生成同一份现状矩阵。** 后续阶段按本文执行，失败时缩小到可验证的边界，不把未完成项从矩阵删除。

## 2. A：共享文件诊断，当前优先执行

### A1. 诊断语义与复用

复用 `pi-edit::encoding::utf8_ambiguous_with_gbk`、`decode_strict`、`CompiledEncodingPolicy::resolve_detailed`，以及 TS `gbkUtf8AmbiguityNotice`/`gbkDecodeFailureUtf8Hint`。先严格 GBK 成功，再诊断“双合法”；GBK 失败且所检查 bytes 完整合法 UTF-8 才能给确定性提示。不得仅凭 UTF-8 合法就断言 GBK 同样合法。

Rust native 侧已有 `crates/pi-natives/src/encoding.rs::transcode_search_strict` / `SearchTranscode`，集中处理严格解码、BOM、失败提示和 ambiguity 来源。先评估从这个现有入口拆出可共享的严格解码诊断结果，让 grep 保留 buffer 转码适配、AST 复用共同部分；不能另写一套同等逻辑。工具特定的“search aborted”文案不直接套给 AST，grep 的窗口预算与原行为保留。

扩展现有诊断 helper，使消息明确对象为整文件或完整字节范围。数据至少表达 kind、scope（file/window）、已检查范围以及是否完整；类型和命名按现有规范，避免建立第二套文件 I/O 框架。共享格式化处理 GBK include/default、显式 override 抑制、ASCII/BOM 和去重。原有 whole-file 调用保持默认语义，不能把窗口消息套用成“整个文件是 UTF-8”。

额外诊断缓冲上限保持 4 MiB，列表上限 10 个不同文件/范围并提示省略数量；不永久保存多份全文，不在日志输出源码。文件工具没有发生捕获输出时不复用 G5 字段冒充 G4。

### A2. write 与 LSP

涉及 `src/encoding/index.ts`、`src/tools/write.ts`、`src/lsp/edits.ts` 及实际消费 WorkspaceEditResult 的调用方（先检索全部调用，不只改返回类型）。

write：新建文件没有原文件可诊断；已有本地普通文件仅在 GBK include/default 且无 override 时尝试有限预检。先判断策略与大小，≤4 MiB 才读取用于诊断的 bytes，尽量复用同次调用已有缓冲；UTF-8、未管理、override、设备、archive/sqlite/非文件 URL 不增加这项读盘。目标字符、coding 声明、ACP bridge 拒绝、快照及写后校验仍按现有机制。歧义仅附注，不更改编码或阻止 write；额外诊断读失败不冒充确定结论，结果应明确诊断未取得，不能伪称“未修改”。

LSP：在现有 `readTextWithPolicy`/预检已经得到的原始 bytes 上收集诊断，不再全量重读来取附注。批量结果可增可选诊断集合；实际工具/RPC 消费方必须渲染，不能只有内部 helper 有数据。预检和重命名后的策略以实际逻辑路径解析，不诊断旧路径后套用于新路径。重复编辑同一文件只呈现需要的去重信息，未实际执行/跳过的操作不说已经写入。

不把诊断重构成事务：编码/声明预检失败维持 zero-write；I/O 失败和取消维持原有真实执行前缀/错误报告。若发现已有事务缺陷，记录独立问题，不在此任务中宣称已经修复所有保存保证。

### A3. AST 的原生诊断

涉及 `crates/pi-natives/src/ast.rs`、现有 `crates/pi-natives/src/encoding.rs` 共享解码诊断入口、必要的 `crates/pi-edit/src/encoding.rs` 公共 helper、`src/tools/ast-edit.ts` 及已有 AST 原生结果类型/聚合。普通 search/read AST 同入口时应一致核查，不只修改 UI 文本。

在 `read_candidate_source` 已读取 bytes 的位置复用 Rust predicate；当前 strict GBK 错误的 offset 信息保留，满足证据条件时追加 UTF-8 确定性提示。成功诊断用可选专用集合传回 TS（不塞进 parseErrors 冒充语法错误），TS 多目标聚合时保留并去重，在预览与最终 apply 中分别呈现各次实际观察。原始 bytes 有界验证，明确超过诊断预算时没有整文件证明。

原生 `pending_writes` 的编码预检保留。apply 重新运行时必须根据本次 bytes/策略得出附注，不能只复用旧 preview 的诊断；dry-run 不写盘。桥/内部 URL 没有可信 bytes 时保留边界，不转成偷偷读取远程原文。绑定用 build:native 生成，不手改生成文件。

### A4. read >4 MiB 的窗口诊断

在 `streamLinesFromFile` 及实际输出消费者上接入；其当前解码入口按行聚合 bytes 后严格解码，不需要另写流式 GBK codec。只诊断已取到的完整行/连续字节范围（不把为了 seek 而经过的前缀或未显示尾部称为输出窗口）。复用原有 bytes，额外预算至多 4 MiB。

跨块、跨 UTF-8/GBK 多字节的原始片段必须先合成完整诊断单位。显示截断不是编码错误；超预算、尾部不完整或非连续区域缺证据时报告诊断范围不完整，不伪造合法/非法整文件结论。可给窗口级歧义/失败提示，同时保留严格读取失败。文件级 BOM 冲突仍在既有入口处理；非零偏移窗口起始 bytes 不能被当成文件头。

没有额外尾部扫描。额外内存上限只约束本功能，不能因此宣称现有 reader 的任意超长单行也已经消除所有内存风险。

### A5. 行为验收

| 场景 | 必须观察到的结果 |
| --- | --- |
| 已有双合法非 ASCII 文件，GBK default | write/LSP/AST 的模型可见结果有 scoped 附注；落盘仍按 GBK |
| 显式 utf8/gbk override、ASCII、策略禁用/未管理 | 无该歧义提示，原行为不变 |
| UTF-8 BOM 在 GBK 规则下 | 保留策略冲突，不能把 BOM 当普通歧义 |
| 合法 UTF-8、非法 GBK 输入 | AST/LSP/read 错误依据实际诊断范围附确定性提示；失败不写坏源文件 |
| 多文件其中一项输出不可 GBK 表达 | 保持现有预检 zero-write，用实际源 bytes 比较证明 |
| 预检后某次 I/O 失败 | 报告真实错误/已执行前缀，不宣称整批回滚；用可控故障接缝验证 |
| AST preview 后源内容或策略变化 | apply 诊断来自新输入，不沿用过期 preview 结论 |
| >4 MiB：所示窗口双合法，尾部非法 UTF-8 | 只报告该窗口歧义；不宣称整文件合法，不额外扫描尾部 |
| 多字节跨块、截断及超诊断预算 | 无截断引起的假确定性结论；范围/不完整状态可见 |

复用 `gbk-encoding-ambiguity.test.ts`、`gbk-search-ast.test.ts`、`gbk-lsp-recovery.test.ts`、`test/lsp/edits.test.ts` 和已有 read/write 测试夹具。只有证明新的实际消费者行为/负契约的用例，不写 source-grep 或夹具自身恒等测试。

## 3. B：PTY 共用既有输出解码器

涉及 `crates/pi-natives/src/pty.rs`、`src/tools/bash-interactive.ts`、`src/tools/bash.ts`、`src/exec/bash-executor.ts` 中使用 PtySession 的路径，以及 TUI 的真实 PTY 消费方；先检索所有 start/startArgv 调用和 PtyRunResult 消费。

1. 给 PtyStartOptions/PtyArgvStartOptions 增可选编码首选项；沿 PtyRunConfig 传到现有 reader，复用 `OutputDecoder::with_preference`，不改输入/resize/TERM/退格/ANSI 语义。
2. reader 的 EOF/错误、finish、pump 丢失和 drain 超时各自保留完成状态；读完摘要进入既有 OutputDecodeReport，一条合并的 PTY 读取方不能拆成虚构的 stdout/stderr 两条。
3. reader 没有完结、桥丢弃未解码 bytes、提前 detach 或无法确认排空时 unknown；统一编码/总计 absent。不在控制线程猜默认 UTF-8/0，不为了等待摘要无限 join 或破坏已有背压/排空超时。
4. 当前 reader 在 forwarding=false 后会丢弃 bytes 而不解码。这时不能出完整摘要；可以维持该性能策略并标 unknown，也可继续解码丢弃输出，但须实测成本。不要把已解码前缀的摘要当整流。
5. PtyRunResult 新字段透传到交互/普通 PTY 执行结果，复用 bash 的来源提示。参数真的接入后才删除旧 Ignored outputEncoding 提示；支持面仍不完整则保留明确限制。只报告缺省实际模式，不说原始编码被可靠探测。

验收包括真实 Windows ConPTY 的显式 UTF-8/GBK、自动模式、多字节跨 chunk、ANSI 控制序列、EOF 悬挂字节、取消/超时/桥失效；消费者的模拟与真 PTY 测试分开记录。复用当前 PTY/bridge 测试，不增加忙轮询。Unix 不可运行则保留 UNVERIFIED。

## 4. C：eval 原始 bytes 传输，避免第二套 decoder

涉及 `eval/py/runner.py`、`eval/py/kernel.ts`、`eval/kernel-base.ts`、`eval/py/executor.ts` 和真实 EvalTool 结果/参数消费者。先核对 runner/host 的现有帧类型、请求状态、完成与取消逻辑；JS eval 也有 Buffer/stdout 捕获，须单独列状态，不据 Python 接入称整个 eval 全覆盖。

推荐复用：Python 的 bytes 通过有版本/能力协商的 NDJSON raw-output 帧（例如 base64）传到 host，再由现有 native OutputDecoder 解码。JSON 帧自身仍 UTF-8；不是把已错误 decode 的字符串重新编码来冒充原始 bytes。普通 Python str stdout/stderr/display 按原文本协议，不二次解码。

每条 raw 流标识与 request id 分离；使用 start/chunk/end（以及异常/不完整状态），每流一个 decoder、有限大小 chunk、按 seq 检查顺序、EOF finish 后才记摘要。缺 end、重复/非法帧、kernel 死亡、超时和丢弃后的未验证尾部都给 unknown，不补默认值。新增 optional 字段兼容老 runner/host；协商不支持时保留明确的未接入状态，不能无声降级后声称参数已生效。不要给每个 chunk 发一次同步 tool RPC。

### C1. `!`、shell helper 与独立子进程 PIPE 先完成

`_stream_process_output` 有单独生命周期，可在现有 os.read 点发送原 bytes，EOF 发结束帧。限流不阻止 drain：显示预算耗尽后仍需要排空；摘要是否覆盖丢弃部分须明确。Python 中原本使用 locale 严格解码、以及依赖该 codec 的 limiter/capture 也必须核查；host 接入后显示预算按已解码的 UTF-8 文本统一计量，避免用 CP936 重新编码 limiter 而失败。保留 shell 帮助函数的返回值/捕获结果契约；若 helper 同时需要本地文本，应复用 host 解码响应/既有异步 bridge，先记录可行协议，不能悄悄保留另一套 GBK 自动检测器。

### C2. fd-1 是跨请求的管道，不能套用 C1 的结束规则

当前 `_drain_captured_stdout` 的 decoder 活到 kernel 结束，读取时根据 capture_rid 归属请求。请求 done 不等于 EOF，后台子进程可晚到、多请求可重叠、字符可跨请求。不得在每个请求 done 时强制 finish/reset、把残片转移到下一次执行、或把上次 fallback 状态与累计计数当下一请求结果。

优先复用现有请求捕获/串行化机制形成有证明的边界；只有实际实现并验证了原始字节的 request ownership 与完成屏障，才能报告完整的单请求摘要。没有这种证明时保留 kernel-scope stream，按序解码原字节可改善显示，但单请求来源保持不完整/unknown；已观测模式与 scope 可见，不声称该请求全部输出编码一致。原始捕获不能归属到活跃请求的 bytes 不挪给别的请求。这个有限阶段允许交付，但矩阵必须保留“fd-1 请求归属/完整摘要未完成”。

验收复用 `test/eval/py/runner-shell-output.test.ts`、`runner-request-dispatch.test.ts`、实际 PythonKernel/EvalTool 和后台/超时测试：raw GBK/UTF-8、chunk 切开字符、PIPE 正常 EOF、fd-1 晚到、两请求重叠、残片跨边界、截断仍 drain、kill 无 end、新旧帧兼容。用户代码自身错误 decode 的合法字符串仍不可恢复，不能把这个事实用来拒绝处理 raw bytes。

## 5. 平台与原生未知分支的证据工作

Unix/symlink 保留原测试、在已有可用环境运行；不安装 WSL、不提权或改开发者模式，不换 hardlink 作证明。可控同步不是外部环境许可问题：在 Rust 内部测试中复用 reader/聚合接缝，以受控完成/取消/barrier 驱动 None/未落定分支，避免循环碰 250ms 竞争。只用私有测试设施，不增加生产用户开关。

N-API 的 Rust 转换可增加真实映射测试，保护 Option/列表/unknown；这仍不是实际 DLL 序列化/reader abort 端到端。能做多少报告多少，不能把几种证据合并成“原生链全过”。真实端到端尚不可稳定构造时，保留明确缺口并继续可实施路径，不重复等待设计者批准既有范围。

## 6. 门禁、交付和恢复

稳定 Rust 源码后先 `bun run build:native`，记录产物 hash，再运行 native 相关 TS 回归。生成绑定走 build:native；确需修改 RPC wire 时改源 schema/state.ts 并 gen:rpc，不能仅手改 SDK。完整代码阶段门禁用 `bun check`、`bun run test:rs`、九文件 GBK + 新增路径和必要相邻套件；成功后不无理由反复重跑。

每阶段交付：具体源码文件与行为、消费者可见证据、诊断对象/作用域矩阵、真实 PASS/FAIL/SKIPPED/UNVERIFIED、实际测试日志数字和当前 hash。22 的 97/3038 是已有基线，不能原样抄成新功能验收；新增代码测试数按真实输出记录。失败定位到新变更，保留用户工作树；禁止 reset/restore 全部变更或以修改断言制造通过。

本设计没有执行源码修改、构建、提交、推送、评论、关闭 #3 或发布。后续代码验收前维持 #3 OPEN；发布必须新版本号和独立下载验包，不能覆盖 v18.8.7-gbk.1。源码增删改只走 edit/apply_patch/write，不通过 Python/sed/perl shell 改写。运行项目 Python runner 测试不等于使用 Python 代劳源码编辑。

## 7. 发给实现 AI 的完整 Prompt

```text
你是 ompg 后续实现工程师，工作目录 D:\Projects\GitProjects\oh-my-pi，分支 feat/gbk-text-io，HEAD 0cbb33a59c。先读 AGENTS.md、git status/diff、02 契约、21 第 7 节、已校正的 22 和 23 号设计。21 的 P2 已验收，不重做。保留当前全部未提交工作。

22 是现状清单，不是剩余路径的完成交付。设计者已在 23 批准有限的 write/LSP/AST/read 窗口诊断，以及后续 PTY/eval 原始 bytes 协议接入。无需再以“要批准写前读取/附注”为由暂停，但歧义只警告，不授权自动改编码或阻止写入。

当前先完整实施 23 的 A1—A5：扩展现有共享诊断语义明确 file/window 和已验证范围；write 仅对有资格的已有小文件有限预检，复用已有缓冲；LSP 利用已有原 bytes/预检收集并由真实消费者呈现；AST 走 crates/pi-natives/src/ast.rs 的 read_candidate_source 与 pending_writes 原生链，不误接 TS LSP；大文件在 streamLinesFromFile 仅诊断已得到的完整窗口，有界且不扫尾部。调用现有 Rust predicate/strict codec，不新写检测器。成功双合法和严格 GBK 失败的 UTF-8 证明分开，override/ASCII/BOM 行为保留；列表/缓冲有上限。实际完成代码与行为回归，不再只产出同样的现状矩阵。

预检只保护可预测编码错误的 zero-write，不许声称 I/O/取消整批原子回滚。保留 LSP executed-prefix、AST preview/apply 再验证及现有写后校验/快照/ACP bridge 安全边界。更新 02 的扩展合同和覆盖矩阵，保留历史提示。完成 A 后交付设计者复核，再按 23 的 B/C 顺序继续，不同时重构所有入口。

后续 PTY 沿现有 OutputDecoder 参数/摘要贯通，不改终端输入/控制序列/背压，不为摘要无限 join。eval 使用 raw bytes 传给 host 复用 native decoder，分开每子进程 PIPE 和 kernel 生命周期 fd-1；done 不等于 EOF，无 request ownership/结束证据时标 unknown，不重置残片或虚报完整来源。用户代码内部错误 decode 字符串仍不可逆。JS eval 单列，不凭 Python 接入称全覆盖。

Unix/symlink 环境不可用如实保留阻塞，不安装 WSL、不改权限。Rust 未落定 reader 的可控同步是测试接缝任务，推进可做的证据，不碰 250ms 竞争制造偶发通过。区分 Rust 映射、N-API 真实序列化、实际 reader abort，不能以 mock 合并冒充。

源码只用 edit/apply_patch/write，不经 shell Python/sed/perl 改写。Rust 稳定后先 build:native 并记 hash，再跑九文件/新增路径回归；完整门禁 bun check、bun run test:rs，生成绑定/SDK 沿仓库流程。按实际结果报告 PASS/FAIL/SKIPPED/UNVERIFIED 与范围、日志数字，原 97/3038 只是基线。不要 reset/restore 用户修改；不改 E630、安装、配置或停止用户进程。

没有源码验收前不 commit/push、发布、评论或关闭 #3，不改 memory。新发布须新版本号及下载验包，不覆盖 v18.8.7-gbk.1。最终交付先说明具体完成了什么和仍缺什么，不把设计或旧门禁写成新功能完成。
```
