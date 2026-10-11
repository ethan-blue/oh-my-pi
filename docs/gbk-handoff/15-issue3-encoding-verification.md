# Issue 3 编码修复与验收记录

日期：2026-10-10。设计依据：[14-issue-remediation-design.md](14-issue-remediation-design.md)。报告对应本轮源码改进；不是 `18.8.7-gbk.1` 已发布程序的能力声明。Issue 3 必须保持开放，因为 G4/G5 未完成。最终统一验收见 [16-issue-final-review.md](16-issue-final-review.md)。

2026-10-11 最终门禁更新：修复 clippy 的首段文档长度和大栈数组要求，64 KiB 解码输出缓冲改为堆上固定分配、循环复用。TS 声明校验的唯一 helper 对非 `.py`/`.pyw` 路径快速返回，避免大型 C 文件为无关校验复制全文到 N-API。下列 native、Rust 和五个 GBK 文件结果已用该最终源码重新验证。

## 1. 本轮行为和范围

| 项目 | 本轮状态 | 可观察行为及剩余范围 |
| --- | --- | --- |
| G1 新建与 Python 声明 | PASS | 新建/已有均必须命中 include；override 不扩大 include。受管范围内 newFileEncoding 必须等于 defaultEncoding，不一致的配置在首次使用时拒绝。Python `.py`/`.pyw` 首两行合法 coding 声明仅约束目标编码，不反过来选择编码；无声明按 Python 3 UTF-8 默认校验。冲突在写/编辑/patch/LSP/AST 落盘前拒绝，BOM 与 cookie 冲突同样拒绝。未受管的新 Python 中文文件按 UTF-8 创建后仍可读、搜、编辑。 |
| G2 项目外文件 | PASS（本地文本入口） | 项目外/无策略文件按严格 UTF-8；非法字节不会作为替换文本进入 read/raw/grep 结果。read 提示使用文件所属项目的显式策略。本轮不修复旧会话及 compaction 中已经存在的乱码。 |
| G3 搜索一致性 | PASS（受检搜索范围） | native grep 的 content/files/count/context、单文件与递归入口严格验证被读取的搜索窗口；无法解码是失败，而非成功的零命中。合法文件中本来存在的 U+FFFD 仍保留。 |
| G4 反向指定 GBK | PARTIAL | 非法 GBK 及 UTF-8 BOM 与 GBK 策略冲突拒绝。无 BOM 字节同时合法于 UTF-8/GBK 的情况仍按明确策略执行；没有用户可见的歧义诊断功能，不能称 G4 已修复。 |
| G5 子进程输出 | UNIMPLEMENTED | 本轮没有新增输出编码来源元数据/显式输出编码协议；不能称自动探测已实现。 |
| G6 缺失策略/raw | PASS（诊断及不替换） | 缺策略的读失败明确说明缺失项目策略，给出显式 include/override 方向；`:raw` 仍严格文本解码，不能绕过编码错误。没有自动生成配置、全局 fallback 或 GB18030 猜测。 |

以上 PASS 只对应表中描述的设计验收，不表示实现了 issue 中提出的所有建议。没有真实模型/E630/Keil 端到端验收，第三方工具和用户脚本也不属于统一文件 I/O 的全局拦截范围。

## 2. 实现入口

- `crates/pi-edit/src/encoding.rs`：共享策略 resolve、配置一致性、Python 声明解析、严格有界前缀解码。复用 regex、encoding_rs 和现有 codec；不复制 Python parser 到各工具。
- `crates/pi-edit/src/files.rs`：已有文件 persist 与新文件 persist_new 在持久化前调用同一声明校验。该层覆盖原生 edit/patch 提交。
- `crates/pi-natives/src/encoding.rs`：导出 encodingValidateSource；搜索严格解码并添加路径/编码/偏移及显式策略方向。
- `crates/pi-natives/src/grep.rs`：所有文件匹配分支在匹配前严格验证；大文件保持原 4 MiB 搜索窗口。
- `crates/pi-natives/src/ast.rs`：所有 pending_writes 的源声明在第一笔写入前预检。
- `packages/coding-agent/src/encoding/index.ts`、`tools/write.ts`、`tools/file-write-fallback.ts`、`edit/index.ts`、`lsp/edits.ts`：TS 文件入口复用原生声明校验，write 在 ACP 路由前检查，LSP 在多文件及有序 create/rename/text 状态预检时检查。
- `packages/coding-agent/src/tools/read.ts`：缓存读取、逐行流式读取、超长首行预览、unbounded text 和 raw 均严格解码；预览不制造半个字符的替换符。
- `packages/natives/native/index.d.ts`、`index.js`：由本轮 build:native 生成，包含新增原生导出；没有手工改生成绑定。

