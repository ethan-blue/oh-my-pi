# Issue 3 G4/G5 编码协议验收记录

日期：2026-10-11（第二轮返工更新）。仓库：`ethan-blue/oh-my-pi`，分支 `feat/gbk-text-io`，基线 HEAD `0cbb33a59c`（前一轮 G1/G2/G3/G6 修复已由设计者验收提交于 `b65a86c806`）。设计依据：[14-issue-remediation-design.md](14-issue-remediation-design.md) 第 3 节 G4/G5、[15-issue3-encoding-verification.md](15-issue3-encoding-verification.md) 第 5 节交接方案、[18-g4-g5-designer-review.md](18-g4-g5-designer-review.md) 返工清单。协议定义见 [02-encoding-contract.md](02-encoding-contract.md) 第 9 节。

第一轮实现（本文件首次版本）经设计者独立复核对 G4/G5 **不通过**（见第 6 节与 18 号文档）；第二轮已按 R1—R5 完成返工（见第 7 节）。全部修改仍未提交；本文"待设计者复核"为提交复核时的实现者判断，最终验收与 issue 3 关闭归设计者。

## 1. 本轮行为和范围（第二轮后现状）

| 项目 | 状态（待设计者复核） | 可观察行为及剩余范围 |
| --- | --- | --- |
| G4 歧义诊断 | 待复核 | include+default 解码 GBK 且字节无 BOM、含非 ASCII、也严格合法于 UTF-8 时：read（含 `:raw`）结果、grep 结果备注、edit 结果附注报告歧义并指向显式 override；override 命中的路径不再标注；纯 ASCII 不标注；严格 GBK 失败且字节合法 UTF-8 时错误明确"字节合法于 UTF-8 且不合法于 GBK"（确定性结论）。策略解码不变，无频率/密度猜测。override 来源依赖 R4 修复的内容校验缓存。 |
| G5 输出编码协议 | 待复核 | bash `outputEncoding`（`gbk`=整流 CP936、`utf8`=仅 UTF-8、缺省 auto）；**逐读取方**来源：uniform 编码只在全部读取方落定且一致时给出，混合来源保留在 `outputEncodings`，未落定读取方计入 `outputEncodingUnknownReaders` 且 `outputEncoding`/`outputReplacements` 保持 absent；损失计数 UTF-8/GBK 模式计 U+FFFD、ACP 模式以严格校验计 OS 默认字符替代。覆盖内嵌 shell（含 `;`/`&&` 链逐段聚合、跳段、捕获溢出、管道单读取方）与受保护 build（stdout/stderr 双流 + full-stderr 重解码共用注入工厂）。 |

G4/G5 之外（G1/G2/G3/G6）本轮未改动；issue 3 仍为六项集合，关闭判断归设计者。

## 2. 根因与实现入口（第二轮后现状）

### G4 根因

无 BOM 的非 ASCII 字节可同时严格合法于 UTF-8 与 GBK（如 `// 中文` 的 UTF-8 字节按 GBK 读成 `// 涓枃`），两种解读产出不同文本；此前无 BOM 冲突检测只覆盖带 BOM 情形，双合法时静默按策略输出乱码，解码失败时错误只给偏移不指出字节证明。且策略 resolve 不区分"include 默认命中"与"显式 override 命中"，无法只对前者提示。

### G4 修改

