# ompg v18.12.3-gbk.3 验收记录

官方稳定基线 `v18.12.3`，提交 `53a0377db6845e0dae606146130766ec92d407fd`（2026-10-19T18:41:25Z 发布）。目标为 Windows x64 AVX2 / Bun 1.4.2 / MSVC。最终构建提交、构建时间、上游复查时间和 native SHA-256 以包内 `build-info.json` 为准；本文件不预填尚未生成的哈希。

以下结果来自 v18.12.3-gbk.3 修复工作树的实际验证；最终 EXE、安装/回退、发布资产及下载复核仍须从干净交付提交完成。未通过或未执行的项目不计入通过。

| 检查 | v18.12.3-gbk.3 实测结果 |
| --- | --- |
| 改动面 | 纯 TS（`encoding/index.ts` 提案生成 + 拒绝/提示文案、G12 测试）；原生模块与 v18.12.3-gbk.2 构建所嵌完全一致，未重编 |
| 策略提案回归 | `gbk-issue4-config` 新增 G12 三例全部通过：写入拒绝携带可原样写入的 `.ompg/encoding.json` 提案，从拒绝文本提取 JSON 写入后重试成功且落盘为严格 GBK 字节（往返闭环）；无扩展名文件给出精确文件名 glob；只读回退提示携带同一提案 |
| GBK 全套件 | 九个 GBK 定向文件（encoding、issue4-config、validation、search-ast、encoding-ambiguity、protected-mode、output-chain、output-encoding、lsp-recovery）：175 passed、0 failed |
| `bun check` | TS lint/格式/类型及 Rust 检查退出 0 |
| 源码 CLI | `--version` 输出 `ompg/18.12.3-gbk.3`，`--help`、stats help、`--smoke-test` 均成功 |
| 桥接（独立） | 本版未改动桥接；沿用 v18.12.3-gbk.1 阶段记录（已安装扩展与独立仓库提交 `1a5a3ff723ac545f6d3ee637894ea6559f3b0084` 文件 SHA-256 同为 `ac7822bfb2334dfe599e92370b4e5a5e6838b6d90c4423fbabb1d78d4f1d067a`，发现路径 `~/.ompg/agent/extensions/herdr-ompg-bridge.ts`），不能当作本版新验证 |

**交付前仍需验证：**真实干净提交、精确上游祖先关系、最终 EXE 和嵌入的 native（版本/帮助/smoke/GBK 字节/提案文案）、本地升级和回退、独立下载的 ZIP/内外校验和、下载版安装/卸载；未完成前不应将本记录视作发布通过。Bridge 不随 Core ZIP 部署，真实 herdr GUI 仍未验收。

Windows symlink 权限阻塞不等于测试通过。Unix、E630/Keil、ConPTY 性能、真实模型遵循度及 herdr GUI 未验证；GB18030 不支持，保护模式不是操作系统沙箱。