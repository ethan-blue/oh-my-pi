# 01 — 现状、源码地图与工作边界

## 1. 开始前复核

以下是只读检查；在 `D:\Projects\GitProjects\oh-my-pi` 运行，分别检查原生命令退出码。

```powershell
Set-Location 'D:\Projects\GitProjects\oh-my-pi'
git status --short --branch
git diff --stat
git diff --cached --stat
git remote -v
git rev-parse HEAD
git log -1 --format='%H %s'
Get-Content -LiteralPath AGENTS.md
Get-Content -LiteralPath CONTRIBUTING.md
Get-Content -LiteralPath packages/coding-agent/DEVELOPMENT.md
```

不要执行 `reset --hard`、`clean -fdx`、覆盖式 checkout 或全仓格式化。已有未提交文档不是垃圾；把它们作为交接输入保留。不要停止用户正在运行的 OMP、IDE 或其他项目进程。

## 2. 源码确认的关键事实

| 事实 | 证据入口 | 影响 |
| --- | --- | --- |
| 编辑文件读取在 Rust 层严格 UTF-8 解码 | `crates/pi-edit/src/files.rs`，`FileCache::read_resolved` | 只加 TS 编码模块不够 |
| 快照可自行读取磁盘 | `crates/pi-edit/src/store.rs`，`record_file` | 快照与显示必须同一解码策略 |
| TS read 有整文件和流式路径 | `packages/coding-agent/src/tools/read.ts` | 不能只修小文件路径 |
| edit 主入口已重构为目录模块 | `packages/coding-agent/src/edit/index.ts` | 不要寻找已不存在的 `src/tools/edit.ts` |
| AST 在 native 文件系统上读写 | `crates/pi-natives/src/ast.rs` | 编码与 parser 的字节坐标要一起考虑 |
| grep 使用 native 搜索管道 | `crates/pi-natives/src/grep.rs` | 中文匹配和结果解码都需要验证 |
| LSP 有独立写入和恢复路径 | `packages/coding-agent/src/lsp/edits.ts` | 不能只覆盖普通 write |
| ACP 客户端可执行保存和格式化 | `packages/coding-agent/src/tools/acp-bridge.ts` | 协议回执不等于编码保持证明 |
| fallback 仅针对部分权限错误 | `packages/coding-agent/src/tools/file-write-fallback.ts` | 不能拿它充当通用 codec |

上述结论来自静态阅读；它们定位修改入口，不代表完成了运行时复现。

## 3. 核心源码地图

| 责任 | 文件 / 目录 |
| --- | --- |
| 文件解码、文本规范化、持久化语义 | `crates/pi-edit/src/files.rs`、`crates/pi-edit/src/text.rs` |
| 快照、版本、编辑会话 | `crates/pi-edit/src/store.rs`、`crates/pi-edit/src/session.rs` |
| Hashline 与 patch | `crates/pi-edit/src/modes/hashline/`、`crates/pi-edit/src/modes/patch.rs` |
| Native/TS 桥 | `crates/pi-natives/src/edit.rs`、`packages/natives/native/index.d.ts` |
| 工具调度与 host 保存 | `packages/coding-agent/src/edit/index.ts`、`packages/coding-agent/src/tools/index.ts` |
| read/write | `packages/coding-agent/src/tools/read.ts`、`packages/coding-agent/src/tools/write.ts` |
| 显示及编辑状态 | `packages/coding-agent/src/tools/read-format.ts`、`packages/coding-agent/src/edit/store.ts` |
| 自动修复 | `packages/coding-agent/src/edit/auto-repair.ts` |
| LSP 保存与编辑 | `packages/coding-agent/src/lsp/writethrough.ts`、`packages/coding-agent/src/lsp/edits.ts` |
| AST | `packages/coding-agent/src/tools/ast-edit.ts`、`crates/pi-natives/src/ast.rs` |
| 搜索 | `packages/coding-agent/src/tools/grep.ts`、`crates/pi-natives/src/grep.rs` |
| 配置注册 | `packages/coding-agent/src/config/registry.ts`、`packages/coding-agent/src/config/all-settings.ts` |
| 工具配置与项目策略 | `packages/coding-agent/src/tools/settings.ts`、`packages/coding-agent/src/config/settings.ts` |
| 子进程 | `packages/coding-agent/src/task/omp-command.ts`、`packages/coding-agent/src/task/executor.ts` |
| 内部资源路径 | `packages/coding-agent/src/internal-urls/`、`packages/utils/src/dirs.ts` |

