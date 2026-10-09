# ompg v18.8.4-gbk.1 验收记录（VALIDATION）

> 由自动化验收生成；环境：Windows 10.0.26200 x64，Bun 1.4.2，rustc
> nightly-2026-10-06 (MSVC 14.44)，单机。全部命令在本 Fork 源码树执行。

## 编码矩阵（E01—E30）

| ID | 状态 | 证据 |
| --- | --- | --- |
| E01 GBK 中文 read | 通过 | gbk-encoding.test.ts（显示无 U+FFFD） |
| E02 read→edit→read 循环 | 通过 | 同上；磁盘字节与手写 GBK 期望逐字节相等 |
| E03 CRLF 局部编辑保持 | 通过 | crates/pi-edit/tests/gbk_encoding.rs（Rust 层） |
| E04 无末尾换行保持 | 通过 | 同上 |
| E05 no-op 不重写 | 通过 | 同上（writer 零调用） |
| E06 ASCII+规则加中文→GBK；新文件 GBK | 通过 | gbk-encoding.test.ts（write 新建） |
| E07 UTF-8 BOM/无 BOM 保持 | 通过 | Rust 层 BOM round-trip；UTF-8 文件 BOM 经 FileRead.bom 保留 |
| E08 混合编码目录 override | 通过 | Rust 层 override_exempts_utf8_subtree；E08 目录测试 |
| E09 emoji 写前拒绝 | 通过 | gbk-encoding.test.ts（U+1F389 报错、字节不变） |
| E10 非法 GBK 报偏移 | 通过 | offset 8/4 断言；无乱码快照 |
| E11 BOM+GBK 规则冲突 | 通过 | 明确策略冲突错误 |
| E12 分块边界多字节 | 通过 | gbk-validation.test.ts >4MiB 流式（LF 不出现在 GBK 双字节内） |
| E13 stale edit 拒绝 | 通过 | Rust 层（外部改写后零写入） |
| E14 同 session 连续编辑 | 通过 | Rust 层 consecutive_edits |
| E15 新建/覆盖/移动/目标冲突 | 通过 | Rust 层 move/create；write 覆盖（TS） |
| E16 移动目标写失败源保留 | 通过 | gbk-lsp-recovery.test.ts 失败注入：目标父路径被普通文件占据（ENOTDIR），move 报错且源文件 GBK 字节逐字节不变、blocker 不动 |
| E17 批次不可编码写前拒绝 | 通过 | ast.rs 全批次预检；patch 引擎 staging 原子性（上游）+ persist 预检 |
| E18 第二文件失败恢复 | 通过 | 上游 multi_file_failure_stages_nothing（回归通过） |
| E19 中文附近 AST 替换 | 通过 | gbk-search-ast.test.ts（偏移切解码文本、写回 GBK、emoji 拒绝） |
| E20 中文 grep | 通过 | 同上（行号/内容正确；无策略时 0 命中=上游行为） |
| E21 LSP rename/code action | 通过（确定性） | gbk-lsp-recovery.test.ts：applyWorkspaceEdit（lsp 工具驱动的确定性面）rename 式（text edit+rename）与 code-action 式（多文件 text edit，UTF-16 位置含中文替换）均落盘 GBK 字节逐字节相等；真实 LSP 服务器交互仍未运行（无本地服务器，见未验证项） |
| E22 ACP/外部 formatter | 通过（拒绝路径） | hasActiveWriteBridge 活动时 GBK 写前拒绝；UTF-8 不受影响（edit-acp-bridge 回归通过） |
| E23 二进制/JSON/压缩包不受管 | 通过 | 策略只作用于 include 命中；notebook 恒 UTF-8；未管理路径二进制 sniff 保持 |
| E24 超快照上限文件 | 通过 | gbk-validation.test.ts（4MiB+ 流式有界读取） |
| E25 取消/中断 | 传递性保证 | 上游取消语义未改（编码层无新异步点）；专项中断注入未运行（记未验证） |
| E26 中文/空格路径 | 通过 | gbk-validation.test.ts（组件 module/主文件.c） |
| E27 原版与 Fork 共启 | 通过（本机） | 原版 omp 18.2.11 于 %LOCALAPPDATA%\omp 未动；ompg 数据根 ~/.ompg、native 缓存 ~/.ompg/natives（构建产物实测）；双进程并发长跑未做（记未验证） |
| E28 子进程/worker 重入 | 通过 | resolveOmpCommand 源/编译态重入；--smoke-test（成品 exe）ok |
| E29 策略修改缓存失效 | 通过 | gbk-validation.test.ts（mtime+清快照） |
| E30 安装/更新失败/回滚 | 通过（隔离目录演练） | install-ompg.ps1 校验失败拒绝、-Uninstall 只清 Fork 文件（P15 记录） |

