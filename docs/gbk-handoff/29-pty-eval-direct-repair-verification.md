# PTY / eval 直接修复与验证

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`。
分支：`feat/gbk-text-io`；HEAD：`0cbb33a59cfe256f931735042b7101cb4f901ca9`。
依据：[23 号设计](23-next-phase-implementation-design.md)的 B/C 顺序、[02 编码协议](02-encoding-contract.md)和用户“直接参与修复、完整修改完”的授权。[28 号](28-phase-a-direct-repair-verification.md)保留 Phase A 的详细证据；其 native hash 是历史产物，本轮以第 7 节为准。

**本轮完成：PTY 编码参数与来源贯通；Python shell helper / `!` 独立 PIPE 原 bytes 双向传输与交付屏障；kernel fd-1 原 bytes 持续解码及独立 scope；JS byte-write 原 bytes 接入；EvalTool 实际消费者标注。全部复用既有 Rust OutputDecoder。**

这是本机代码与门禁验收。fd-1 单请求归属 / 完整摘要、JS 持久 writer EOF、Unix 实机与真实模型 / E630 验收仍有明确边界，不能改写成全产品已发布。全部既有未提交工作保留；没有 reset/restore、commit/push、发布、覆盖旧 ZIP、评论或关闭 #3，也没有修改 memory。

## 1. Phase B：真实 PTY 贯通

| 文件 | 完成行为 |
| --- | --- |
| `crates/pi-natives/src/pty.rs` | start/startArgv 的可选 output_encoding 进入既有 reader；使用 OutputDecoder::with_preference。单条合并 reader 记录 EOF / finish / forwarding / drain 的真实完成证据 |
| `crates/pi-natives/src/shell.rs` | 复用编码参数解析；pump_chunks 返回交付成功与否，原 shell 调用保持原 JoinHandle 契约 |
| `packages/natives/native/index.d.ts`、`index.js` | build:native 自动生成，保留四个可选 provenance 字段，没有手改生成文件 |
| `src/exec/bash-executor.ts` | headless user-shell 的 PTY 参数传递及正常 / 超时 / 取消结果字段透传 |
| `src/tools/bash-interactive.ts` | 交互 overlay 使用原 start/resize/input 链；最终结果保留 native 来源字段；start 异常标一个 unknown reader |
| `src/tools/bash.ts` | 真正接入后移除旧 Ignored outputEncoding 提示，复用共享来源格式化器 |

真实 EOF 包括正常读完与 PTY 平台结束信号；读取失败、forwarding=false 后丢弃未解码 bytes、JS 桥失败、取消或无法证实排空，都不能给默认 utf8/0。reader 摘要在 Done 前独立送出，避免线程退出检查竞争；pump 必须成功交付。沿用既有排空时限，不为摘要增加无限 join 或忙轮询。

Windows ConPTY 先进行系统终端转换。真实 Windows 测试证明 UTF-8 文本、CP936 参数传到 reader、取消时 unknown，以及实际交互消费者透传；不把写入子进程的 GBK bytes 当作必然原样穿过 ConPTY。POSIX raw GBK 跨块测试保留，在 Windows 明确 SKIPPED。

## 2. Phase C1：Python 独立 PIPE 的字节与文本闭环

| 文件 | 完成行为 |
| --- | --- |
| `src/eval/output-decode.ts` | RawOutputReader 复用 native decoder，校验 seq / base64 / byte budget / EOF；OutputDecodeAccumulator 聚合已完成与 unknown reader，损失数饱和 uint32；bash/eval 共用提示 |
| `src/eval/kernel-base.ts` | 按请求和 stream 管理 reader、结束 seq、终态；异步回送 decoded text；仅匹配 raw_ack 后记录完整摘要；取消 / kernel 死亡复用统一 finalize |
| `src/eval/py/kernel.ts` | execute / kernel-defined tool 请求均携带 rawOutputProtocol=1，编码选项进入 host reader |
| `src/eval/py/runner.py` | 在现有 os.read 获取原 bytes，version 1 raw 帧发给 host；接收同 request / stream 的 native 解码文本，继续使用原 limiter / helper 捕获返回值 / pip 扫描回调 |

流程：`raw_start → raw_chunk(seq, base64) → raw_end(seq) → host finish / raw_text(done) → runner callback 完成 → raw_ack(seq)`。EOF 之前不 finish；没有消费 ACK 不发布完整摘要。重复 ID、缺 start、乱序、非法帧、重复 EOF、kill / 缺 ACK、raw_abort 都保留 unknown；同一失败 reader 的异常帧与后续 abort 不重复计数。已有完成观察可保留在 outputEncodings，存在未知时 uniform / total 一律 absent。

有界规则：raw bytes 每帧最多 65536，base64 最多 87384 字符且实际字节数另检；stream id ≤128 字符；每请求活跃 reader ≤32、结束 ID ≤1024。Python 实际 PIPE 每块 8192 bytes，最多八个在途块（64KiB 原 bytes 窗口，另有当前读取块）；信用等待和 EOF 屏障上限 30 秒。达到现有 1MiB / 3000 行显示预算后仍 drain，全部 bytes 的解码损失可计量，显示及返回捕获预算统一按 UTF-8 文本计算。

Windows cell 的 stdin reply reader 只活在同步 shell helper 窗口，EOF ACK 后退出并 join，再恢复用户代码 / imports；窗口期间其他请求保留在队列。kernel-defined tool 使用现有 control loop，不再竞争 stdin。响应丢失使 Windows reader 无法安全收尾时终止该测试/工具创建的 kernel，而非带着悬挂读取线程复用它。

普通 str stdout/stderr/display 保持原文本路径，纯文本不虚构 utf8/0。未声明 version 1 能力的独立旧式 runner 请求保留旧文本协议；新 host / runner 随同一构建部署。本轮没有做任意旧 runner 与新 host 的跨版本组合验收。

## 3. Phase C2：kernel fd-1 的生命周期边界

runner 的 fd-1 daemon 发送无 request id 的 kernel_bytes；host 的 auto decoder 活到 kernel 生命周期，不在每个 cell done 重置或 finish。跨请求 UTF-8 / GBK 残片留在同一 reader，后台或空闲期晚到 bytes 不归给“最近的请求”。

这些 bytes 进入最多 65536 UTF-8 bytes 的 TailBuffer，通过独立 kernelOutput 呈现，并带 `kernel-scope output; request ownership unknown`；超出预算显示 tail truncated。下一请求 stdout callback 不接收前一请求残片或晚到输出。观察过持续 kernel raw 流后，请求报告含一个 unknown kernel reader，不能给该请求统一编码或总损失；已经证明的独立 PIPE 编码观察仍保留。

**已覆盖 raw 捕获与持续解码，但未证明 kernel fd-1 的单请求所有权 / 完整 EOF 摘要。**这是 23 号 C2 允许的有限交付，不把 done 当 EOF，不把全 kernel 累计摘要冒充本次执行摘要。kernel-scope 流无 per-request 首选项，始终 auto。

## 4. JS 与真实 EvalTool 消费

| 文件组 | 完成行为 |
| --- | --- |
| `eval/js/shared/runtime.ts`、`worker-core.ts`、`worker-protocol.ts` | 可选 onBytes 捕获默认 / UTF-8 Buffer / Uint8Array stdout/stderr 写入；worker 分成 ≤64KiB 原 bytes 消息，shared runtime 无 native addon import |
| `eval/js/context-manager.ts`、`executor.ts`、`index.ts` | runId 隔离，late-settled 消息不借给下一执行；host native decoder 每流独立、保留 carry。兼容已有 VM 文本调用方 |
| `eval/executor-base.ts`、`backend.ts`、`backend-helpers.ts`、Python executor/index | 参数与四字段贯通；kernelOutput 带 scope 进入输出 sink；异常结果也保留来源信息 |
| `tools/eval.ts`、`packages/tui/src/tools/eval.ts` | schema 增可选 outputEncoding；每 cell details 保留来源字段，工具可见文本 / artifact sink 用同一提示格式化器 |

JS 普通字符串与明确指定其他 Buffer encoding 的既有文本行为保留。持续 process.stdout/stderr writer 在 cell done 没有真正 EOF，所以本轮 byte writer 报 unknown，不强行 finish。已错误 decode 的字符串不能再还原。继承子进程的原始 stdio 若绕过 patched write hook，不属于本轮接入证明；Python 用户任意后台线程的 helper 所有权也不冒称经过逐请求证明。

既有 Shell RPC 四字段继续兼容；Eval details 原本为通用对象，本轮不新增另一套专属 RPC 格式。源码可选字段保留原调用方式，Hashline、文件编码保留、保存校验与 Phase A scoped 诊断不被这轮输出改动替代。

## 5. 实际失败与修复，不放宽断言

| 复现 / 失败 | 根因与收口 |
| --- | --- |
| >1MiB PIPE 回归超时 | host stdout reader 等待 stdin flush，runner 文本 callback 又写 stdout，形成双向死锁。改为非阻塞回送、观察 flush 错误与有限超时，由八块信用窗口控制在途数据；现同例约 0.5 秒通过，尾部非法字节仍计量 |
| live PIPE 取消结果丢来源 | abort 分支直接 resolve 跳过 finalize；统一清理与来源聚合，真实 PythonKernel 取消回归 unknown=1，uniform / total absent |
| 65537 / 65538 bytes 通过 87384 字符限制 | base64 填充使字符长度不能精确代表 byte budget。先加回归复现 4 pass / 1 fail，再按填充计算实际长度，65536 合法、越界拒绝，序列状态不推进 |
| Rust 全套测试编译失败 | pump_chunks 返回 bool 后两个旧测试 fixture JoinHandle 类型未更新；用 async wrapper 保留原 fixture 类型，最后全套门禁退出 0 |
| Python 集成 fixture Windows 换行不符 | fixture 显式 encoding=utf8 / newline=''，保留原精确内容与 no-replay 断言，未改生产保存逻辑 |
| Windows 取消后错误要求 kernel 可复用 | 当前 Bun SIGINT 实际终止 kernel；Windows 断言真实 kernel 结束，POSIX 仍保留原后续 cell 可复用断言，平台证明分开 |
| Python 控制请求 `.resolves` 阻塞 | 直接 await 的真实协议探针成功，测试 promise matcher 妨碍 IPC 推进；五处先 await 再检查相同预期，不增加 sleep / 放宽断言 |

最终新增测试采用真实 PtySession、真实 headless overlay 消费、实际 PythonKernel 与 EvalTool。`raw-output-consumer.test.ts` 单独使用受控 Bun NDJSON 进程证明 BaseKernel 协议消费，不冒充实际 native 读取线程 abort。没有 source-grep 恒等测试，也没有关闭异常用例来制造通过。

## 6. 覆盖矩阵

| 路径 | 本轮行为 / 证据 | 仍不证明的范围 |
| --- | --- | --- |
| 文件 read / grep / write / edit / LSP / AST | Phase A 保留；GBK 九文件再次通过，详情见 28 | window 不等于全文件；预检不等于文件系统事务 |
| shell 链 / 管道 / protected build 双流 | 原来源协议回归保留并通过 | 未捕获管道中间级 bytes 不做来源声明 |
| native PTY / 交互消费 | Windows ConPTY 正常 UTF-8 / 显式 GBK 参数 / 取消 unknown，overlay 真实消费通过；drain 失败 Rust 用例通过 | POSIX raw GBK 跨块明确 skipped；终端视觉、所有控制序列 / 超时 / 桥故障的完整实机矩阵未穷尽 |
| Python 独立 PIPE | GBK 跨块、EOF 截断损失、helper 返回值、kernel-defined tool、队列请求、超显示预算 drain、真实取消通过 | 用户内部错误 decode 的字符串不可恢复；非官方 helper / 任意线程所有权未全覆盖 |
| Python kernel fd-1 | raw bytes、跨 cell 残片、空闲晚到、scope 隔离通过 | 单请求归属 / 完整摘要未完成，不伪造 |
| JS byte-write | 实际 EvalTool split GBK、原字符串、worker addon-free 相邻测试通过 | writer EOF 未证明；继承 raw stdio 绕过 write hook 未覆盖 |
| BaseKernel 异常协议 | 无 delivery ACK、ID 重用、乱序 + abort 聚合持久回归通过 | 受控协议进程不冒充 Rust / OS 真实 abort |
| Python 既有集成 / 相邻模块 | 显式开启 integration 14 pass；standalone legacy shell / controls 与 eval timeout / background / fallback / CLI 无 addon 测试通过 | NumPy / matplotlib 本机缺依赖的分支明确 skipped |

## 7. 最终门禁与产物

命令使用本机 Bun 1.4.2，Python 集成使用已安装 Python 3.14；Windows x64。日志保存在 `C:\Users\Ethan\AppData\Local\Temp`，可能被系统清理，数字与范围在此固化。

| 门禁 | 最终结果 | 日志 |
| --- | --- | --- |
| `bun run build:native` | PASS，退出 0，win32-x64-modern 优化构建，142 exports，15 const enum 修复 | `ompg-phase-bc-native-final.log` |
| GBK 九文件 + 新增 B/C 六文件 | **152 passed / 3 skipped / 0 failed / 560 assertions**，十五文件，17.38 秒，退出 0 | `ompg-phase-bc-full-delivery.log` |
| B/C 六文件单独复核 | 25 passed / 3 skipped / 0 failed / 96 assertions，6.40 秒，退出 0 | `ompg-phase-bc-capture-final.log` |
| `bun run test:rs` | **3039 passed / 4 skipped**，nextest；doctest 1 passed / 18 ignored；退出 0 | `ompg-phase-bc-rust-final.log` |
| `bun check` | **退出 0**；oxfmt 5903 文件、oxlint、17 包 typecheck、cargo fmt / clippy -D warnings | `ompg-phase-bc-check-delivery.log` |
| Python 既有全文件 integration（显式启用） | **14 passed / 3 skipped / 0 failed / 98 assertions**，7.98 秒，退出 0 | `ompg-phase-c-python-integration-final.log` |
| 相邻九文件 | 45 passed / 1 skipped / 0 failed / 119 assertions，退出 0 | `ompg-phase-bc-adjacent.log` |
| `git diff --check` | 退出 0，无空白错误 | 收尾命令现场结果 |

十五文件的三项 skip：POSIX-only raw GBK PTY 跨块；两项既有 Unix bash 环境测试。另有一项新真实 Windows 交互消费 **通过**，不能将那两项 skip 冒充 Windows 环境继承验证。Python integration 三项 skip：POSIX session 与两项 matplotlib；相邻 skip 为 NumPy 导入。各套件存在重复用例，**不把表中数字相加**当独立覆盖数。原九文件 127 项保留；Rust 较 28 增一个 drain 交付失败用例。

产物：`packages/natives/native/pi_natives.win32-x64-modern.node`。
SHA256：`c24e2d87b438044d98e4277374370d57be269506adbfde8ece1d728ae7d301f9`。
构建包含 tree-sitter / wasmtime 的既有 LNK4217 linker warning；退出码为 0，不称“无任何 warning”。最后的帧长度 / TS 测试修正未更改 Rust 生产逻辑，实际回归使用上述产物；native 不是发布 ZIP 或 CLI 安装包的替代验收。

## 8. 兼容、升级与仍需外部验收

1. 内部包名、CLI 并存方案与原 UTF-8 调用保留；编码参数和来源字段均可选。新部署必须成套携带 generated bindings、native 与 runner；只换 TS 或复用旧 native 不是有效升级。
2. 上游升级继续采用已有更新门禁：重放最小编码补丁、生成绑定、重建 native、运行 GBK / 新输出回归和 bun check / test:rs，失败停止发布。没有“私有 Core 改造未来零维护”的承诺。
3. 本机没有可用 Unix 实机 / WSL / Linux C 交叉工具链；此前 symlink EPERM 环境阻塞保留，未提权 / 改权限 / 换 hardlink。Unix 实际编译与 POSIX PTY 需要可用主机验证。
4. 真实模型、E630 商用工程、NumPy / matplotlib 缺依赖分支、独立 Release ZIP 下载验包仍未验证。源码门禁通过不替代它们。
5. #3 保持 OPEN；没有本轮发布。后续发布沿 07/08 的构建和回退流程使用新版本号，不覆盖 `v18.8.7-gbk.1`。现工作树包含前轮修改，不能用整体 reset/restore 撤销本轮。

使用说明已同步 `docs/tools/bash.md`、`docs/tools/eval.md` 和 `docs/python-repl.md` 的参数 / 来源 / raw 协议说明，两个包的 Unreleased CHANGELOG 记录本次行为。收尾通过 `gh issue view 3 --repo ethan-blue/oh-my-pi --json number,state,url,title` 只读确认 #3 当前为 OPEN；没有发评论或修改 issue。

**可执行源码阶段已收口，尚余上表明确的范围限制和外部验收。**未知信息明确呈现；不以猜测 utf8/0、强制 finish、吞错、跳过失败断言或绕过原生文件工具来换取“完整支持”的表述。