## 4. 构建与分发地图

| 责任 | 文件 |
| --- | --- |
| 本机 native 构建 | `scripts/bazel-natives.ts`、`packages/natives/scripts/build-bindings.ts` |
| Rust 任务入口 | `scripts/run-rs-task.ts` |
| 单机二进制编译 | `packages/coding-agent/scripts/build-binary.ts` |
| 共用编译逻辑 | `packages/coding-agent/scripts/compile-binary.ts` |
| 指定平台发布二进制 | `scripts/ci-release-build-binaries.ts` |
| 嵌入和加载 native | `packages/natives/scripts/embed-native.ts`、`packages/natives/native/loader-state.js` |
| Native 身份标记 | `scripts/stamp-native-version.ts`、`packages/natives/native/version-sentinel.js` |
| Windows 安装器 | `scripts/install.ps1` |
| 更新器 | `packages/coding-agent/src/cli/update-cli.ts` |
| 上游发布 | `scripts/release.ts`、`scripts/ci-release-publish.ts`、`.github/workflows/ci.yml` |

不要直接运行上游 `bun run release` 或 `ci:release:publish`。前者管理版本/提交/标签，后者会面向 npm 发布并修改 manifest；本次目标是个人 Fork 的 GitHub Release。

## 5. 既有测试的利用方式

- Rust 编辑行为：`crates/pi-edit/tests/hashline_apply.rs`、`hashline_patcher.rs`、`session.rs`、`patch.rs`。
- 原生加载：`packages/natives/test/embed-native.test.ts`、`windows-staging.test.ts`、`natives-dir-override.test.ts`。
- 写入和快照：从 `packages/coding-agent/test/write-hashline-header.test.ts` 与 `test/tools/file-write-fallback.test.ts` 开始。
- 新测试覆盖消费者可观察行为，不写“源文件必须出现某个字符串”的测试。
- 生成的绑定应走仓库生成器，不能只手改 `.d.ts` 掩盖 Rust/TS 不一致。

## 6. 已知准备项与状态

| 项目 | 状态 | 下一动作 |
| --- | --- | --- |
| Fork、远端、基线分支 | 通过 | 每次接手复核 |
| Bun 命令可用性 | 未验证完成；当前 PATH 未找到 | 安装/选择固定版本，记录绝对路径 |
| Rust pinned toolchain | 未完成验证 | 检查本机安装，不自动改成其他 nightly |
| Rustup 检查副作用 | 已观察到尝试同步 pinned toolchain，已中止该检查进程 | 接手时先在仓库外查询工具链，再有意安装 |
| Windows C++ SDK / linker | 未验证 | 在构建前做 native 编译探测 |
| 原版 OMP 安装/配置 | 未检查 | 只枚举命令路径和元数据，不输出密钥 |
| GitHub Release | 本次查询未发现发布条目 | 实现验收后再创建 |
| 中断 clone 残留 | 另有 `D:\Projects\GitProjects\oh-my-pi-clone-interrupted-20261008` | 与正式仓库无关，禁止误当工作目录；不重试此前被策略拒绝的删除 |

## 7. 范围边界

不要修改 E630 原工程进行试验；先使用生成 fixture 和用户授权的测试副本。不要批量转换用户文件、替换全局 `omp`、迁移真实账号数据或改系统代码页。

本包不授权联系上游、创建上游 Issue/PR、发送消息或发布 npm 包。个人 Fork 的发布目标见发布章；上游 PR 另遵循贡献规则。
