# 第三轮设计者独立复核与定点交接

日期：2026-10-11。工作目录：`D:\Projects\GitProjects\oh-my-pi`。分支：`feat/gbk-text-io`；HEAD：`0cbb33a59cfe256f931735042b7101cb4f901ca9`。复核对象为工作树中的第三轮实现和 [20 号报告](20-g4-g5-third-round-verification.md)，不是已发布二进制。

**最新状态：第 7 节已验收本文件要求的 P2 定点修补。第 1—6 节保留上一轮审查与历史交接，不应再把“执行器持久回归缺失”视为当前状态。**

## 1. 判定

**已测试的 Windows 实现范围 PASS；R3 执行器边界的持久回归仍缺一项，不能按“全部证据补齐”验收。整体 issue 3 仍未完全完成。**

本轮没有发现新增的产品运行逻辑故障。负缓存 TTL 固定时钟、CP936 条件显式跳过、Rust 未知来源聚合以及 BashTool 提示格式均正确。执行器实际字段传递已由设计者临时实验验证正确，但现有两个新增 TS 测试没有覆盖这个边界，不能用它们代替持久回归或真实原生读取线程终止证明。

## 2. 唯一需补的本轮测试问题（P2）

定位：`packages/coding-agent/test/gbk-output-chain.test.ts:259`，第二例同类问题在 `:305`；报告范围见 20 号 §1 第 2 行。

两个用例通过 `spyOn(bashExecutor, "executeBash").mockResolvedValueOnce(...)` 直接提供已经处理好的 `BashResult`。`outputEncoding: undefined` 和 `outputReplacements: undefined` 是输入夹具，断言检查的是最终文本。测试实际运行了 BashTool 的格式化，**没有运行 executeBash，也没有断言执行器输出的结构字段**。

因此，即使 `src/exec/bash-executor.ts:930` 附近将未知编码改成默认 UTF-8/0，或丢弃 `outputEncodings`/unknown 数，这两个新增用例仍无法发现该退化。它们是有效的格式化测试，但 20 号报告所称“进入 executeBash/BashTool 后结构字段 absent 且来源保留”超出其实际覆盖。

修补应复用现有测试接缝：`test/bash-failure-result.test.ts` 和 `test/bash-executor.test.ts` 已有 `spyOn(Shell.prototype, "run")` 用法。不增加新的解码器、运行时开关或测试专用产品接口。

验收要求：

1. 在 `Shell.prototype.run` 边界提供部分摘要，真实调用 `executeBash`，断言统一编码和计数 undefined、已观测列表和 unknown 数保留。该断言保护下游诊断依赖的负契约，不能只检查夹具自身。
2. 在同一接缝下调用真实 BashTool，确保调用链经过真实执行器，并验证不完整提示及无错误统一编码声明。
3. 覆盖已知＋未知和纯未知两个分支；后者无 observed 前缀。复用现有会话设置并在 finally/afterEach 恢复 spy，避免污染全套测试；无需依赖主机 ACP 生成这些结构夹具。
4. 保留现有格式化覆盖，或用更完整的边界测试替代重复用例，不机械叠加相同断言。调整用例标题与报告，让 formatter、executor、Rust 聚合、N-API 桥和真实 reader 终止的证据分别可见。

## 3. 设计者独立执行证据

| 门禁/实验 | 实测结果 | 边界 |
| --- | --- | --- |
| `bun run build:native` | PASS，退出 0；local optimized、142 exports | 独立重建；约 2 分 33 秒，wasmtime 相关链接警告仍存在，不能写成无警告 |
| 重建后九文件 GBK | **97 passed、0 failed、356 assertions**，退出 0 | 当前 CP936 Windows 主机，约 10.75 秒 |
| 全仓 `bun check` | PASS，退出 0 | 格式检查 5897 文件、17 包类型检查、本机 Rust fmt/clippy |
| 全仓 `bun run test:rs` | **3038 passed、4 skipped**，退出 0 | runnable doctest **1 passed**；doctest **18 ignored**，与 nextest 的 4 skipped 分开计算 |
| R3 执行器临时边界实验 | PASS，两种摘要各经真实 executeBash 和 BashTool | 只替换 Shell.run；不是真实原生 reader abort，也尚未成为持久回归 |
| `git diff --check` | PASS | 文档交付后再次核对 |
| Unix 实机 | UNVERIFIED | 本轮 WSL 查询退出 1；未发现 docker/Linux C 交叉编译器命令。没有安装或改权限 |
| symlink containment | ENVIRONMENT BLOCKED / 本轮未重跑原用例 | 保留已有 EPERM 记录；本轮门禁不包含该安全路径，不能据 97/97 宣称它通过 |

