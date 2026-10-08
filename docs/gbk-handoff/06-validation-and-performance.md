# 06 — P12—P13：正确性、产品验证和性能

## P12｜分层验收（P0；依赖 P04—P11）

**目标：**证明真实工具路径正确，而不是 codec helper 单测全绿。

**范围：**Rust 编辑测试、native 集成测试、coding-agent 工具测试、Windows CLI/安装测试；新增 GBK 测试文件在实现时登记。

**步骤：**

1. fixture 用固定 byte arrays/hex 构造，独立保存期望字节，避免用待测 codec 同时生成输入和期望。
2. 建立无模型调用的确定性工具集成测试；真正调用 read/edit/write、native parser 和磁盘持久化。
3. 默认 UTF-8 与启用 GBK 各运行一次原有关键用例；测试策略隔离和运行次序。
4. 在 Windows 上验证文件占用、路径空格/中文、CRLF、ACL/权限、移动与恢复。
5. 验证编译产物中嵌入的是新 native，不是从官方 npm 下载的旧 addon；在干净缓存下重跑。
6. 模型驱动验收单独记录 provider、模型和实际操作；没有真实连接时只能标记未验证，不能用 fixture 假装模型执行。

**验收：**下表适用用例均有命令/日志/字节证据；任何数据损坏、错误成功或原版污染均阻止发布。

**失败处理：**区分基线失败、环境失败和新回归；不通过删除测试、放宽断言或使用 `mock.module()` 绕过，遵守根 AGENTS 的测试规则。

## 1. 必须覆盖的测试矩阵

| ID | 输入 / 动作 | 期望结果 |
| --- | --- | --- |
| E01 | GBK 中文注释、中文字符串 read | 显示正确，无替换字符 |
| E02 | read→Hashline 编辑→再 read | 目标 bytes 为 GBK，后续锚点正确 |
| E03 | CRLF 文件局部编辑 | 未编辑行及换行保持 |
| E04 | 无末尾换行 | 不自动追加换行 |
| E05 | 无修改编辑 | 原 bytes 不变，避免无意义重写 |
| E06 | ASCII 文件按 GBK 规则加入中文 | 写出 GBK，不因原文件全 ASCII 误判 |
| E07 | UTF-8 无 BOM / 有 BOM | 编码和 BOM 状态保持 |
| E08 | 混合编码目录 | 路径 override 正确，文件间不串策略 |
| E09 | GBK 输出含 emoji 等不可表示字符 | 写前拒绝，原 bytes 不变 |
| E10 | 非法/截断 GBK 输入 | 明确错误位置，不生成可写乱码快照 |
| E11 | GBK 规则与 UTF-8 BOM 冲突 | 提示配置冲突，不静默转换 |
| E12 | 分块边界在多字节中间 | read/grep 无乱码或漏字 |
| E13 | read 后外部修改 | stale edit 被拒绝，外部修改不被覆盖 |
| E14 | 同 session 连续编辑两次 | 第二次使用真实最新快照 |
| E15 | 新建、覆盖、移动和目标冲突 | 编码及原有创建/排他语义正确 |
| E16 | 移动目标写失败 | 源文件仍存在且 bytes 不变 |
| E17 | 多文件预检遇不可编码文本 | 整批写前拒绝 |
| E18 | 第二个文件落盘失败 | 按声明合同恢复；恢复失败清楚报告 |
| E19 | 中文附近 AST 替换 | parser 偏移无错位，预览与保存一致 |
| E20 | 中文关键词/正则 grep | 行号、上下文、快照匹配 |
| E21 | LSP rename/code action | 协商列编码正确，保存仍 GBK |
| E22 | ACP/外部 formatter 未适配 | 对受保护文件写前拒绝；UTF-8 不受影响 |
| E23 | 二进制、session JSON、压缩包 | 不误套 GBK 规则 |
| E24 | 大于快照上限的文件 | 有界读取/明确限制，不伪造完整快照 |
| E25 | 取消和进程中断 | 文件完整，返回状态与实际落盘一致 |
| E26 | 中文/空格路径、junction/symlink | 目标与权限边界正确 |
| E27 | 原版与 Fork 同时启动 | 命令与 addon/cache 不串用 |
| E28 | 子 Agent / worker 重入 | 使用本 Fork 和同策略 |
| E29 | 编码策略修改 | 缓存失效，旧快照不混用 |
| E30 | 干净安装、更新失败、回滚 | 原版及旧 Fork 可继续运行 |

混合换行如果初版明确拒绝写入，测试应验证拒绝和文件未变，并写进限制；不能把它记成“保持混合换行通过”。

## 2. 构建测试命令的真实含义

根目录推荐的现有入口：`bun check`、`bun run test:rs`、`bun run ci:test:ts`；局部调试按包和测试文件运行。不要直接使用 `tsc`/`npx tsc` 或直接 `cargo test` 代替仓库入口。

`scripts/run-rs-task.ts` 在非 CI 且工作树没有 Rust 变更时会跳过检查，即使 HEAD 已包含 Rust 改动。因此干净发布 checkout 必须明确强制执行，例如：

```powershell
$savedCi = $env:CI
try {
    $env:CI = '1'
    bun run test:rs
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
} finally {
    if ($null -eq $savedCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue }
    else { $env:CI = $savedCi }
}
```

同样确认 `bun check` 中 Rust 检查没有跳过。保存实际执行测试数及 skipped 原因；退出码 0 不能单独证明测试运行。

新增专项 gate 拟命名 `check:gbk`，实现后才可执行；要求它运行行为测试和输出证据，不做源码字符串断言。

## P13｜性能基线与回归预算（P1；依赖 P12）

**目标：**证明没有因为 GBK 支持给默认 UTF-8 和大型工程带来不合理开销。

**范围：**`packages/coding-agent/bench/`、`packages/natives/bench/grep.ts`、拟新增编码/工具 benchmark。

**步骤：**

1. 保留原版基线构建与 Fork 构建，记录 SHA、Bun/Rust 版本、CPU、内存、存储、配置和扫描范围。
2. 在同机器、同温度/负载条件下交替测量，区分首次启动/冷缓存与暖缓存，不只测 codec 微基准。
3. 覆盖小文件、1 MiB、4 MiB、超过快照上限的文件及多文件目录；固定 fixture seed/hash。
4. 测 read、中文 grep、Hashline 单点修改、批量 patch、AST、启动；分别报告 UTF-8 默认、GBK 启用和无命中策略成本。
5. 建议先 5 次预热，再至少 30 次测量，保存原始样本、p50/p95、峰值内存与文件读取次数；噪声大时扩大样本。
6. 优化顺序：重复读盘→多次解码/复制→缓存失效→跨 N-API 往返→算法；不先重写上游引擎。

**验收：**对可重复且不由计时噪声主导的 UTF-8 workload，超过约 5% 的回归必须解释、修复或明确接受理由；这只是审查触发线，不是宣称已达到的结果。

**失败处理：**不能拿平均值掩盖 p95 卡顿，不能通过关闭字节校验/stale guard 提速；GBK 转换增加的真实成本如实公布。

## 3. E630 用户流程验收

在用户授权的工程测试副本中：配置编码规则→读取中文→修改中文注释与字符串→搜索/重命名→查看实际 bytes 与 Git diff→原 Windows 编译工具链构建→检查中文运行时/资源输出。

记录真实工程 revision、编译器版本、代码页参数和构建命令。仅“编译通过”不能证明窄字符串/资源编码正确。未获得工程或工具链时标为未验证，不编造项目路径或成功截图。
