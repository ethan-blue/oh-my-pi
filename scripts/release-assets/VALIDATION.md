# ompg v18.8.7-gbk.1 验收记录

日期：2026-10-09。平台：Windows x64，Bun 1.4.2，Rust nightly-2026-10-06 / MSVC。发布类型：未签名预发布版，Windows x64 AVX2。

## 来源与构建

- 合并官方发布标签 OMP v18.8.7，提交 `f261ed9faf16b61880b544f599876bface4ded0d`；不包含其后未发布的 main 提交。
- `bun run build:native` 成功，使用本机优化 local profile；链接器有上游 CRT/wasmtime 警告，构建与加载成功。
- 独立程序构建成功；`--version` 返回 `ompg/18.8.7-gbk.1`，`--smoke-test` 返回 `smoke-test: ok`。
- 最终源码提交、原生模块摘要与工具链信息见压缩包内 build-info.json。打包要求工作树干净且成品 SHA 与 HEAD 一致。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| `bun check` | 通过：格式、lint、各包 TypeScript 检查及 Rust clippy / fmt |
| 11 文件相关 TypeScript 回归 | 199 通过、23 平台跳过、0 失败、673 断言 |
| `bun run test:rs` | 3011 通过、4 跳过、0 失败；文档测试另 1 通过、18 忽略 |
| 新原生模块的 GBK / AST / LSP / 保护模式回归 | 通过，包含在上述结果中 |
| 安装器测试 | 安装、升级、回退、同版本不同内容拒绝、损坏校验拒绝、保守卸载通过 |
| 真实程序升级回退 | 隔离目录 18.8.4-gbk.1 → 18.8.7-gbk.1 → 18.8.4-gbk.1 通过 |
| 原版共存 | 安装测试前后原版 omp.exe SHA256 与用户 PATH 不变 |

Rust 测试 PATH 包含 Git for Windows 的 POSIX 工具。修正两项平台测试假设：UTF-8 截断测试显式指定 UTF-8 fallback，sed 截断测试分别断言 Unix 快照和 Windows 流式行为；没有改动对应生产实现，也没有跳过这两项测试。

TypeScript 回归文件：gbk-encoding、gbk-validation、gbk-search-ast、gbk-lsp-recovery、gbk-protected-mode、tools/ast-edit、tools/shell-tokenize、tools/lsp-regressions，以及 utils 的 ptree-stderr、ptree-timeout、ptree-bytes。本轮未重跑全量 TypeScript 套件，不沿用旧版本全量结果。

## 未验证项与边界

- GBK 使用显式 encoding.json 策略，不承诺自动识别全部编码或 GB18030。
- 保护模式限制内置工具和受信构建入口，不是操作系统沙箱；外部进程和允许的构建脚本仍需可信。
- E630、Keil、真实付费模型、真实 LSP 服务器端到端、其他平台及无 AVX2 CPU：未验证。
- 本版未重测性能，不沿用旧版性能结论，不宣称所有模块最优。
- 本文件记录上传前本地验收；GitHub 下载校验与发布状态另记 docs/gbk-handoff/13-release-18.8.7-gbk.1.md。
