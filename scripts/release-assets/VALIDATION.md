# ompg v18.12.3-gbk.2 验收记录

官方稳定基线 `v18.12.3`，提交 `53a0377db6845e0dae606146130766ec92d407fd`（2026-10-19T18:41:25Z 发布）。目标为 Windows x64 AVX2 / Bun 1.4.2 / MSVC。最终构建提交、构建时间、上游复查时间和 native SHA-256 以包内 `build-info.json` 为准；本文件不预填尚未生成的哈希。

以下结果来自 v18.12.3-gbk.2 修复工作树的实际验证；最终 EXE、安装/回退、发布资产及下载复核仍须从干净交付提交完成。未通过或未执行的项目不计入通过。

| 检查 | v18.12.3-gbk.2 实测结果 |
| --- | --- |
| native | `bun run build:native` 退出 0（local profile），官方生成器生成 153 个显式 ESM exports；含本版 pi-edit 编码校验器改动 |
| 编码策略修复回归 | `gbk-issue4-config` 新增 G11 三例：schema 1 精简配置（无 `newFileEncoding`）经真实 ReadTool 解码 GBK、EditTool 写回 GBK、doctor 对不可编译策略输出结构化 `configError` 不崩溃——全部通过 |
| GBK 全套件 | 九个 GBK 定向文件（encoding、issue4-config、validation、search-ast、encoding-ambiguity、protected-mode、output-chain、output-encoding、lsp-recovery）：172 passed、0 failed、585 assertions |
| Rust 编码单元 | `cargo test -p pi-edit --lib encoding`：35 passed、0 failed（含 4 个新增 schema-1 推导/拒绝边界测试） |
| `bun check` | TS lint/格式/类型及 Rust 检查退出 0 |
| Rust 全仓 | `bun run test:rs`（nextest + `cargo test --doc`）退出 0 |
| 源码 CLI | `--version` 输出 `ompg/18.12.3-gbk.2`，`--help`、stats help、`--smoke-test` 均成功 |
| 桥接（独立） | 本版未改动桥接；沿用 v18.12.3-gbk.1 阶段记录（已安装扩展与独立仓库提交 `1a5a3ff723ac545f6d3ee637894ea6559f3b0084` 文件 SHA-256 同为 `ac7822bfb2334dfe599e92370b4e5a5e6838b6d90c4423fbabb1d78d4f1d067a`，发现路径 `~/.ompg/agent/extensions/herdr-ompg-bridge.ts`），不能当作本版新验证 |
| 双版本对照诊断 | 用本机缓存的 v18.11.1-gbk.1 与 v18.12.3-gbk.1 公开 EXE 对用户上报的精简 schema-1 配置跑 `encoding doctor`，两版行为一致（均报 `newFileEncoding is required`），确认本修复针对的是长期存在的配置形状限制而非 18.12.3 合并回归 |

**交付前仍需验证：**真实干净提交、精确上游祖先关系、最终 EXE 和嵌入的 native（版本/帮助/smoke/GBK 字节）、本地升级和回退、独立下载的 ZIP/内外校验和、下载版安装/卸载；未完成前不应将本记录视作发布通过。Bridge 不随 Core ZIP 部署，真实 herdr GUI 仍未验收。

Windows symlink 权限阻塞不等于测试通过。Unix、E630/Keil、ConPTY 性能、真实模型遵循度及 herdr GUI 未验证；GB18030 不支持，保护模式不是操作系统沙箱。