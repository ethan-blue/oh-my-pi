# G4/G5 设计者独立复核与返工任务

日期：2026-10-11。工作目录：`D:\Projects\GitProjects\oh-my-pi`。当前 HEAD：`0cbb33a59cfe256f931735042b7101cb4f901ca9`。本轮实现是工作树中的未提交修改；原始报告见 [17-g4-g5-protocol-verification.md](17-g4-g5-protocol-verification.md)。

本文件保留第一轮复核及返工依据。R1—R5 的第二轮独立复核已记录于 [19-rework-final-review.md](19-rework-final-review.md)，后续执行应先读该文件，避免重复已通过的返工任务。

**验收结论：不通过。** 有效实现与已通过测试保留；不能据此关闭 issue 3、提交为完成状态或发布修复包。下列源码缺陷、元数据遗漏和缓存失效问题需要返工。#1/#2 的既有关闭状态不受影响；#3 已读取确认仍为 OPEN。

## 1. 证据范围

| 项目 | 设计者本轮结果 |
| --- | --- |
| Windows 全仓 `bun check` | PASS，退出 0。它没有编译 `cfg(unix)` 分支。 |
| Windows `bun run test:rs` | PASS，3027 passed、4 skipped；runnable doctest 1 passed，退出 0。 |
| 七文件 GBK 回归第一次 | FAIL，68 passed、1 failed；E29 更新策略后仍返回旧的 GBK 策略。 |
| E29 单独复跑 | PASS，1 passed、0 failed。不能抵消首次失败。 |
| 七文件 GBK 回归第二次 | PASS，69 passed、0 failed、246 assertions。说明时序用例不稳定，须有确定性回归。 |
| 编码缓存保留 mtime 的独立复现 | FAIL；磁盘配置已切成 UTF-8，下一次 discovery 仍返回 GBK。 |
| 分段命令链解码元数据独立复现 | FAIL；实际输出相同，开启 minimizer 后替换计数和自动回退编码均丢失。 |
| 混合 stdout/stderr 的 protected build | 文字正确，但来源信息不完整：stdout UTF-8、stderr GBK，结果只报告 cp936。 |
| symlink containment 单独复跑 | ENVIRONMENT BLOCKED；fixture 的 fs.symlink 报 EPERM，尚未调用产品逻辑。测试代码没有本轮改动；不能算通过或宣称本轮验证了 containment。 |
| Linux/macOS 实机编译 | UNVERIFIED；静态审查已发现确定的 Unix 返回类型错误。 |
| 新独立二进制、GitHub Release、真实模型/E630/Keil | UNVERIFIED，本轮未执行。 |

测试使用当前本地 native，SHA256：`30c679793188d1c074b8ebb3187e168a199b7ef8633ddacb04c9499ed31dedcd`。设计者没有重建或修改运行时代码。临时日志位于 `%TEMP%\ompg-designer-g4g5-{check,rust,gbk,gbk-repeat}.log`、`ompg-designer-policy-recheck.log`、`ompg-designer-symlink.log`。

## 2. 返工发现

### R1 / P1：Unix 输出读取分支不能编译

文件：`crates/pi-shell/src/shell.rs`，当前约 2004—2019 行。

`read_output` 返回类型已变成 `OutputDecodeSummary`，但 `#[cfg(unix)]` 的 `register_nonblocking_pipe` 失败分支仍为 `return;`，返回的是单位类型。Windows 门禁不会检查此分支。Unix 编译会因返回类型不匹配失败；不能将其归类为“非 Windows 未验证”后直接发布兼容上游的 Core 修改。

修复应与 R3 的未知来源语义一起做：注册失败要明确返回错误或无摘要，不能用默认 UTF-8 冒充已经解码。Unix 构建必须真实编译这条分支；没有可用环境则记录阻塞，保留未验收状态。

### R2 / P1：分段链丢失前面各段的来源和解码损失

文件：`crates/pi-shell/src/shell.rs`，当前约 1267—1365 行；同时核对 `packages/coding-agent/src/exec/bash-executor.ts` 的双流汇总。

`run_shell_command_segmented_chain` 每段覆盖 `last_decode`，最后只返回末段摘要。注释“前面各段只给下一阶段、不对用户输出”不符合这里的行为：这是 `;`/`&&` 命令链，各段文本均进入输出及 ChainCapture，不是仅捕获最后一段的管道。

独立复现命令：`printf '\326\320\316\304\n'; printf 'done\n'`。

| 执行选项 | 实际可见文本 | 结果字段 |
| --- | --- | --- |
| outputEncoding=utf8，minimizer=false | 四个 U+FFFD + 换行 + done | utf8，outputReplacements=4 |
| outputEncoding=utf8，minimizer=true | 同上 | utf8，outputReplacements=0（错误） |
| auto，minimizer=false，本机 ACP936 | 中文 + 换行 + done | cp936 |
| auto，minimizer=true，本机 ACP936 | 同上 | utf8（丢失前段 cp936） |