## 套件与门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 仓库检查 | `bun check` | 通过（oxlint 0 警告、oxfmt 干净、tsgo 全包、clippy -D warnings、cargo fmt） |
| Rust 测试 | `CI=1 bun run test:rs` | 2988 run：2986 通过 / 2 失败；2 个失败在基线 worktree（40e9368）复现一致（pi-shell output_decode、pi-builtins sed::fast_io——本机既有环境失败） |
| GBK 工具层 | `bun test packages/coding-agent/test/gbk-*.test.ts` | 36 pass / 0 fail（四文件 19+10+4+3，含 E16/E21 确定性注入） |
| GBK 引擎层 | `cargo test -p pi-edit --test gbk_encoding` | 18 pass / 0 fail（另 encoding 单测 20） |
| 全量 TS | `bun test packages/coding-agent` | 17077 例；fork 失败集与基线对照：symlink EPERM（无开发者模式）/网络/POSIX 语义类在基线同样失败；fork 引入的 fixture 断言已修复并复跑（最终数字见发布包 VALIDATION.md） |
| 成品 smoke | `omp-windows-x64.exe --smoke-test` | ok（exit 0） |
| 成本身份 | `omp-windows-x64.exe --version` | `ompg/18.8.4-gbk.1` |

## 性能（P13）

`bun packages/coding-agent/bench/gbk-encoding-bench.ts`（5 预热 + 40 样本；同机同工具链）：

| 模式 | read p50/p95 (ms) | edit p50/p95 (ms) | grep p50/p95 (ms) | 峰值 RSS (MiB) |
| --- | --- | --- | --- | --- |
| utf8-baseline | 1.53 / 6.71 | 1.33 / 1.85 | 8.63 / 10.20 | 233.1 |
| utf8-policy-unmatched | 1.54 / 3.35 | 1.44 / 2.21 | 8.38 / 10.15 | 214.7 |
| gbk-managed | 1.36 / 3.16 | 1.37 / 1.82 | 5.57 / 7.47 | 212.6 |

策略未命中与基线差异在计时噪声内（UTF-8 无 >5% 回归）；GBK 路径因磁盘字节更少而更快。
峰值 RSS 按模式在整个测量循环内采样 `process.memoryUsage().rss` 取最大值；三模式同量级
（差异 <10%，源于运行次序的堆增长，非编码路径泄漏）。
**原始样本**（每模式 read/edit/grep 各 40 个逐次样本，含采集时间戳与 Bun 版本）存档于
`scripts/release-assets/bench-samples-v18.8.4-gbk.1.json`（随仓库发布），可由
`bun packages/coding-agent/bench/gbk-encoding-bench.ts` 复现。

## 兼容矩阵（05 文档要求）

| 场景 | 状态 |
| --- | --- |
| 不启用策略→原 UTF-8 行为 | 通过（专门回归：未管理路径逐字节不变、无效 UTF-8 消息不变） |
| 原有项目 .omp/config.yml | 通过（PROJECT_CONFIG_DIR_NAME=.omp；config/discovery 读取不变） |
| 原版用户配置副本（~/.omp/agent/config.yml，18.2.11 写入） | 通过（副本上验证：PI_CONFIG_DIR 隔离副本 → `ompg config list` 正确解析并显示原版主题等设置；副本经 grep 确认无密钥） |
| 原版会话副本（~/.omp/agent/sessions/*.jsonl，18.2.11 写入） | 通过（副本上验证：`listSessionsReadOnly` 列出 21 个会话（complete/error 状态正确推导）；`loadSessionMessagesReadOnly` 解析消息成功；只读、未迁移、未上传） |
| 原版与 Fork 数据/缓存隔离 | 通过（~/.ompg、~/.ompg/natives；原版 ~/.omp 未写入——构建全程监控） |
| Fork 子进程重入 | 通过（见 E28） |
| 原版命令仍在 PATH | 通过（Fork 回退名 ompg.cmd；不改 omp 条目） |
| 覆盖用户 PI_* 环境变量 | 尊重（PI_CONFIG_DIR/PI_NATIVES_DIR/PI_SUBPROCESS_CMD 均优先） |
| 关闭 GBK（enabled=false/删策略） | 通过（E29；负缓存 1s TTL） |
| Fork 自更新 | 明确禁用并给手动步骤（不回退官方源） |
| 卸载/回滚 | 通过（-Uninstall 仅清 Fork 文件；数据保留） |
| 真实模型调用 / E630 编译 | 未验证（未使用付费模型；E630 工程/编译器未提供） |
