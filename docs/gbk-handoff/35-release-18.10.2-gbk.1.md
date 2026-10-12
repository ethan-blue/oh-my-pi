# Issue #4 关闭与 ompg v18.10.2-gbk.1 发布记录

## 1. 交付结论

用户明确授权检查后关闭 issue、合并最新 OMP、打包发布。Issue #4 的原生 read/grep、配置发现及安全编辑问题已经修复；合并最新正式版后再次验证，并公开发布新的 Windows x64 AVX2 **未签名预发布**。没有覆盖旧版本资产，也没有升级用户当前安装或停止用户进程。

- Release：https://github.com/ethan-blue/oh-my-pi/releases/tag/v18.10.2-gbk.1
- ZIP：https://github.com/ethan-blue/oh-my-pi/releases/download/v18.10.2-gbk.1/ompg-18.10.2-gbk.1-windows-x64.zip
- Issue：https://github.com/ethan-blue/oh-my-pi/issues/4
- 发布时间：2026-10-12T14:55:41Z；GitHub 读回 draft=false、prerelease=true、四资产 uploaded。
- #4 关闭时间：2026-10-12T14:57:33Z；读回 CLOSED / COMPLETED。Release notes 关联 #4；按用户授权直接关闭，没有发表评论。

关闭代表本 issue 的修复已经交付，不代表所有平台、所有外部程序或未来缺陷都已验收。剩余边界见第 6 节。

## 2. 代码来源与合并

| 项 | 固定身份 |
| --- | --- |
| 原有 Issue #4 工作保存 | `4f790ea75a`，55 文件；保留全部前轮实现与设计记录 |
| 首次上游合并 | `c3cdf7dd24`，官方 v18.10.1 |
| 准备期间新正式版补合并 | `8bed5f7bbb`，官方 v18.10.2 |
| 官方 v18.10.2 标签提交 | `c8913466dd7bf92040de911f8e00e30b8f4e48a2` |
| 最终源码 / Release tag 指向 | `516c7123d783078b6cbc1c516be2c85771616ded` |
| 功能分支 | `feat/gbk-text-io`，已推送 origin |
| 发行标签 | `v18.10.2-gbk.1`，已推送；解引用读回与源码 SHA 一致 |
| 包版本 / 命令身份 | upstream 18.10.2 / `ompg/18.10.2-gbk.1` |

准备开始时官方最新正式版为 v18.10.1，随后发现 v18.10.2 发布并补合并；打包、上传和公开后的 latest 查询仍为 v18.10.2。验证了该上游标签是发行标签的祖先。没有把未经发布的 upstream main 当正式版本，也没有改写 origin/main 镜像或历史 tag。

两处合并冲突逐项处理：LSP 配置抽取采用上游公共 `config-file-sources`，不恢复已废弃的重复 loader；utils dirs 保留 ompg 用户根并采用上游新 mnemopi runtime helper。另在公共工程目录入口加入 `.ompg` 优先，保留 `.omp`，用真实 LSP loadConfig 验证旧禁用、新启用的选择结果。

两次 frozen lockfile 安装均通过；RPC schema/四 SDK 用官方生成器更新，native bindings 用官方构建脚本生成，没有手改生成代码。源码增删改用 apply_patch，没有通过 shell Python/sed/perl 改写源码。

## 3. 合并后发现与修复

### 3.1 新 shell 的 Windows 兼容

初次 v18.10.2 门禁出现两处 lint 错误和 Rust 13 个失败，不拿合并期间跨版本构建的结果当最终凭据。

- uptime 的 io 模块仅 Unix 使用，按 cfg 导入；du 仅 Unix 填充 mount 集合，按 cfg 保留必要 mut。
- `rmdir e/.` 在 Windows 被路径正规化后会删掉 e。保留原始操作数的终末 `.`，返回 Invalid argument；持久回归额外要求 e 仍为目录。
- dd 的“打开目录后读取失败”夹具依赖 POSIX。复用已有 Stream 测试架构注入确定性读取错误，验证退出 1、诊断、零记录与空输出，所有系统都执行读失败分支。
- df 在 Windows 的真实挂载根为盘符根，而非 `/`；断言物理卷根、完整行数和字段值，保留错误与 total 行语义。
- du 的 fixture 原本只在 Unix 创建 symlink，却在 Windows 也要求多计 1 inode/6 bytes。分别断言实际平台夹具，保留硬链接去重和 count-links 断言；不新增替代链接、不删除符号链接测试。目录时间戳复用现有 filetime 依赖。
- env 的夹具调用内置 grep，移除 `/usr/bin/grep` 前提。第二轮剩余 2 失败分别是 Windows 路径正常 shell quoting、固定 UTC 的断言；显式 literal quoting 验证 PWD，比较完整/缩写时间选项的真实输出验证 GNU 参数语义。

最终 Rust 全仓通过，初次失败日志保留。

### 3.2 LSP mux 清理与并发