- `crates/pi-edit/src/encoding.rs`：`utf8_ambiguous_with_gbk`（仅字节有效性：无 BOM ∧ 含 >0x7F ∧ 严格 UTF-8 合法）与 `resolve_detailed`/`ResolvedEncoding`（编码 + 是否 override 命中）；单元测试覆盖双合法、纯 ASCII、BOM、真 GBK、双非法、origin。
- `crates/pi-natives/src/encoding.rs`：`transcode_search_strict` 返回 `SearchTranscode { utf8_ambiguous }`（转码替换 buffer 前判定，仅 include 默认命中时置位）；GBK 解码失败且字节合法 UTF-8 时错误附确定性提示。新导出 `encodingUtf8AmbiguousWithGbk`；`EncodingPolicy` 新增 `resolveDetailed`。
- `crates/pi-natives/src/grep.rs`：`PassState` 收集歧义文件（去重、上限 10）；`GrepResult.ambiguousEncodingFiles`；单文件/递归/流式路径均携带。
- `packages/coding-agent/src/encoding/index.ts`：`gbkUtf8AmbiguityNotice`/`gbkDecodeFailureUtf8Hint`；`readTextWithPolicy` GBK 失败分支用确定性提示（覆盖 LSP 读取与 write 回读入口）。
- `packages/coding-agent/src/tools/read.ts`：≤4 MiB 缓冲路径通知（所有选择器共用出口）；strict GBK 失败优先确定性提示。
- `packages/coding-agent/src/tools/grep.ts`：歧义文件去重解析后并入 warningNote（零命中/有命中两出口）。
- `packages/coding-agent/src/edit/index.ts`：`#write` 首次落盘前预检（≤4 MiB，尽力而为），附注随编辑结果。

### G5 根因

三条捕获路径三种语义：内嵌 shell 与 PTY 用 Rust `OutputDecoder`（UTF-8→GetACP 回退，模式切换不可见）；受保护 build 走 ptree 的 UTF-8-only `TextDecoder`（非法字节静默 U+FFFD）；eval runner 自带 utf-8/replace 与 locale 严格两套。模型对"这个命令输出是什么编码"完全靠猜，结果也无从标注解码来源。

### G5 修改

- `crates/pi-shell/src/output_decode.rs`：偏好 `{Auto,Utf8,Gbk}`（Gbk 经 encoding_rs 跨平台）；`OutputDecodeMode`；`OutputDecodeSummary`；**`OutputDecodeReport`**（逐读取方 parts + unknown_readers 的聚合：uniform 仅全落定且一致、混合经 distinct 保留、总计仅在完整观测下给出）；**ACP 严格计数**（整窗 `MB_ERR_INVALID_CHARS` 严格解码，失败则按结构字符逐个严格校验计数，输出仍走同一 OS 映射的有损解码；不扫解码结果猜损失）。
- `crates/pi-shell/src/shell.rs`：偏好贯通 `ShellRunOptions→read_output*→CommandRunOutput.decode(OutputDecodeReport)`；单命令直通，**`;`/`&&` 分段链逐段 merge（跳段贡献为零；`a|b` 管道为单读取方——中间字节经内核管道不解码）**；`ShellRunResult{outputEncoding, outputEncodings, outputReplacements, outputEncodingUnknownReaders}`（serde 向后兼容默认）；取消/超时/原始字节流路径全部 absent。
- `crates/pi-natives/src/shell.rs`：napi options/result 四字段映射 + `OutputDecoder` N-API 类；`packages/natives/native/index.{d.ts,js}` 由 build:native 生成（142 exports）。
- `packages/utils/src/ptree.ts`：`StreamDecoder` + `outputDecoder` 工厂（stdout 读流、stderr 急排空、`wait({stderr:"full"})` 重解码三处；缺省行为不变）。
- `packages/coding-agent/src/exec/bash-executor.ts`：embedded 透传；**受保护 build 双流聚合（uniform 仅两流一致，混合各自保留）**。
- `packages/coding-agent/src/tools/bash.ts`：参数四变体；标注按"未落定 > 混合 > uniform 非 UTF-8 / 存在替换"分层，仅"完整、一致、干净 UTF-8"静默；`pty` 组合提示忽略。
- `packages/coding-agent/src/modes/rpc/wire/state.ts`（源）→ `gen:rpc` 生成四 SDK，rpc-wire 一致性类型通过。

### R4 修改（缓存内容校验）