临时边界实验结果：

```text
known+unknown: outputEncodings=[cp936], unknownReaders=1,
              outputEncoding=undefined, outputReplacements=undefined, PASS
all-unknown:  outputEncodings=undefined, unknownReaders=2,
              outputEncoding=undefined, outputReplacements=undefined, PASS
```

两例均从 Shell.run 流回调提供正文，真实执行器产生 BashResult，真实 BashTool 产生 incomplete 提示；已知＋未知有 observed，纯未知没有。此实验确认当前逻辑正确，不替代第 2 节要求的可持续测试。

本轮日志在 `%TEMP%\ompg-designer-third-native.log`、`ompg-designer-third-gbk.log`、`ompg-designer-third-check.log`、`ompg-designer-third-rust.log`。临时日志不承诺长期保存，本文件保留关键结果。

### native 产物对应关系

重建前磁盘 hash 确为实现者报告的 `b439767f55434b702ba777ff69c0f299b3a7880e7eb5768ff6ff275dd97a0a29`。设计者独立重建后，当前磁盘 hash 为：

```text
8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480
```

97 项回归针对本轮重建后的产物运行。两次构建字节并不相同，未执行可复现构建审计，不猜测具体差异原因，也不把 hash 变化当作源码错误。普通 native 构建没有包含 `#[test]` 用例；新增 Rust 用例由 `test:rs` 执行。“包含 R3 Rust 单测的新二进制”应改成“从当前源码重建，新增 Rust 单测另经 test:rs 验证”。本地 native 不是公开 release ZIP 的验包证据。

## 4. 报告需校正的范围

| 原表述 | 校正 |
| --- | --- |
| 20 号 §1 R3 两例覆盖 executeBash/BashTool 的结构字段 | 当前两例覆盖 BashTool 格式化；Rust 单测覆盖 with_provenance；真实执行器已有临时实验，但需持久化。N-API/reader 实际终止证明不能据 mock 推定 |
| 17/20 号的“6 处 skipIf” | 文件现有 **7 处** `it.skipIf(!hostAcpIsCp936())`；本轮只验证当前主机执行，未实跑非 CP936 主机的跳过报告 |
| read ≤4 MiB “缓冲读取窗口” | 该分支用 `wholeFileBytes` 缓冲整文件并诊断；选择器控制展示，不能与 grep 的实际搜索窗口混为一谈 |
| native“包含 R3 Rust 单测” | 普通 native 与测试二进制分开，见上节 |
| “已补齐证据” | 已补齐本机可执行的部分；Unix、symlink、真实读取线程未落定和矩阵未接入路径仍未通过 |

本文件是独立审查结论，不删除 17/18/19 的历史失败或设计者提示。20 号原始数字保留为实现者那一次执行记录；后续更新应注明轮次和实际测试产物，不能覆盖历史 hash 后声称两次完全一致。

## 5. 整体完成与发布边界

第 2 节是本轮优先补的、无需新环境的定点任务。之后继续按 19 号 §3 和 20 号矩阵处理真实 Unix、允许创建 symlink 的隔离环境、原生读取未完成的可控证据，以及 PTY、eval runner 原始 bytes、大文件诊断和 write/LSP/AST 写入结果的协议覆盖。

这些路径没有因第三轮测试数字增加而实现。用户代码已经错误 decode 得到的合法字符串仍不可逆；eval runner 接触原始 bytes 的捕获边界仍可接入，二者分开。对大文件明确诊断窗口，不扫描未搜索尾部以制造整文件证明。采用现有共享 codec/decoder，不改变用户明确的编码规则。