## 3. 大文件和搜索失败的准确语义

普通文件严格验证完整已读内容。超出 4 MiB 的 native grep 文件仍只匹配前缀，最多额外读 1 字节用于判定截断/EOF；非 final decoder 验证窗口，最后悬挂的半个字符被丢弃。没有全文件尾扫。未搜索尾部的坏字节不会把前缀搜索变成失败，也不能因此称整个文件合法。

回归同时覆盖 UTF-8/GBK 在 4 MiB 截断处跨字符、窗口内坏字节明确失败、窗口外坏字节保持部分搜索语义。对一个搜索调用，先前合法文件的流式更新可能已经发送，后续发现非法文件时仍以失败结束；不能把已经输出的部分内容当作完整搜索成功。

## 4. 实际验证

以下验证使用本轮全部 Rust 运行时代码稳定后重新编译的 native，不使用旧发布程序作为证据。

| 命令/门禁 | 实际结果 |
| --- | --- |
| `bun run build:native` | PASS；Windows x64 modern/AVX2，本地主机 local optimized profile，3m46s；生成 140 个显式 ESM exports。上游 CRT/wasmtime 链接警告仍出现，构建退出 0。 |
| `bun run test:rs` | PASS；nextest 3016 passed、4 skipped；可运行 doctest 1 passed，另外 18 项 upstream ignore 保持原样。Windows 测试 PATH 包含 Git 的 POSIX 工具。 |
| 五个 GBK 文件 `bun test` | PASS；55 passed、0 failed、200 assertions；包含项目外/无策略 grep、>4 MiB 流式读、Hashline、原生 AST、LSP 批次、protected mode 回归。 |
| 全仓 `bun check` | 设计者统一运行 exit 0；最后 TS 非 Python 快退及测试调整的补充工具检查由设计者记录。 |
| 新独立二进制及 GitHub Release | 本轮实现者未构建或发布，不声称旧版 ZIP 已包含修复。 |
| E630/Keil/真实模型 | UNVERIFIED；未改用户工程或用户安装。 |

本机日志：`%TEMP%\ompg-issue3-native-final.log`、`%TEMP%\ompg-issue3-rust-final.log`、`%TEMP%\ompg-issue3-ts-final.log`。临时日志会被覆盖或清理；公开验收应将实际结果复制到设计者的最终记录。

最终 native SHA256：`4725C75842DC9DCF2F5CCCB5CD2E46B189BA689AE116B0ED236263CCED2EB00C`，对应 `packages/natives/native/pi_natives.win32-x64-modern.node`。独立程序若后续发布，应包含重新打包的同一 native，而非旧版嵌入资产。

额外 `read-single-pass.test.ts` 回归：5 passed、0 failed、13 assertions。旧非法 UTF-8 替换输出测试改为拒绝且源字节不变；字节计量合同用合法中文长行单独验证（20 KiB 字符对应 60 KiB 磁盘字节，必须显示 50 KiB 超限 notice，不能按字符串长度漏判）。格式已用 oxfmt 处理；设计者已使用最终 native 跑完包含该文件的九文件回归组：149 passed、8 平台跳过、0 failed、539 assertions。

TS 命令：

```powershell
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts
```

首次 TS 运行出现的两个失败已经明确修正并重跑：旧 R03 测试期望不一致策略能成功移动，现改验写前拒绝及原字节；旧 A02 GBK Python fixture 没有 Python 3 coding 声明，现补正确 GBK 声明并验精确源字节。没有删除或跳过失败测试。

## 5. 下一 AI 接手 G4/G5

G4 不能用中文密度或 replacement 字符频率自动猜测后改写。候选方案应先定义“明确策略但另一 charset 也合法”的诊断协议，覆盖 raw/read/grep/edit 的返回结构及用户如何采用显式 override；是否阻止写入由设计者批准，不能改变当前明确策略优先级而不说明兼容性。

G5 先统一输出来源与编码协议：普通 bash 经 Rust shell 使用 `crates/pi-shell/src/output_decode.rs`（增量 UTF-8/Windows ACP fallback）；受保护 build 走 `packages/utils/src/ptree.ts` 的 UTF-8 TextDecoder，不能说它共享了 Rust ACP fallback。eval 内用户代码已经错解后返回的合法字符串无法可靠还原；需要在仍有原始 bytes 的捕获边界提供显式编码/来源元数据，而不是对最终字符串再次猜测。覆盖 stdout/stderr、分块、多字节、截断和非中文系统 ACP 后才验收。

Issue 3 的关闭条件仍是 G1—G6 完整验收。设计者应保留 G4/G5 待办，复核 diff、跑完整门禁后再决定提交、后续发布及 issue 操作；实现者没有提交、推送、评论或关闭任何 issue。