相邻套件首次出现 10 个 LSP mux 失败：子进程未退出即清理临时 cwd 产生 EBUSY，以及断开会话的文档清理未完成时新 link 无法复用。

修复集中在 `packages/coding-agent/src/lsp/mux/server.ts`：

1. shutdown / 已在 stopping 的子进程都等待自己的 exited promise，确保资源释放。
2. 按 server key 等待已断开 session 的 closePromise，文档清理结束后重新选择可用进程，保留并发 link 独占。
3. 等待后重新检查 session closed / shutdown / already bound；新增真实 IPC 回归，重叠 connect 只有一次成功、一次明确拒绝，且只创建一个子进程。

原 68 文件相邻套件再验全过；追加并发回归后 mux 单独再验 13 passed / 1 skipped。没用测试目录重试删除来掩盖实际进程生命周期问题。

## 4. 最终门禁与实际边界

| 执行 | 结果 | 日志 |
| --- | --- | --- |
| native 优化构建 | 退出 0，146 exports，win32-x64-modern | `ompg-final-native.log` |
| GBK 九文件 + ptree-stderr | 173 passed / 0 failed，591 assertions；Issue #4 子集 44 用例 | `ompg-final-gbk.log` |
| Rust 全仓 | 3205 passed / 4 skipped，34 binaries；doctest 1 passed | `ompg-final-rust-fixed.log` |
| 最终提交 bun check | 退出 0；lint、6022 文件 format、workspace typecheck、Rust fmt/clippy -D warnings | `ompg-final-check-commit.log` |
| 读/搜/AST/编辑/写/LSP 相邻 | 636 passed / 25 skipped / 0 failed，2348 assertions，68 文件 | `ompg-final-adjacent-fixed.log` |
| mux 最终追加回归 | 13 passed / 1 skipped / 0 failed，32 assertions | `ompg-final-mux-release.log` |
| 配置/发现/dirs | 324 passed / 7 skipped / 6 failed，1079 assertions，40 文件；退出 1 | `ompg-final-config.log` |
| shell/background/updater | 188 passed / 8 skipped / 7 failed，455 assertions，4 文件；退出 1 | `ompg-final-shell-update.log` |
| eval raw capture / Python runner / PTY / background | 26 passed / 0 failed，103 assertions，6 文件 | `ompg-final-capture.log` |
| 正式提交构建独立 EXE | 退出 0，官方 build-binary 脚本 | `ompg-final-exe-release.log` |
| EXE version / smoke / doctor | ompg/18.10.2-gbk.1；smoke-test: ok；doctor upstreamVersion=18.10.2 | `ompg-final-smoke-release.log`、`ompg-final-doctor-release.json` |
| fork update | 明确拒绝官方自更新并给出手动安装步骤；消费者持久回归通过 | `ompg-final-update-block.log` |
| 真 EXE 隔离升级回退 | 18.9.0 → 18.10.2 → 18.9.0；退出 0；校验失败拒绝、同版本不同字节拒绝、保守卸载通过 | `ompg-final-installer-release.log` |
| 正式打包 | 退出 0，要求 clean worktree / HEAD SHA / EXE version 一致 | `ompg-final-package.log` |
| 公开 URL 隔离安装 | 下载 ZIP+sums、内外校验、安装后 version/hash/smoke、卸载均过；用户 PATH / 原版 omp 字节保留 | `ompg-final-public-install.log` |
| git diff --check | 退出 0 | 最终核查 |

配置套件的 6 个 EPERM 与 34 号相同：4 个 agent-plugin 逃逸链接、noncanonical home 和 Claude project 隔离。updater 的 7 个失败也全部发生在 fs.symlink 创建，涉及 npm/Bun/foreign launcher/Homebrew 链接检测。它们未执行到安全断言，两个扩大套件不能标为 PASS；没有修改系统权限、改成 hardlink、删除测试或放宽断言。fork app updater 阻断已独立通过，实际 ompg 分版本安装/回退验证通过。

预发布允许保留这些已披露的环境阻塞。Rust 测试现存 test-only warning 与 native 既有 LNK4217 warning 保留，未冒充无警告构建。各测试表有子集重叠，不把所有数字相加当唯一用例总量。

## 5. 资产与分发验证

正式发布包含四资产：ZIP、SHA256SUMS.txt、RELEASE_NOTES.md、VALIDATION.md。ZIP 113189902 bytes。

| 内容 | SHA256 |
| --- | --- |
| ZIP | `0ceec34f39ed241e67ab22d7e37ea9b9cbb404bcd50500c9ec57794de7aa26ef` |
| EXE | `48d01f35436dc37d57fa90a4748247d3af170a776bf59409ad78f3664f293efb` |
| embedded native | `7ef1ed7323ace2eb1e656a8eb48730898f269a0e5585b1573ac67835618dac39` |
| RELEASE_NOTES.md | `7fb4f52293749071afaa96b95ed6fd85a010bff43f536c86352109a5293a6088` |
| VALIDATION.md | `cd96576f6e019450388487d4e1a28e929edd1e5b9c3d07b0cd8fe30959507aa6` |
| 外层 SHA256SUMS.txt | `8bc7232fa494af6ac3f02d3651ed9191cd72f8794268b166bae56bed932df7ea` |