本轮读取 GitHub 确认 [issue 3](https://github.com/ethan-blue/oh-my-pi/issues/3) 为 OPEN。所有工作树修改保留，没有 commit/push、评论、关闭或发布。发布阶段应创建新版本、独立下载验包，不能覆盖 `v18.8.7-gbk.1`；不能据当前本地门禁声称公开二进制已经包含此轮修复。

## 6. 可直接发送给实现 AI 的 Prompt

```text
你是 ompg 实现与回归工程师。工作目录 D:\Projects\GitProjects\oh-my-pi，分支 feat/gbk-text-io，HEAD 0cbb33a59c。先读 AGENTS.md、git status/diff，以及 docs/gbk-handoff/17、19、20、21 号文档。21 是最新设计者复核；18 是历史返工依据。保留全部未提交工作，不 reset/restore，不重做已通过的 R1—R5。

当前 Windows 门禁由设计者独立复跑：97/97 GBK，bun check 退出 0，test:rs 3038 passed/4 skipped，doctest 1 passed/18 ignored。当前 native hash 8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480。20 号 b439... 是实现者前次构建产物，不能混写成同一次。

先只补 21 第 2 节的 P2：gbk-output-chain.test.ts 的新增 R3 用例 mock 了 executeBash，因此实际只验证 BashTool 格式化。复用 bash-failure-result.test.ts / bash-executor.test.ts 已有的 spyOn(Shell.prototype, "run") 接缝，在 native 返回边界提供已知+未知、纯未知两类 ShellRunResult。让真实 executeBash 运行，断言 outputEncoding/outputReplacements 为 undefined，outputEncodings 与 outputEncodingUnknownReaders 正确保留；再让真实 BashTool 经真实执行器生成 incomplete 提示，且不声称统一 UTF-8/cp936。测试必须能捕捉执行器把 undefined 改默认值或丢来源字段的退化，不能只断言夹具自身。恢复所有 spy，复用已有会话设置与清理方式，不用 mock.module，不增运行时接口，不复制解码器。保留有效格式化覆盖，避免重复测试。

同步修正 17/20 号报告：当前 skipIf 是 7 处；read <=4 MiB 是整文件缓冲诊断；普通 native 不包含 #[test] 代码；区分 BashTool formatter、真实 executeBash、Rust 聚合、N-API 桥以及原生 reader abort 的证据。保留原轮次、设计者历史提示和真实失败，不将临时 mock 实验描述为真实线程终止，不改原报告 hash 冒充同一次构建。

完成定点任务后，按 19 §3 / 20 矩阵继续剩余验证与协议路径。先给出每个共享边界的具体接入设计，复用已有 codec/decoder；明确整文件与实际搜索窗口，eval runner 原始 bytes 与用户内部错误 decode 分开。没有 Unix/symlink 环境则保留 UNVERIFIED/ENVIRONMENT BLOCKED，不自动安装 WSL、改系统权限或跳过测试制造通过。真实 reader 未落定验证使用可控同步/取消边界，不循环碰 250ms 时序竞争。不要据此关闭整体 #3。

源码修改只用 edit/apply_patch/write，不经 shell Python/sed/perl 修改源码。不要改用户 E630、安装、配置或停止用户进程。若只改 TS 测试/文档无需重复重建 native；Rust 源码改变则先 build:native，记录新 hash，再跑依赖 native 的九文件回归。完整门禁使用 bun check 和 bun run test:rs，不直接 cargo test。RPC/native 绑定沿既有生成流程维护。

交付逐项 PASS/FAIL/UNVERIFIED、实际日志数字、各证明边界和未完成列表；测试数字有变化须按实际输出记录。未获设计者完整验收前，不 commit/push、发布、评论或关闭 #3，不改 Codex memory。新发布须新版本号与独立下载验包，不能覆盖 v18.8.7-gbk.1。
```

## 7. P2 定点修补最终验收（2026-10-11，最新）

**判定：PASS。上一轮唯一指出的执行器持久回归缺口已补齐，不需要再返工该项。没有发现本次修补新增的代码问题。整体 issue 3 仍未完成，剩余平台证据与协议路径不因这次通过自动变为通过。**

实现者已将两个 TS 用例的 spy 移到 `Shell.prototype.run`。每例先调用真实 `executeBash`，断言其返回的编码、计数、列表和 unknown 数，再调用真实 BashTool 经执行器验证提示。已知＋未知及纯未知均覆盖；每个 spy 在 finally 恢复，单独过滤运行和九文件混合运行都通过。旧的 `spyOn(bashExecutor, "executeBash")` 已从这两个用例移除，因此执行器错误填默认值或丢字段会触发结构断言失败。

### 本轮独立实测

| 项目 | 结果 |
| --- | --- |
| 九文件 GBK 回归 | **97 passed、0 failed、366 assertions**，退出 0，约 16.73 秒 |
| 单独 R3 过滤运行 | **2 passed、0 failed、17 assertions**；另外 14 项 filtered out，不计为通过 |
| `bun check` | PASS，退出 0；17 包类型检查及本机 Rust fmt/clippy，格式检查 5897 文件 |
| `bun run test:rs` | **3038 passed、4 skipped**，退出 0；doctest **1 passed、18 ignored** |
| native | 磁盘 SHA256 仍为 `8e211aae69e3aadd6ba6b243681281ac3529d080ed2b45940202b64bb4635480`；本轮未重建，测试使用该产物 |
| `git diff --check` | PASS；记录追加后再次检查 |
| GitHub / 工作树 | HEAD 仍为 `0cbb33a59c`；#3 OPEN；没有提交、推送、发布或评论 |

本轮日志：`%TEMP%\ompg-designer-p2-gbk.log`、`ompg-designer-p2-check.log`、`ompg-designer-p2-rust.log`。单独 R3 命令：

```powershell
bun test packages/coding-agent/test/gbk-output-chain.test.ts --test-name-pattern 'R3 persistent'
```

### 两处报告边界已收紧，不要求代码返工

1. N-API 的普通已知/混合来源有真实 native 回归；未知 reader 的映射代码在 `crates/pi-natives/src/shell.rs` 已静态核对，并经类型/编译门禁。`Shell.run` spy 替代真实 native 调用，**不能证明未知 reader 穿过 N-API 的真实端到端行为**。这条路径及实际 reader 未完成仍 UNVERIFIED，不能写成 mock 已覆盖原生桥。
2. 两个 native hash 的差异原因没有审计证据，不能断言由环境变量或时间戳造成。20 号应仅记录产物不同、具体原因未验证，保留普通 native 与 Rust 测试二进制的区分。

### 后续交接

本次 P2 已由设计者验收，实现者可以继续既有计划中的剩余工作，无需再次等这一定点任务的确认。按 19 号 §3 与 20 号矩阵继续：可用 Unix 环境、允许 symlink 的隔离环境、可控的原生读取未完成证据，以及 PTY/eval runner 原始 bytes、大文件诊断和 write/LSP/AST 写入诊断。环境不可用时保留阻塞状态，推进不依赖该环境的共享边界设计；不自动改系统权限或安装 WSL。

```text
你继续负责 ompg 实现。先读 21 第 7 节：P2 执行器持久回归已经设计者独立验收，不重做，不重复请求该项批准。保留所有未提交工作和历史审查。按 19 第 3 节 / 20 覆盖矩阵继续剩余验证与协议路径：先核对实际共享读取/写入/输出捕获入口并记录接入设计，再复用现有 codec/decoder 实现可执行项。未知 reader 的 Shell.run 模拟只能证明执行器及消费者，不能冒充 N-API 或真实 reader abort；没有 Unix/symlink 环境如实保留 UNVERIFIED/ENVIRONMENT BLOCKED。维持前文的编码、窗口、工具编辑及系统保护约束。提交实际门禁、覆盖矩阵和待验证清单给设计者；整体 #3 未完全验收前不提交、推送、发布、评论或关闭，不修改 memory。
```