- `packages/coding-agent/src/encoding/index.ts`：缓存命中需 mtime **且** JSON 内容一致（内容小读取换编译复用；单次工具操作复用同一已验证策略对象）。
- `packages/coding-agent/src/edit/store.ts`：`lastSyncedPolicy` 增记 json 参与比较，同 mtime 内容变化同样触发快照清空。

## 3. 实际验证（第二轮，native SHA256 `c2de2336321ca6d1cac06f4a46ab92b7b7f2c53e855f0a6c4a2691540fd791ca`，Windows x64 modern / local optimized / 142 exports）

| 命令/门禁 | 实际结果 |
| --- | --- |
| `bun test` 九文件（GBK 8 文件 + ptree-stderr） | **95 passed、0 failed、349 assertions**；含 18 号复现矩阵四格（utf8/auto × minimizer 开/关）全过 |
| `cargo nextest run -p pi-shell -E 'test(output_decode)+test(chain_provenance)+test(output_encoding_preference)'` | 31 passed |
| 相邻套件（bash 执行器×3 / read×4 / edit / write） | 110 passed、2 skipped、**1 failed = symlink containment（ENVIRONMENT BLOCKED：fixture `fs.symlink` EPERM，未触及产品逻辑；非通过，需权限允许的隔离环境复测）** |
| `cargo check -p pi-shell --target x86_64-unknown-linux-gnu` | **UNVERIFIED（阻塞）**：rustup target 已安装，但 pi-builtins→grep-pcre2→pcre2-sys 的构建脚本需为 Linux 目标编译 C，本机无 Linux C 交叉工具链；按约束不安装工具链/不提权，留待 Unix 实机验证 |
| 真实模型、E630/Keil、非 Windows 实机 | UNVERIFIED；未改用户工程或用户安装 |

### 最终门禁

| 门禁 | 结果 |
| --- | --- |
| `bun run test:rs` | PASS；nextest 3037 passed、4 skipped（较第一轮 +10：ACP 计数 5、聚合语义 3、链端到端 2）；doctest 1 passed、18 ignored，退出 0。 |
| `bun check` | PASS，退出 0；oxlint 0/0、oxfmt 全过、17 包 typecheck（含 rpc-wire 一致性）、Rust fmt + clippy（`-D warnings`）。 |

### 第一轮门禁存档与更正

第一轮报告"全部门禁通过（test:rs 3027/4、bun check 退出 0、GBK 七文件 69/0）"。**更正三处**：(1) 设计者实测首轮 GBK 套件首跑为 **68 通过、1 失败**（E29——R4 缺陷的偶发暴露），复跑 69/0 不能抵消首跑失败；本人第一轮未捕捉到该首跑，R4 修复后已有确定性回归。(2) 第一轮"86 passed…1 failed"一行把 symlink 环境阻塞列在通过口径下，不成立——该用例从未通过，保持 ENVIRONMENT BLOCKED。(3) 第一轮实现描述中"分段链取末段""`replacements()` 不计 ACP 替代""受保护 build 任一非 UTF-8 流优先上报"三处随 R2/R5 返工作废，以本文第 2 节为准。

## 4. 路径覆盖矩阵（已覆盖 / 未覆盖 / 不适用）

