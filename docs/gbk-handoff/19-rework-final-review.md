# R1—R5 第二轮设计者验收及剩余任务

日期：2026-10-11。仓库：`D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，HEAD `0cbb33a59cfe256f931735042b7101cb4f901ca9`。运行时改进仍为未提交工作树；设计者本轮修改仅为文档。

**结论：已测试的 Windows 范围通过；issue 3 尚未完全验收，保持 OPEN。** 前一轮复核 [18](18-g4-g5-designer-review.md) 是历史记录，第二轮实现报告 [17](17-g4-g5-protocol-verification.md) 与本文件共同构成当前证据。不能把源码修复、Windows 门禁、Unix 实机或发布证明混为一项。

## 1. R1—R5 逐项判定

| 项目 | 独立判定 | 证据与边界 |
| --- | --- | --- |
| R1 Unix 空返回 | 源码修正通过；Unix 门禁 UNVERIFIED | 返回类型为 Option，注册失败 return None，原单位类型错误已消除。本机 WSL 查询退出 1，提示未安装 WSL；实现者交叉编译报告受 pcre2-sys 的 Linux C 工具链阻塞。没有 Unix 实机编译证明，不能报全平台通过。 |
| R2 链/双流来源 | PASS（所测路径） | utf8 模式的 4 次替换在 minimizer 开/关时均保留；auto 分段链保留 cp936+utf8，统一字段 absent；protected build 的 UTF-8 stdout/GBK stderr 均输出中文且保留两种模式。跳段/多异常段/溢出/管道回归均在九文件套件通过。 |
| R3 未观测摘要 | 源码与单元及模拟消费者通过；真实未完成分支 UNVERIFIED | reader_output=None 转为 unknown；聚合阻止 uniform/total 冒充完整来源。设计者模拟 native 结果（observed cp936 + unknown=1）经过真实 BashTool，结果带 provenance incomplete，无统一编码宣称。该实验不等于真实原生读取线程被 abort 的端到端验证，也没有成为持久回归。 |
| R4 配置缓存 | PASS | discovery 同时核对 JSON，edit store 同步也核对 JSON；同 mtime、同大小 override 重排、启停清空等确定性测试通过。编译对象缓存保留，读取小配置内容不等于每次重新编译 matcher。 |
| R5 ACP 计量 | PASS（本机 CP936 与既有 Windows 单元范围） | 0x81 EOF 输出 ? 且 replacements=1；合法映射不按最终字符计数。另使用 Windows MultiByteToWideChar(flags=0) 独立核对五组含异常邻居的 CP936 输入，native 输出 UTF-16 单元与 OS 映射一致。非 Windows 与所有可能系统代码页没有全量实机证明。 |

计量语义已澄清：UTF-8/GBK 计解码器产生的非法序列替换；ACP 计严格校验拒绝的结构序列，仍保留 OS 兼容输出。这不是信息可逆性的证明。auto 保留已经输出的 UTF-8 前缀，首个非法序列后仅后续字节切换 ACP；最终模式摘要也不是可靠原编码探测。

## 2. 设计者实际重建与门禁

| 门禁 | 结果 |
| --- | --- |
| bun run build:native | PASS，退出 0；Windows x64 modern/local optimized，142 exports。缓存构建约 7 秒，上游 wasmtime 链接警告仍有；没有改写成零警告。 |
| 最终 native SHA256 | c2de2336321ca6d1cac06f4a46ab92b7b7f2c53e855f0a6c4a2691540fd791ca，与实现者报告相同。 |
| 重建后九文件回归 | 95 passed、0 failed、349 assertions，退出 0。此前相同九文件独立首跑也为 95/0。 |
| 全仓 bun check | PASS，退出 0；格式/lint/TypeScript 与本机 Rust fmt/clippy。 |
| bun run test:rs | 3037 passed、4 skipped；runnable doctest 1 passed、18 ignored，退出 0。 |
| git diff --check | PASS。 |
| 相邻套件 110/2/1 | 实现者报告，本轮未整组重复；symlink 的 EPERM 已在上一轮独立复现，属于 fixture 环境阻塞，不能作为该安全路径通过的证明。 |
| Unix 实机、真实模型、E630/Keil、新独立二进制 | UNVERIFIED，未执行。 |

本机日志：%TEMP%\ompg-designer-rework-native.log、ompg-designer-rework-check.log、ompg-designer-rework-rust.log、ompg-designer-rework-final-native-tests.log。临时文件不承诺长期保存，本文件保存关键结论。

九文件命令：

```powershell
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts packages/coding-agent/test/gbk-encoding-ambiguity.test.ts packages/coding-agent/test/gbk-output-encoding.test.ts packages/coding-agent/test/gbk-output-chain.test.ts packages/utils/test/ptree-stderr.test.ts
```

## 3. 后续任务顺序

1. 将现有源码提供给可用的 Unix 构建环境，跑真实编译及相关测试。复用仓库流程；不要仅手动定义 cfg(unix)、删除 pcre2 依赖或用 Windows 编译替代。当前本机没有可用环境时保留阻塞事实，不自动安装 WSL 或改系统权限。
2. 补 R3 持久消费方回归：未知+已知进入 ShellRunResult/N-API/真实 BashTool 后，统一字段和计数必须 absent，已观测列表与 unknown 数保留。捕获线程未完成分支采用可控同步/取消边界验证；不依赖反复触碰 250ms 的竞争窗口，不为测试增加面向用户的新功能。将本次模拟实验与真实原生捕获证明分开。
3. 在权限允许的隔离环境运行原 symlink containment 用例，确认产品拒绝访问，而不是 fixture 已失败。不能换成 hardlink 后称原符号链接场景通过；不能修改用户系统权限或跳过后报通过。
4. 根据 17 的覆盖矩阵补剩余协议路径。PTY 与 eval runner 的原始 bytes 捕获边界尚未接入；read >4 MiB 没有 G4 整文件歧义标注；write/LSP/AST 写入没有 G4 附注。每项明确对象是整文件还是实际窗口，复用已有 codec/decoder，不扫描未搜索的大文件尾部，不添加频率猜测，不改变明确编码策略。用户代码内部错误 decode 的合法字符串仍是不可逆边界。
5. 测试报告在非 CP936 主机应明确区分环境不适用/跳过，当前 test 内的提前 return 不能让未来主机误报实际覆盖。负缓存 TTL 测试应在第一次 discovery 前固定模拟时钟，再推进，避免 await 期间真实时间超过 TTL 时产生时序失败；不得 sleep/放宽断言。

第 4 项不要求每个工具复制完整诊断逻辑；优先在共享文本读取/文件版本/输出捕获边界复用。仅交付已有支持范围也可以作为有限版本能力说明，但不能将剩余项删去后关闭 G1—G6 集合问题。

## 4. 下一 AI 的完整 Prompt

```text
你是 ompg 后续实现及验证工程师。工作目录 D:\Projects\GitProjects\oh-my-pi，分支 feat/gbk-text-io，HEAD 0cbb33a59c。先读 AGENTS.md、git status/diff 和 docs/gbk-handoff 的 17/18/19 号文档；18 为第一轮历史返工依据，19 才是第二轮独立验收现状。

