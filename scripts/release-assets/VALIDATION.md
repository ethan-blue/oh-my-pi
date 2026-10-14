# ompg v18.10.2-gbk.2 验收记录

Windows x64 AVX2，未签名预发布；Bun 1.4.2，Rust nightly-2026-10-06 / MSVC。
上游基线 OMP v18.10.2；本轮不合并新的上游 main，旧 gbk.1 标签与资产保留。源码与实际 addon/EXE 身份见 build-info.json、包内 SHA256SUMS.txt。

## Core 本轮门禁

| 检查 | 实测 | 范围 |
| --- | --- | --- |
| native 优化构建 | 退出 0，146 exports | Windows；既有 LNK4217 warning 保留 |
| Rust 全仓 | 3209 passed / 4 skipped，退出 0 | 34 binaries；doctest 1 passed |
| bun check | 退出 0 | lint/fmt/workspace typecheck/cargo fmt/clippy -D warnings |
| Google/factory 最终全量 | 407 passed / 0 failed，1245 assertions | 31 文件；包括别名签名、中断历史与并行调用合同 |
| KDL/兼容性定向 | 83 passed / 0 failed，211 assertions | 编译、级联、分类与 bundled model parity；与全量有覆盖重叠 |
| task/config 相邻 | 559 passed / 2 skipped / 1 failed，2272 assertions | 52 文件；单个 symlink EPERM 为 ENVIRONMENT BLOCKED，整套非 PASS |
| task runtime 定向最终 | 51 passed / 0 failed，164 assertions | structured 与 workpool，显式参数/按 agent/全局优先级 |
| stats/TUI 相邻 | 211 passed / 0 failed，984 assertions | 34 文件，含静默 worker 后续真实入库、write-phase 与 LoopWatchdog |
| GBK 九文件 + ptree-stderr | 173 passed / 0 failed，591 assertions | 10 文件；上一版编码/搜索/来源合同未退化 |
| Windows NAPI writer | PASS，实际 220000 bytes 原样输出 | constructor、Unicode FIFO、drain、stop；不等于 ConPTY GUI 性能证明 |
| bridge 离线真实 socket | 6 passed / 0 failed，11 assertions | 独立仓库 3a74e1885ed2005b8d8dbb3ba7c7083b52e58c83 |
| git diff --check | 退出 0 | 保留既有环境阻塞测试 |

native SHA256：a52a914ac9b8e12a7457d2c863a79027d266ca710e359ba04c886f880f252484。
各套件有重叠，不能将表内 passed 相加作为独立总数。

## 发布验收

发布流程使用官方 binary build、--version、--smoke-test、encoding doctor JSON、fork update 阻断和隔离安装器升级/回退。ZIP 包内/外哈希及 GitHub 下载后复核单独记录在 docs/gbk-handoff 的本版最终发布文档；本表的源代码结果不冒充远程发布证明。

## 未验证与不通过

- 原机日志不可访问；真实 Gemini 400、41.425 秒 stall、stats 停更、herdr GUI/多实例现象未原机复现。用户允许无法访问的项不改；关闭跟踪 issue 不表示所有症状根治。
- Windows worktree symlink EPERM 为环境阻塞；未换 hardlink、删除断言或修改权限制造通过。
- Unix、真实 E630/Keil/模型、ConPTY GUI 与完整性能 A/B 未验证。
- bridge 更新独立于 Core ZIP，不自动迁移或删除用户扩展。
- GBK 自动推断只读；外部程序、扩展和可信 build hook 不受 Core 全局文件编码拦截保证。

详细文件、因果与边界：docs/gbk-handoff/36-issue5-implementation-and-verification.md。