| 路径 | G4（文件歧义诊断） | G5（输出解码来源） |
| --- | --- | --- |
| read ≤4 MiB（含 `:raw`/多区间/摘要） | 已覆盖：成功标注 + 失败确定性提示 | 不适用 |
| read >4 MiB 流式 | 未覆盖：无整文件 UTF-8 判定，不标注、失败仅通用指引（不宣称未验证的结论、不加尾部扫描） | 不适用 |
| grep（单文件/递归/流式） | 已覆盖：列表备注 + 错误提示；诊断对象为实际搜索窗口 | 不适用 |
| edit（replace/patch/hashline 经 #write） | 已覆盖：写前预检附注（≤4 MiB，尽力而为） | 不适用 |
| write 工具 | 未覆盖：不读原字节、无附注（协议面 raw/read/grep/edit；写路径加诊断或阻止须设计者批准） | 不适用 |
| LSP 读取 / LSP 写入 / ast_edit | 读取已覆盖（失败提示）；写入结果无歧义附注（未覆盖） | 不适用 |
| bash 内嵌 shell（单命令/链/管道/溢出） | 不适用 | 已覆盖：单读取方、逐段聚合、跳段零贡献、捕获溢出仍计、管道单读取方 |
| bash `:async:` 后台 | 不适用 | 已覆盖：同前台管线（字段透传）；超时/取消结果按未落定 absent |
| 受保护 build（双流 + full-stderr） | 不适用 | 已覆盖 |
| PTY 交互路径 | 不适用 | 未覆盖：解码在 pty.rs（auto 语义），无显式参数/标注，组合时提示忽略 |
| eval runner 捕获边界（fd-1、`!` 子进程） | 不适用 | 未覆盖（候补）：runner 仍接触原始 bytes，是可接入本协议的真实边界，本轮未接入；与"用户代码内部错误 decode 后的合法字符串不可恢复"是两个不同边界，不能合并表述为"eval 全部排除" |
| 用户代码内部错误 decode | 不适用 | 不可能恢复（输入已是合法错误文本），非协议对象 |

另：ACP/客户端桥终端无原生解码来源，不标注；显式编码仅 `utf8`/`gbk`，非中文 ACP 只经自动回退并被如实报告（如 `cp1252`）。

## 5. 结论（实现者判断，最终判定归设计者）

| 项 | 判定 | 说明 |
| --- | --- | --- |
| G1/G2/G3/G6 | PASS（前轮 `b65a86c806`，两轮回归无退化） | 见 [16-issue-final-review.md](16-issue-final-review.md)。 |
| G4 | 待设计者复核（第一轮实现 + R4 缓存修复） | 诊断面 raw/read/grep/edit 用户可见；覆盖矩阵见第 4 节，未覆盖项如实保留。 |
| G5 | 待设计者复核（第一轮实现 + R1/R2/R3/R5 返工） | 逐读取方来源、未知传播、混合保留、ACP 严格计数；Unix 实机编译 UNVERIFIED（阻塞证据见第 3 节）。 |
| issue 1/2 | 已关闭（前轮） | 不在本轮范围。 |

实现者未提交、推送、发布、评论或关闭任何 issue；R1—R5 未全部复核通过前不称 G1—G6 全部验收。

## 6. 设计者独立复核（2026-10-11）

本报告的 PASS 为实现者提交复核时的判断，尚未获得最终验收。[18-g4-g5-designer-review.md](18-g4-g5-designer-review.md) 已记录独立发现：Unix 返回类型错误、命令链摘要丢失、未知摘要伪造、策略 mtime 缓存失效及 ACP 损失计量边界。设计者结论为不通过，issue 3 保持 OPEN；以 18 号文档的返工清单和完整 Prompt 接续。

## 7. 第二轮返工记录（R1—R5，2026-10-11）

