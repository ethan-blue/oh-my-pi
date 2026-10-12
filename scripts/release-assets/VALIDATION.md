# ompg v18.10.2-gbk.1 验收记录

Windows x64 AVX2，未签名预发布；Bun 1.4.2，Rust nightly-2026-10-06 / MSVC。

## 来源

- 合并官方正式 Release v18.10.2，标签提交 c8913466dd7bf92040de911f8e00e30b8f4e48a2。准备时最新正式版由 v18.10.1 更新至 v18.10.2，已补合并。
- Issue #4 修复提交 4f790ea75a 在合并前保存；原设计、返工与设计者复核记录均保留于 docs/gbk-handoff/31—34。
- frozen lockfile 安装、RPC schema 与四语言 SDK 通过官方生成器更新。版本号来自合并后的上游包版本，发行后缀为 gbk.1。
- 上游 LSP 配置抽取采用公共 config-file-sources；项目公共目录解析保留 .ompg 优先和 .omp 兼容。新增运行目录仍在 ompg 用户根内。

## 发布门禁

以下在 v18.10.2 合并后执行；合并期间旧版本或跨版本构建的结果不作为本版凭据。

| 检查 | 实测 | 范围 |
| --- | --- | --- |
| native 优化构建 | 退出 0，146 exports | win32-x64-modern；既有 LNK4217 warning 保留 |
| GBK 九文件 + ptree-stderr | 173 passed / 0 failed，591 assertions | Issue #4 子集 44 用例；实际运行 10 文件 |
| Rust 全仓 | 3205 passed / 4 skipped，退出 0 | 34 binaries；doctest 1 passed，ignored 不计通过 |
| bun check | 退出 0 | lint / format / workspace typecheck / cargo fmt / clippy -D warnings |
| 相邻读/搜/AST/编辑/写/LSP | 636 passed / 25 skipped / 0 failed，2348 assertions | 68 文件；合并后首次 LSP mux 失败已修复再验 |
| LSP mux 最终追加回归 | 13 passed / 1 skipped / 0 failed，32 assertions | 含重叠 connect 只绑定一次；不重复计入 68 文件数字 |
| 配置/发现/dirs | 324 passed / 7 skipped / 6 failed，1079 assertions | 40 文件；6 fail 全是 fs.symlink EPERM，环境阻塞，整套非 PASS |
| shell/background/fork updater | 188 passed / 8 skipped / 7 failed，455 assertions | 4 文件；7 fail 全是 fs.symlink EPERM；fork updater 拒绝官方替换用例通过 |
| eval raw capture / PTY / background | 26 passed / 0 failed，103 assertions | 6 文件，包含真实 Python runner 子进程捕获 |
| 独立 EXE 候选 | 官方构建脚本、--version、--smoke-test、doctor JSON、fork update 阻断通过 | ompg/18.10.2-gbk.1，doctor upstreamVersion 18.10.2 |
| 安装器候选 | 退出 0 | 真 EXE 18.9.0 → 18.10.2 → 18.9.0；checksum 拒绝、同版本不同字节拒绝、保守卸载、原版 omp 和用户 PATH 保留 |

native SHA256：`7ef1ed7323ace2eb1e656a8eb48730898f269a0e5585b1573ac67835618dac39`。源码提交及 EXE 字节见 build-info.json 与包内 SHA256SUMS.txt。

合并后的初次 Rust 测试有 13 个 Windows 前提/实际错误失败；逐项修正后剩 2 个引号/时区前提，再修后全过。测试未替换 symlink、未删断言或把提前返回当 PASS。shell 夹具使用内置 grep；df 按主机卷根断言；du 保留 Unix symlink 夹具并分别校验真实 Windows 夹具，时间戳复用 filetime；dd 注入确定性读错误验证错误分支。

## 使用与验收边界

- GBK 自动推断只读；编辑现存 GBK 文件需要明确工程策略，GB18030 不支持。
- 搜索 report 模式只说明已搜索范围；跳过/未搜索文件和混合/未知命令输出来源均显式记录。
- 原版 omp、旧版 ompg 和用户数据保留。新包使用新的版本号，不重传旧版本 ZIP。
- Unix 实机、真实模型、E630/Keil、真实 ACL 和同机性能 A/B 未验证。
- Windows EPERM symlink 用例保留为环境阻塞，不改权限、换 hardlink 或删除断言制造通过。
- 保护模式不是 OS 沙箱，外部程序和可信构建钩子不受 Core 全局文件编码拦截保证。
- 下载后的 GitHub 资产、包内/外校验、独立 EXE smoke 与隔离升级回退另记最终发布文档。
