# ompg v18.12.2-gbk.1 验收记录

官方稳定基线 `v18.12.2`，提交 `1d5aff90b057ce7dbfe32ea557a527c1b3144b72`（2026-10-18T21:03:22Z 发布）。目标为 Windows x64 AVX2 / Bun 1.4.2 / MSVC。最终构建提交、构建时间、上游复查时间和 native SHA-256 以包内 `build-info.json` 为准；本文件不预填尚未生成的哈希。

| 检查 | 本轮结果 |
| --- | --- |
| native | `bun run build:native` 退出 0，生成 150 个显式 ESM exports；链接器 LNK4217 警告未导致失败 |
| GBK 回归 | `bun test` 九个 `gbk*.test.ts`：167 passed、0 failed、565 assertions |
| GBK/输出/task/配置/提示词 | 13 个定向文件：205 passed、0 failed、655 assertions；与上一行重叠，不能相加 |
| 设置页顺序 | 合并后补登记 `Text Encoding` 分组；5 passed、0 failed、47 assertions |
| `bun check` | TS lint/格式/类型及 Rust 检查退出 0；有上游 `new Array` oxlint warning |
| Rust 全仓 | 在本次进程的 PATH 加入 Git `usr/bin` 后，3330 passed、4 skipped；doctest 1 passed、18 ignored，退出 0；首次运行 11 failed（五项 Windows `du` 测试预期已修正，六项测试缺 `sh.exe`/`gzip.exe`） |
| 源码 CLI | `--version` 输出 `ompg/18.12.2-gbk.1`，`--help`、stats help、`--smoke-test` 成功 |
| 桥接（独立） | `bridge.test.ts` 6 passed、0 failed；已安装扩展与独立仓库提交 `1a5a3ff723ac545f6d3ee637894ea6559f3b0084` 文件 SHA-256 同为 `ac7822bfb2334dfe599e92370b4e5a5e6838b6d90c4423fbabb1d78d4f1d067a`；实际默认目录发现路径唯一：`~/.ompg/agent/extensions/herdr-ompg-bridge.ts` |
| TypeScript 全仓 `bun run test` | 初轮 214 个执行分块中 153 passed、61 failed；涉及 Windows symlink EPERM、继承的非官方 `ANTHROPIC_BASE_URL` 和 fork/上游断言差异。尚未完成分组归因或环境隔离重跑，不记为通过。 |

**交付前仍需验证：**真实干净提交、精确上游祖先关系、最终 EXE 和嵌入的 native（版本/帮助/smoke/GBK 字节）、本地升级和回退、独立下载的 ZIP/内外校验和、下载版安装/卸载；未完成前不应将本记录视作发布通过。Bridge 不随 Core ZIP 部署，真实 herdr GUI 仍未验收。

Windows symlink 权限阻塞不等于测试通过。Unix、E630/Keil、ConPTY 性能、真实模型遵循度及 herdr GUI 未验证；GB18030 不支持，保护模式不是操作系统沙箱。