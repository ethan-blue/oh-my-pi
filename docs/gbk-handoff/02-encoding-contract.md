# 02 — 编码与文件完整性契约

> 2026-10-10 修订：下文保留初期设计背景；当前发布后改进以 [14-issue-remediation-design.md](14-issue-remediation-design.md) 为准。新文件也必须命中 include；override 只细化覆盖范围，不能独立扩大范围。未覆盖的文本按严格 UTF-8 处理，不输出解码替换内容。启用且覆盖非空的策略必须令 newFileEncoding 与 defaultEncoding 一致，混合目录通过 include 内的 override 表达。Python 源码声明与目标编码冲突时写前拒绝。实现及测试状态另见本轮验收记录，不能用设计文档代替验收。
>
> 2026-10-11 补充（G4/G5）：见第 9 节——GBK include 命中字节的 UTF-8 歧义诊断协议与子进程输出解码来源协议。两者都只做字节级判定和可观察标注，不做内容猜测，不自动改写明确策略。

## 1. 单一策略、两层接入

建议由 Rust 维护严格 codec 和字节语义，通过现有 N-API 提供给 TS。TS 负责项目策略、错误显示和工具集成，Rust 编辑/搜索路径直接复用同一语义。最终模块放置由 P02 决定；不得为了追求“一个函数”制造 Rust↔JS 每行往返。

初版候选依赖为 `encoding_rs`，当前仅见于传递依赖。采用前必须验证 GBK/CP936 边缘字符、严格错误及往返行为；不要假定它完整等同于用户编译器的代码页。

保留上游内部 Unicode 字符串模型。磁盘字节、解码文本、规范化编辑文本分别命名；不能继续让变量叫 raw bytes，实际却是 UTF-8 String。

## 2. 项目策略的拟定格式