| 项 | 根因 | 行为变化（返工后） | 回归与实际结果 |
| --- | --- | --- | --- |
| R1 Unix 编译 | `read_output` 返回类型改为摘要后，`cfg(unix)` 注册失败分支遗留空 `return;`（单位类型），Windows 门禁不编译该分支 | 该分支返回 `None`（随 R3 为 `Option<OutputDecodeSummary>`，未知而非默认 utf8/0） | Windows 全门禁过；Unix 实机 UNVERIFIED（阻塞见第 3 节），不以 Windows check 冒充 |
| R2 链/双流来源丢失 | 分段链仅保留末段 `last_decode`，注释对 `;`/`&&` 链的行为描述错误；受保护 build 双流"第一条非 UTF-8 优先"把两流冒充一种来源 | `OutputDecodeReport` 逐读取方聚合：`printf '\326\320\316\304\n'; printf 'done\n'` 在 utf8+minimizer=on 下 `outputReplacements=4`（原 0）；auto+minimizer=on 下无 uniform 宣称、`outputEncodings=[cp936,utf8]`（原 cp936 丢失）；stdout=UTF-8/stderr=GBK 双流各自正确并保留混合 | `gbk-output-chain.test.ts` 14 用例（设计者矩阵 4 格 + 多异常段/跳段/溢出/管道区分/双流混合/一致/工具级混合标注）全过；Rust `chain_provenance_*` 2 用例过；ptree full-stderr 注入专属用例过 |
| R3 伪造"utf8/0" | 读取线程未落定被映射为默认摘要并无条件 `Some(...)` 输出 | 未落定读取方计 `outputEncodingUnknownReaders`，`outputEncoding`/`outputReplacements` 保持 absent；bash 标注"provenance incomplete"；取消/超时路径维持全 absent | 单元 `report_unknown_reader_blocks_totals_but_keeps_observations_visible` 等过；消费者可见分支的确定性 e2e 不可稳定构造（读取线程 abort 依赖 250ms 竞争），按单元 + 类型贯通如实记录 |
| R4 缓存只认 mtime | discovery 缓存与 edit store 同步均仅比较 mtime；内容改写而 mtime 不变时旧规则生效（首轮 E29 偶发失败的根因） | 命中需 mtime+内容一致；同 mtime gbk→utf8、同 mtime 同大小 override 重排、同 mtime 启→停均在下一次 discovery 生效并清空快照；负缓存 TTL 上界经时钟推进验证 | `gbk-validation.test.ts` 新增 5 个确定性用例（utimes 钉死整秒 mtime 并守卫复现成立），全过，无 sleep/无断言放宽 |
| R5 ACP 损失计 0 | `drain_acp` 无标志 OS 解码不计数却返回 0 | 严格校验计数：`[0x81]` EOF → `?`、cp936、`replacements=1`（原 0）；合法 `?`/`€`(0x80)/CP1252 映射字节不计；非法 trail 对计入且合法邻居正常 | 单元 5 用例 + TS 3 用例全过；不扫解码结果、不重写字符表 |

**原有失败现状**：R1—R5 全部修复并有回归；symlink containment 用例保持 ENVIRONMENT BLOCKED（未通过、未跳过、不宣称验证了 containment）。

## 8. 第二轮设计者独立复核（2026-10-11）

设计者已重新构建最终 native（SHA256 与本文一致），重跑九文件 95/0、全仓 bun check、test:rs 3037/4（含 runnable doctest 1）。链的四格复现、双流混合、ACP 悬挂字节计数均已独立复现修正；模拟 native 部分摘要进入真实 BashTool 后，结果报告来源不完整且不宣称统一编码。

判定为**已测试 Windows 范围通过，整体 issue 3 未完全验收**。第 6 节为第一轮历史审查，不能当作第二轮现状；第二轮逐项结论、尚未覆盖的验证及后续 Prompt 见 [19-rework-final-review.md](19-rework-final-review.md)。Unix 实机、reader 未完成实际分支、symlink 及第 4 节未接入路径仍保留边界，不据此关闭 #3 或发布。

## 9. 第三轮实现者跟进（2026-10-11，按 19 号要求）

详见 [20-g4-g5-third-round-verification.md](20-g4-g5-third-round-verification.md)。