先建草稿上传，下载至新的 `release-staging/18.10.2-gbk.1-download-verify`；实际比较四个 GitHub digest、外层三条和内层七条清单。核对 build-info 的发行号、上游基础号、源码提交、native SHA 与 embedded=true。下载 EXE 独立运行 version 和 smoke 均通过，然后公开预发布。

公开后用**下载包内安装器**在新的 TEMP 安装根执行 `-Download -Version 18.10.2-gbk.1 -NoPath`，实际经过公开 Release URL 再下载一次。安装后 EXE 哈希与上表严格一致，真实 smoke 通过，再保守卸载该探针；用户 PATH 和原版 omp 保留。没有改用户的现有 ompg 安装。

原 18.9.0 与更早资产均保留。发布后仅追加本记录；不会移动 release tag、重传相同版本的不同字节或让文档提交冒充编译源码 SHA。

本轮日志和 GitHub 最终快照归档于：

`C:\Users\Ethan\Documents\Codex\2026-10-08\gbk-extension-omp-pi-ai-read\issue4-review-evidence\2026-10-12-release-18.10.2-gbk.1`

## 6. 使用与未验证范围

完整解压 ZIP，在解压目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
ompg --version
```

自定义安装目录沿用原 `-InstallDir`，退出运行中的 ompg 后操作。默认 `%LOCALAPPDATA%\ompg`；旧版本保留。回退用本版安装器 `-Download -Version 18.9.0-gbk.1`，沿用安装目录。不要用 `ompg update` 切换到原版。

没有 `.ompg` 目录也可 read/grep 合法 GBK；严格 UTF-8 失败才回退严格 GBK，推断只读。编辑 GBK 工程先使用：

```powershell
ompg encoding init --path "D:\Work\E630" --profile gbk-source
ompg encoding doctor "D:\Work\E630\src\main.c" --json
```

新策略默认 `.ompg/encoding.json`，`.omp` 仍是有效兼容入口。安装器结尾的旧 `.omp` 提示也仍可用；新工程优先遵循包内 README 的 init 指令。坏配置不回退，子工程按目标路径发现；修改配置与源码拆为两次原生调用。`.py` 为 GBK 时需加入 include，不能用 shell Python/PowerShell 改写绕过工具错误。

尚未验收：Unix 实机、真实特权 symlink、真实 ACL、真实模型、E630/Keil 工程、同机性能 A/B。GB18030 不支持。工具保护模式不是 OS 沙箱，外部程序、第三方扩展与可信构建没有全局编码拦截保证；ConPTY/用户代码已损坏解码不可恢复。不宣称模块性能全部最优，也不把 ignored/skipped 当通过。

## 7. 后续维护交接

```text
在 D:\Projects\GitProjects\oh-my-pi 继续。先读 AGENTS.md、02 协议、31/33/34/35 交接记录、git status/diff。
Issue #4 已关闭，v18.10.2-gbk.1 已公开，源码固定 516c7123d783078b6cbc1c516be2c85771616ded。
保留未提交工作和旧 release；禁止 reset/restore、移动 tag 或覆盖同版本资产。

源文件仅用原生 edit/write/apply_patch。复用共享 codec、目标路径配置发现、EditStore/Hashline、官方生成器和现有安装器；不复制字符表，不用 shell Python/sed/perl 改源码。
升级先固定最新官方正式 tag，合并保留 .ompg 优先/.omp 兼容、目标子策略、坏配置 fail closed、auto 写入双 codec 校验、搜索窗口语义和保护入口。
新 LSP mux 必须完成 disconnected 文档清理再复用，并在 shutdown 后等待自己的 child exited；重叠 connect 只能绑定一次。

修改后按实际影响复现并补持久回归。Rust 用 bun run build:native / CI=1 bun run test:rs；全仓 CI=1 bun check。
GBK 九文件外包含 ptree-stderr。配置、AST、LSP、后台 shell/eval 变化按本记录跑相邻消费者。
symlink EPERM 是环境阻塞：不改权限、不替换链接、不删测试、不声称安全断言通过。

新发行必须升新 fork 版本、从 clean commit 构建 EXE、真实 version/smoke/doctor、真 EXE 隔离升级回退、内外哈希和公开 URL 安装验证。
原版 omp 和用户数据保持隔离，fork 官方自更新保持阻断；用户安装不是发布验证沙箱。
新用户缺陷按新证据调查，不能用已关闭 issue 或历史绿灯替代当前验证。GitHub 评论仍受 AGENTS 的预览/确认规则约束。
```