保护构建还有同类来源压缩：stdout 写 UTF-8 的中文、stderr 写 GBK 的中文，两条流均正确输出，结果却只有 cp936。一个进程的两个输出流不能预设使用同一编码。

设计要求：复用共享输出摘要，聚合所有实际执行且被捕获的段/流；计数只在全部相关部分可计数时求和，否则明确未知。来源应保留多种解码模式，可在原 optional 字段之外增加可选来源列表或每流/每段记录；旧字段的含义与混合来源标注必须明确，不允许只挑第一条非 UTF-8 或末段就宣称整个结果使用该编码。不要重新实现第二套解码器。

必须有 minimizer 开/关、前段异常后段纯 ASCII、多个异常段、末段跳过、不同流编码以及输出截断/aggregate overflow 的行为回归。管道中间原始 bytes 的责任与命令链各段输出的责任必须分开。

### R3 / P2：未得到读取摘要却伪造“UTF-8 / 0”

文件：`crates/pi-shell/src/shell.rs`，当前约 1520—1528、490—501 行。

读线程未完成或超时被终止时，`reader_output=None` 被映射成 `OutputDecodeSummary::default()`；外层随后无条件返回 Some(utf8)/Some(0)。旁边注释说“没有来源信息”，实现却给出肯定来源，违反新增字段文档所说的 unknown/None 行为。

摘要有效性必须贯通命令结果、链聚合、N-API、TS 和 RPC。未观测到的来源应保持 absent/unknown；部分已知也不能伪装成整流完整已知。测试应驱动 reader 未完成的实际分支，并验证最后对消费方返回的字段，不只断言默认构造器。

### R4 / P1：策略缓存只认 mtime，覆盖明确配置更新

文件：`packages/coding-agent/src/encoding/index.ts`，当前约 82 行；`test/gbk-validation.test.ts` 的 E29；核对 edit store 策略同步入口。

这是基线已有缺陷，本轮独立验收暴露，不能归咎为 G4 新代码引入。但新 G4 的 override 来源诊断同样依赖它，且已有安全回归实际失败，所以需要作为单独小修复处理。

缓存命中仅比较 `cached.mtimeMs === stat.mtimeMs`。独立复现：读取 GBK 策略后，将 defaultEncoding/newFileEncoding 改为 utf8，并保留 mtime；下一次 discovery 返回的仍是 gbk。即便两份 JSON 长度不同，旧缓存也照样命中。首轮 E29 还在没有人工保留时间的情况下失败，单次重跑通过不能代替修复。

设计要求：保留已有编译策略复用，通过实际配置内容确定缓存一致性；已有 `json` 可用于比较，不必另建策略系统。单次工具操作可复用同一个已验证策略，减少重复读取/编译。mtime/size/ctime 可以服务性能，但不能单独成为配置没有变化的证明。

验收至少包含：同 mtime 的不同内容；同 mtime 同大小但 override 改动；启用→禁用；新文件创建/已有文件读取/edit store 清空语义。不要给 E29 加 sleep 或放宽断言来隐藏失败。

### R5 / P2：ACP 的不可计数损失仍以 0 返回

文件：`crates/pi-shell/src/output_decode.rs`，当前约 187—193、300—312 行；N-API getter、TS 和 wire 字段。

源码已说明 OS ACP 路径没有统计 default-character substitutions，但结果仍用整数 0；本机 `new OutputDecoder()` 输入 `[0x81]` 后 EOF 输出 `?`，报告 cp936、replacements=0。Windows API 的默认字符替代与 UTF-8/encoding_rs 的 U+FFFD 不同，不能把这个 0 描述为已完整观测的解码损失计数。

不要求为了计数重写 Windows 映射。能复用严格校验取得可靠计数就报告；否则把该计量明确标成 unknown/不可用，避免输出“0 个损失”的暗示。不能扫描最终 '?' 或 U+FFFD 来统计，合法文本本来就可能含这些字符。

验收：ACP936 悬挂 lead、非法序列、非中文 ACP、合法 '?'、合法 U+FFFD、显式 utf8/gbk 的准确计数，及 mixed/unknown 的聚合。

## 3. 边界与文档修正

保留已实现的 UTF-8/GBK 字节有效性诊断和显式输出编码；不加入密度猜测，不改变明确文件策略优先级。

`read >4 MiB` 没有整文件歧义诊断、write/LSP/AST 没有 G4 附注、PTY 和 eval runner 捕获协议未接入，都是实际边界。用户代码先错误 decode 后产出的合法字符串不能可靠恢复，与 runner 仍能接触原始 bytes 的边界是两件事；不能一并说成“eval 全部按设计排除”。

下一轮要逐路径列“已覆盖/未覆盖/不适用”，将诊断对象明确为整文件或实际搜索窗口，不增加对大文件未搜索尾部的扫描。这些边界及 R1—R5 未复核完前，不称 G1—G6 全部验收。