1. **R3 持久消费方回归**：在 `gbk-output-chain.test.ts` 中新增针对 `BashTool` 的持久确定性回归；在 `crates/pi-shell/src/shell.rs` 中新增 `provenance_with_unknown_readers_withholds_totals_and_uniform` 单测。明确将模拟实验与真实原生捕获证明隔离记录。
2. **跨主机与时钟修复**：`gbk-output-chain.test.ts` 6 处非 CP936 提前 return 全面切为 `it.skipIf(!hostAcpIsCp936())`；`gbk-validation.test.ts` 负缓存 TTL 测试在首次 discovery 前固定模拟时钟消除时序偶发竞争。
3. **门禁与环境状态**：九文件套件 **97/0 通过**（较上轮 +2）；`bun check` 通过；Rust `bun run test:rs` **3038 passed、4 skipped**（较上轮 +1）、doctest 1 passed；最新 native SHA256 为 `b439767f55434b702ba777ff69c0f299b3a7880e7eb5768ff6ff275dd97a0a29`。
4. **未验证与阻塞项**：Unix 实机编译因本机缺少 WSL/Docker/Linux C 工具链保持 **UNVERIFIED**；symlink containment 保持 **ENVIRONMENT BLOCKED**；#3 保持 OPEN。

## 10. 第三轮设计者独立复核（2026-10-11）

设计者独立重建 native 并复跑九文件 **97/0**、`bun check`、`test:rs` **3038 passed/4 skipped**（doctest 1 passed/18 ignored）。当前独立构建 hash 为 `8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480`，与第 9 节实现者此前产物分别记录。

**Windows 已测试实现范围通过；本轮仍需补真实 executeBash 边界的持久回归。** 新增 TS 两例 mock executeBash，实际覆盖 BashTool 格式化；设计者另在 Shell.run 接缝调用真实执行器和 BashTool，两类未知来源实验均过，但临时实验没有成为持久测试，也不是实际原生 reader abort。当前条件跳过实际为 7 处，第 9 节原“6 处”为实现者计数误差。

完整证据、报告校正、后续顺序及可复制 Prompt 见 [21-third-round-designer-review.md](21-third-round-designer-review.md)。整体 #3 继续 OPEN，未提交、推送或发布；第 6 节和后续历史记录保留。

## 11. 第三轮定点修补与口径校正交付（2026-10-11，按 21 号要求）

详见校正后的 [20-g4-g5-third-round-verification.md](20-g4-g5-third-round-verification.md)。

1. **R3 执行器接缝持久化**：在 `gbk-output-chain.test.ts` 中复用 `spyOn(Shell.prototype, "run")` 接缝（非直接 mock 执行器），真实调用 `executeBash` 断言 `outputEncoding`/`outputReplacements` undefined 且保留 `outputEncodings` 与 `outputEncodingUnknownReaders`；并在同一接缝驱动真实 `BashTool` 验证提示文本。
2. **口径全面校正**：skipIf 处数校正为 7 处；read ≤4 MiB 明确为 `wholeFileBytes` 整文件缓冲判定；普通 native 构建与 Rust 测试二进制分开记录；明确 R3 证据 5 层分工（Formatter、Executor、Rust 聚合、N-API 桥、真实 reader abort），真实 reader 未完成分支不以 mock 冒充。
3. **门禁**：九文件套件 **97/0 通过**（366 处断言）；`bun check` 全过；`test:rs` **3038 passed、4 skipped**、doctest **1 passed、18 ignored**；`git diff --check` 通过；#3 保持 OPEN。

## 12. 定点修补设计者验收（2026-10-11，当前）

**第 10 节指出的 P2 已修复并验收通过。** 设计者独立运行九文件 97 passed/0 failed、366 assertions，单独 R3 2 passed/0 failed、17 assertions，`bun check` 退出 0，Rust 3038 passed/4 skipped（doctest 1 passed/18 ignored）。native 磁盘 hash 仍为 `8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480`，本轮未重建。

R3 两例已经在 Shell.run 边界提供结果，再驱动真实 executeBash 和 BashTool，持久保护字段负契约；不再停留于 mock executeBash 的格式化检查。未知 reader 的真实 N-API/reader abort 证据仍未取得，Unix、symlink 和未接入协议路径仍按原矩阵保留。完整结论和后续指令见 [21 号第 7 节](21-third-round-designer-review.md#7-p2-定点修补最终验收2026-10-11最新)。整体 #3 OPEN，未提交、推送、发布或评论。