拟新增 `.omp/encoding.json`，这是 Fork 专用文件，尚未实现。优先使用这个独立文件，避免把未知配置字段写进原版的 `.omp/config.yml`；上游通用设置继续通过原注册机制处理。

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "include": ["src/**/*.c", "src/**/*.h", "resources/**/*.rc"],
  "defaultEncoding": "gbk",
  "newFileEncoding": "gbk",
  "overrides": [
    { "glob": "src/vendor-utf8/**", "encoding": "utf8" }
  ]
}
```

以上目录是示例，不是已探测到的 E630 目录。接手 AI 必须实现 schema 验证、文档和测试后才能推荐用户创建该文件。

| 情形 | 规定行为 |
| --- | --- |
| 无策略文件 / enabled=false | 保持原有工具行为，不全局扫描、转码或猜测 |
| 命中 include 的文件 | 使用匹配的 override；无 override 时使用 defaultEncoding |
| 多条 override 命中 | 第一条生效，顺序写进文档和测试 |
| 新文件 | 路径 override 优先，否则 newFileEncoding；不得仅依据扩展名猜测 |
| 未命中 include | 保持上游行为；不得自动按 GBK 解释所有文件 |
| ASCII 文件 | 编码来自规则，不标记为“探测出 UTF-8” |
| 明确 GBK 规则遇到 UTF-8 BOM | 报告策略冲突，要求路径 override；不静默选择另一种编码 |
| 非法/未知编码值 | 启动或首次解析明确失败，不能退化成 UTF-8 保存 |
| GB18030 | 初版不承诺，若未实现则拒绝配置，不隐式代替 GBK |

策略 root 必须绑定当前项目的可信解析结果；路径 canonicalize、Windows 大小写、junction 和 symlink 的语义需要明确。可以复用上游项目定位逻辑，但禁止无边界地一路继承用户目录里的编码文件。

## 3. 文本文件状态

拟定内部记录至少表达以下语义，字段名称可按代码规范调整：

| 信息 | 用途 |
| --- | --- |
| 实际 canonical path 与展示路径 | 锁定、缓存、报错和工具输出 |
| 原始字节 / 原始字节摘要 | 无修改保持原样、并发检查、恢复 |
| 原编码与策略版本 | 决定保存，不从修改后文本反猜 |
| BOM 状态 | UTF-8 BOM 原样保留；GBK 不添加伪 BOM |
| 原换行与末尾换行信息 | 还原 CRLF/LF、末尾无换行；处理混合换行 |
| 解码文本及规范化文本 | 显示、Hashline、AST 等采用一致输入 |
| 读取版本和持有的锁/事务状态 | apply 时验证、取消和并发错误处理 |

不要求每条小文件操作永久保留多个整文件副本。可以使用引用共享、临时缓冲和按需摘要，但不能因节省内存删掉安全检查。

## 4. 读取合同

2026-10-09 补充：未管理文件出现 UTF-8 解码错误时，提供有效策略、未命中路径及原生恢复步骤；不能自动认定 GBK，也不能回退到 Python/PowerShell 改写。源码范围包括测试、脚本与属性表，具体流程及验收见 [R10](11-native-tools-incident-plan.md)。

1. 原始字节只按明确 codec 严格解码；遇非法序列给出路径和字节位置，不能先用替换字符解码再编辑。
2. 已配置的 GBK 文本不应仅因不是 UTF-8 被当成二进制；二进制检查要与明确文本规则协调。
3. read 的分块边界不能切坏多字节序列；预览截断不等于合法编辑快照。
4. 小文件读取、流式读取、grep 命中、AST 摘要和快照必须得到同一 Unicode 文本。
5. 内部 JSON、会话、认证文件、SQLite、图片、压缩包不自动纳入 GBK 转换。

## 5. 写入合同

1. 更新已有文件时保留原编码；新文件遵守新文件规则；移动保留源文件编码，目的路径规则冲突时显式处理。
2. 编码前检查输出字符能否表达；输出编码后解码必须与预期文本一致，禁止替换或实体转义式降级。
3. 源字节往返不完全一致时拒绝普通编辑，除非明确采用可证明保留未编辑字节的方案。
4. 纯 no-op 不重写；原始 bytes 直接保留。不要把文件换行/时间戳变动冒充无修改。
5. 对混合换行，初版若不能精确保留则拒绝该文件写入并说明原因，不能自动全文件统一换行。
6. 先完成校验、构建候选 bytes，再进入受保护的保存阶段；不先 truncate 再尝试转码。
7. 返回成功前验证实际结果；读回失败与写入失败必须区分，不能把实际发生的写入报告为“未修改”。
8. 错误消息可指出 U+码点、行列和编码，但不得把整个源码、密钥或敏感内容写进日志。

## 6. 并发、取消和多文件

- 复用上游会话/文件版本机制，并明确进程内锁与外部 IDE 锁的不同保证。
- 检查原 bytes 后再写存在 TOCTOU；需要锁/受控句柄/版本策略，不能写“用了 SHA-256 所以绝对安全”。
- 不兼容的外部写入者无法被 Core 自动约束；在文档中说明同文件并发编辑边界，不宣称跨所有进程事务。
- 同目录临时文件和替换策略必须保留权限、ACL、symlink/junction 行为，兼容 Windows 文件占用；未经测试不能随意改底层保存机制。
- 取消发生在落盘前应不修改；落盘后应报告真实结果；不要释放锁而让后台写入继续悄悄完成。
- 多文件先预检，保留原始 bytes，失败时恢复并报告恢复状态；单文件原子替换不等于全批次原子提交。
- 出现恢复失败时保留恢复材料，列明受影响文件，阻止继续自动修改同一批次。

## 7. Hashline、AST、LSP 坐标

Hashline 继续使用上游规范化文本和算法。原始字节摘要只服务持久化完整性，不能替换 Hashline 协议。

AST parser 的 UTF-8 字节偏移对应解码后文本，不能直接拿去切 GBK bytes。应在同一文本坐标空间完成变更，再交给 codec 保存。

LSP position encoding 可能是 UTF-16/UTF-8 等协商值；不能把 GBK 字节数当列号。测试中文前后位置、非 BMP 字符出现在 UTF-8 文件的情况。

## 8. 设计审批记录

P02 结束时写一个短 ADR，记录 codec 选择、策略 root、模块边界、错误模型、缓存键和保存保证。接手 AI 可以自主做实现取舍；偏离本契约须给出具体原因和验证，不用以追求抽象完美为由重构无关模块。

## 9. G4/G5 协议（2026-10-11）

### 9.1 编码歧义诊断（G4）

无 BOM 的一段非 ASCII 字节可能同时严格合法于 UTF-8 与 GBK，两种解读产出不同文本；无法靠“中文常见度”判定原编码。本协议把歧义变成可观察信息，不猜测、不切换编码：

| 情形 | 规定行为 |
| --- | --- |
| include+default 解出 GBK，且字节无 BOM、含非 ASCII、也严格合法于 UTF-8 | 按策略继续解码（明确策略优先），但 read（含 `:raw`）结果、grep 结果备注、edit 结果附注报告歧义，并指出显式 override 是解决手段 |
| 同上，但路径由 override 命中 | 不再标注：override 是用户对该路径的显式回答 |
| 纯 ASCII 文件 | 不标注：两种编码解读相同，没有歧义 |
| 严格 GBK 解码失败，且字节（无 BOM、非 ASCII）合法于 UTF-8 | 错误信息明确“字节合法于 UTF-8 且不合法于 GBK”——这是确定性结论（该文件不可能是 GBK），read/grep/readTextWithPolicy 一致 |
| 频率/密度/替换符计数启发式 | 禁止用于自动改写编码或覆盖策略 |

判定函数只有字节有效性（`utf8_ambiguous_with_gbk`：无 BOM ∧ 含 >0x7F 字节 ∧ 严格 UTF-8 合法），在 Rust `pi-edit::encoding` 实现一次，原生导出给 TS 复用；不在各工具复制判定。

**扩展协议路径（2026-10-11，Phase A 返工规范）**：
1. **双合法与失败提示的严格前置条件**：双合法判定必须同时满足（1）严格 GBK 解码成功、（2）无 BOM 且含非 ASCII 字节、（3）完整原始字节严格合法于 UTF-8、（4）未被显式 override 覆盖。严格 GBK 失败转入独立的确定性错误提示分支（证明该完整行/文件不是 GBK），二者严格分开，不靠调用者默契。
2. **`read` 工具**：≤4 MiB 保持整文件（`wholeFileBytes`）诊断；>4 MiB 流式读取直接聚合 streaming 实际捕获的未重新编码完整行原始字节（≤4 MiB 预算），绝不使用二次 encodeStrict 回构字节，以杜绝非规范 GBK 映射（如 `e0 a0 a2 e3 80 80`）的失真；输出明确标注 `(lines ...)` 窗口范围，不扫描未读尾部，不把窗口结论推断为整文件结论。chunk 开头必须合并真实保留的行前缀，不能把后半行当作整行；已扫描但不属于所选范围的证据叫 checked window。完整行可给确定性提示，残片/缺前缀/预算丢弃给 unavailable，保留严格读取错误。诊断副本在累计前限制，非 GBK 流不建立这份副本。
3. **`write` / `edit` 工具**：已有本地 GBK default 普通文件且没有 override 时有限预检；write 利用既有 stat 跳过明显大文件的读取，edit 复用同一个有界读取入口。获取时最多 4 MiB 正文加 1 字节超额探测，探测字节不参与整文件证明；超额或 I/O 失败明确 unavailable/budget 或 unavailable/io。正常保存和稳定性验证独立于新增诊断预算，可能需要全文读取。歧义或诊断未取得只附注，不阻止原本合法的保存；不可表达字符仍 zero-write。
4. **`LSP` 文本修改**：在 `precheckTextOpEncodings` 预检阶段复用已加载原始 bytes 收集歧义诊断（≤4 MiB），超预算明确 unavailable，不额外全量重读；实际 rename/code_actions 结果呈现上限 10 条并在超出时明确标出省略条数 `[... and N more encoding note(s) omitted]`，不减少成功操作计数；编码预检失败维持 zero-write。
5. **`AST`（ast_grep & ast_edit）**：
   - apply 生命周期：apply 必须重新从磁盘发现有效策略（`discoverEncodingPolicy`），供 freshPreview、预检、写入与 Hashline 快照一致使用，禁止复用 preview 闭包中的旧策略 JSON；
   - Hashline 快照：preview 与 apply 均通过 `readTextWithPolicy` 按策略解码，禁止使用默认 UTF-8 文本读取破坏 GBK 内容；
   - 零替换/stale 分支：完整保留本次观察到的诊断，不被提前 return 丢弃，不套用旧 preview 附注；stale 仍是错误，已执行前缀保持真实；
   - 列表限制：原生与聚合均严格限制上限 10 个去重文件，两个工具复用共享 formatter；超出时明确标注 `(further files omitted; total unknown)`，不伪造总数；AST 正常全文解析与 4 MiB UTF-8 诊断预算分开，超预算以可选 encodingDiagnostics 返回 unavailable，而非静默冒充检查过。

**诊断数据（28 号修复）**：TS helper 使用 kind、scope、checkedRange、complete、reason；ambiguous/checked/invalid-gbk/invalid-gbk-utf8/not-applicable/unavailable 分开。unavailable 已完整检查字节数为 0，不凭前缀给整文件结论；not-applicable 不声称完成编码检查。AST N-API notice 含 path、kind、scope、checkedByteLength、complete、reason，当前只输出 ambiguity 与 unavailable 行，普通检查结果保持静默。两侧字段适配范围相同，不复用 G5 的输出来源字段表示文件诊断。

当前行为与消费者证据见 [28-phase-a-direct-repair-verification.md](28-phase-a-direct-repair-verification.md)。AST preview/apply 分别 discovery，本次 native 输入、TS 稳定性预检与快照解码显式复用该策略；显式 null 固定本次无策略状态，避免再从文件目录发现不同的嵌套配置。下一次 apply 重新发现策略；编码选择绑定不等于任意外部并发文件修改下具备文件系统事务。

写入不因歧义被阻止（是否阻止写入须设计者另行批准）。

### 9.2 子进程输出解码来源协议（G5）

工具捕获的子进程 stdout/stderr 必须可观察“实际用什么编码解码”，并允许调用方显式声明编码；解码器统一复用 Rust `pi-shell::output_decode::OutputDecoder`，不并行实现第二套：

| 组成 | 规定行为 |
| --- | --- |
| 自动模式（缺省） | UTF-8 优先，Windows 上首个非法 UTF-8 序列后，后续字节永久切换到系统 ANSI 代码页（GetACP；非中文页如 1252 同样适用）；已经输出的 UTF-8 前缀不重新解码。来源摘要表示读取方最终采用的解码模式，不证明原始程序整流只使用一种编码，也不是可靠自动识别文件/输出原编码 |
| 显式 `gbk` | 整流按 CP936 解码，不做 UTF-8 尝试 |
| 显式 `utf8` | 仅 UTF-8；非法字节成为 U+FFFD，绝不回退 ANSI |
| 损失计量 | UTF-8/GBK 模式计解码器因非法序列产生的替换次数；ACP 模式按同一 Windows 映射对每个结构字符（单字节/双字节对）做严格校验（`MB_ERR_INVALID_CHARS`），记录被严格校验拒绝的序列数，输出保留 OS 的兼容映射——合法文本中本就存在的 `?` 或 U+FFFD 不计入，也不扫描解码结果猜测损失。该计量不是原始信息是否可逆的证明 |
| 逐读取方（reader）摘要 | 每个被捕获的读取方（内嵌 shell 的输出管道、`;`/`&&` 链的每个实际执行段、受保护 build 的 stdout/stderr 各一条、PTY 的单条合并流、eval 独立子进程 PIPE）各记一条：实际编码 + 损失数。生命周期与交付证据不完整时只记 unknown |
| 聚合语义 | `outputEncoding` 仅在**全部读取方都已落定且编码一致**时给出；混合来源保留在 `outputEncodings`（按首次出现顺序去重），不得挑首条非 UTF-8 或末段冒充整体；`outputReplacements` 仅在无未知读取方时求和；未落定的读取方计入 `outputEncodingUnknownReaders`，任何未知存在时 `outputEncoding`/`outputReplacements` 保持 absent——部分已知不冒充完整已知 |
| 结果报告 | bash 与 eval 共用来源提示，在非 UTF-8 解码、混合来源、存在替换或读取方未落定时附可见标注；仅“完整、一致、干净 UTF-8”静默。纯字符串输出不虚构原始字节读取方；eval 每个 cell 的 details 保留四个可选来源字段 |
| 管道与链的责任边界 | `a | b` 管道的中间字节经内核管道传递、不被解码，只有末级 stdout 被捕获（一条读取方记录）；`;`/`&&` 命令链每段的捕获文本都进入用户输出，因此每段各记一条 |
| 覆盖面 | 内嵌 shell、受保护 build（ptree 注入原生解码器）、PTY、eval 已支持的原始字节捕获入口共用上述语义。Windows ConPTY 和 Python / JS 实际消费者证据见 29 号；不能据此声称所有外部进程或用户任意 stdio 路径均被捕获 |
| 不可逆边界 | 用户代码内部错误 decode 后产出的合法字符串不能可靠还原。Python 普通 str stdout/stderr/display 和 JS 普通字符串按原文本协议保留；仅原始 bytes 进入 decoder，不重新编码已错误文本 |

2026-10-11 的 B/C 实现取代此前“PTY 忽略参数 / eval runner 未接入”的阶段记录；行为与证据见 [29-pty-eval-direct-repair-verification.md](29-pty-eval-direct-repair-verification.md)。`execute_shell_streams` 原始字节路径本身仍不解码，解码责任与来源报告归消费方。

**PTY**：`start` / `startArgv` 接收可选 `outputEncoding`，在现有 Rust reader 中解码；真实 EOF、decoder finish 与 pump 交付成功共同成立才给完整摘要。取消、读取失败、桥失效、丢弃未解码 bytes、排空超时均 unknown，不为摘要无限等待。交互与 headless 消费方透传四字段；PTY stdout/stderr 是单条合并流。Windows ConPTY 输出已受系统终端转换影响，CP936 参数表示读取边界采用的解码方式，不能承诺恢复 ConPTY 转换前的 GBK bytes。

**Python 独立 PIPE**：host 请求声明 `rawOutputProtocol=1`；runner 发送 version 1 的 `raw_start/chunk/end/ack/abort`，原 bytes 通过 base64 传输，JSON 自身仍 UTF-8。每流独立 decoder、从 0 递增的 seq、request id 和 stream id 均需匹配。`raw_end` 只证明读取 EOF；host finish 后回送 decoded text，runner 完成文本消费并 `raw_ack` 匹配 EOF seq 后才记完整来源。done、kill 或缺 ACK 不能代替该屏障。没有此请求能力的旧式调用保留原文本协议，不据此声称 GBK 参数已生效；host / runner 应随同一构建更新，跨版本 runner 不在本轮验收范围。

原始帧最多 65536 bytes（base64 最多 87384 字符且另外校验实际字节数）；每请求最多 32 个活跃 raw reader、1024 个结束状态，stream id 最多 128 字符。Python PIPE 实际块为 8192 bytes，最多 8 个在途块；信用窗口与 EOF 响应等待上限 30 秒。host 的 stdout reader 不能等待 stdin flush，否则 runner 的文本回调再写 stdout 会造成双向管道死锁。显示 / helper 返回捕获按 UTF-8 文本预算计量，达到显示上限仍排空并计量全部 PIPE bytes。

**Python kernel fd-1**：无 request id 的 `kernel_bytes` 属于跨请求 kernel 生命周期。host 使用持续的 auto decoder，不在 cell done 时 finish/reset；跨请求残片继续留在同一 decoder。晚到 bytes 进入 64KiB UTF-8 尾部缓冲，单独显示 `kernel-scope output; request ownership unknown`，不塞进下一请求的 stdout callback。观察到该流后，请求来源报告含一个未知 kernel reader，统一编码和总损失保持 absent。此接入改善 raw bytes 显示，但未证明单请求归属与完整 EOF。

**JS**：默认 / UTF-8 encoding 的 `process.stdout/stderr.write(Uint8Array)` 经 worker 原 bytes 帧进入 host native decoder，按 runId 隔离，保留跨 chunk carry；纯字符串与明确指定其他 Buffer encoding 的原文本行为保留。请求完成不是持久 stdout/stderr 的 EOF；这些活跃 byte writer 计 unknown，不 finish 来伪造完整摘要。worker shared runtime 保持无 native addon 导入；继承原始子进程 stdio 而绕过 write hook 的路径不能冒称覆盖。

**策略缓存（R4 关联约定）**：`.omp/encoding.json` 的编译缓存与 edit store 的策略同步都必须以**文件内容**（JSON 文本）参与一致性判断；mtime/size 只能作性能提示，不能单独证明配置未变。同 mtime 的内容改写（含同字节的 override 重排、启停切换）必须在下一次 discovery 生效，并触发快照清空。