保留当前所有未提交实现。R1—R5 的 Windows 范围已经由设计者重新构建 native、95 项回归、bun check、test:rs 3037/4 验证；不要重做已通过的修复或 reset/restore。

按 19 第 3 节顺序补证据及剩余覆盖：真实 Unix 编译；R3 持久消费方和可控未完成读取分支回归；权限允许环境的 symlink 防护验证；17 覆盖矩阵中的 PTY/eval runner/大文件诊断及写入诊断边界。补跨主机测试的实际 skip/unverified 口径，负缓存 TTL 用第一次 discovery 前冻结的模拟时钟，不加 sleep。

源码改动只用 edit/apply_patch/write，不用 Python/sed/perl 经 shell 改源码。不重复实现编码检测器/输出解码器，不做内容密度猜测，不扫描未搜索的大文件尾部，不改用户 E630/安装/配置/系统权限，不安装 WSL 或停止用户进程。原始输出来源元数据表示解码器实际采用的模式，不能包装成可靠编码探测；用户代码先错误 decode 后的字符串不能还原。

Rust 源码稳定后先 build:native，再跑依赖 native 的回归，记录 hash；完整门禁用 bun check 和 bun run test:rs，不能直接 cargo test。RPC wire/state.ts 是源，SDK 用 gen:rpc 生成，native 绑定用 build:native 生成。没有可用 Unix/symlink 环境则如实保留 UNVERIFIED/ENVIRONMENT BLOCKED，不删依赖或测试制造通过。

提交设计者的是逐项状态、来源/窗口覆盖矩阵、实际日志数字及新 native hash。不私自提交、推送、发布、评论或关闭 #3，不修改 Codex memory。新的二进制须新版本号与独立下载验包，不覆盖 v18.8.7-gbk.1。设计者复核完成后才决定提交/发布/issue 操作。
```

## 5. GitHub 和发布状态

设计者本轮读取确认 #3 仍为 OPEN；没有执行提交、推送、发布、评论或关闭。公开二进制仍不能据本地 native 验收宣称包含当前源码。#1/#2 维持前轮关闭状态。