17 号文档内带 1 failed 的行不能标为 PASS。这次 symlink 错误只能证明 fixture 无法建立，既不能证明防护正确，也不能证明失败来自产品。需要权限允许的独立 Windows/Unix 环境再跑安全用例，不能自动开启开发者模式、提升权限或跳过后记成通过。

## 4. 下一 AI 的完整执行 Prompt

```text
你是 ompg 实现工程师，设计者已完成独立复核，当前 G4/G5 验收不通过。工作目录 D:\Projects\GitProjects\oh-my-pi，分支 feat/gbk-text-io，基线 HEAD 0cbb33a59c。先读 AGENTS.md、14/15/16/17/18 号交接文档以及当前 git status/diff。工作树里是前一轮约 32 个文件的未提交实现，必须保留，不 reset/restore，不覆盖他人变更。以 18 号文档作为本轮返工依据。

按依赖顺序做：
1. R1+R3：修正输出摘要的已知/未知有效性，从读取失败/未完成到 ShellRunResult 贯通；修复 cfg(unix) 空 return 的返回类型错误。不要填默认 utf8/0 冒充已观测。保留取消、超时、输出 drain 的上游语义。
2. R5：让 ACP 无法统计的替代损失保持 unknown，显式 utf8/gbk 仍准确计数。复用原 OutputDecoder 与 codec，不重写 Windows charset 表，不扫描已解码字符猜损失。
3. R2：共享摘要聚合所有实际执行、用户可见的链段以及 stdout/stderr。命令链不是只取末段的管道。重复段累计计数，未知传播，混合来源保留且可见。保持旧 optional API 兼容；必要时添加来源字段，从 Rust/N-API 到 TS/RPC 一致贯通。wire/state.ts 是源，用 gen:rpc 生成 SDK；native 声明用 build:native 生成，不手工改产物。
4. R4：单独修复配置内容变化但 mtime 未变的缓存问题。复用现有缓存和 json；避免反复编译。补同 mtime/同大小 override 变更、disable 及 edit store 清空的确定性回归，不能 sleep/删断言。
5. 更新 02 协议和 17 验收文档，纠正 PASS+failed、命令链只见末段、ACP完整计数、eval runner边界等表述。列明大文件/read/write/LSP/AST/PTY/eval 各路径实际支持范围，不能通过删掉待办来达到完整验收。

先补能复现实际消费方错误的行为测试，再修复。R2 复现命令是 printf '\326\320\316\304\n'; printf 'done\n'，使用 executeShell 的 minimizer enabled=false/true 和 outputEncoding=utf8/auto 比较输出与结果字段。四个替换不能变成零；前段 cp936 不能消失。protected build 使用 UTF-8 stdout 与 GBK stderr，不允许结果把两条流冒充为一种来源。R4 保留配置 mtime 后切换 GBK→UTF-8，下一次 discovery 和 edit store 必须看到更新。

编辑源码只用 edit/apply_patch/write，不用 Python/sed/perl 经 shell 改源码。不要新建重复 I/O 或解析器，不开启系统开发者模式，不改用户工程、用户配置或用户安装，不停止用户进程。

Rust 修改稳定后重建 native，再跑相关 TS 回归；记录新 native SHA256。完整门禁使用 bun check 和 bun run test:rs，不能直接 cargo test。七个 GBK 文件、输出链/minimizer、ptree 双流/full stderr、bash、RPC 一致性和 read/grep 相邻路径要按变更验证。Unix cfg 分支须实际编译，环境不可用时记录未验证，不能拿 Windows check 代替。symlink EPERM 保留为环境阻塞；有权限的隔离环境验证后才报通过，不用跳过掩盖。

向设计者交付：每条 R1—R5 的根因/文件/行为/实际测试；各路径覆盖矩阵；PASS/FAIL/UNVERIFIED；native hash；原有失败是否仍存在。未获设计者复核前，不提交、推送、发布、评论或关闭 issue 3。不要修改 Codex memory；只在仓库验收文档记录事实。新发布须用新版本号，禁止覆盖 v18.8.7-gbk.1 ZIP。
```

## 5. 复现脚本（在仓库根用 Bun 运行）

以下脚本只运行命令并打印结果，不编辑源码或用户工程。

```typescript
import { executeShell, OutputDecoder } from "@oh-my-pi/pi-natives";
const command = "printf '\\326\\320\\316\\304\\n'; printf 'done\\n'";
for (const outputEncoding of ["utf8", undefined] as const) {
  for (const enabled of [false, true]) {
    let text = "";
    const result = await executeShell(
      { command, outputEncoding, minimizer: { enabled } },
      (_error, chunk) => { text += chunk; },
    );
    console.log({ outputEncoding, minimizerEnabled: enabled, text, ...result });
  }
}
const decoder = new OutputDecoder();
console.log({
  text: decoder.push(new Uint8Array([0x81])) + decoder.finish(),
  encoding: decoder.encoding,
  replacements: decoder.replacements,
});
```

本轮设计者只新增复核文档并在 17 号文档附审查提示，没有修改实现、提交、推送、发布或关闭 #3。后续执行者不得拿本复核文档当成问题已修复的证明。
