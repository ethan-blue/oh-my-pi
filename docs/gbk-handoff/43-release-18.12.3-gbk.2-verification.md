# 43 · v18.12.3-gbk.2 发布验证

发布时间 2026-10-20T05:26Z 前后；本文件为发布后补记，随发布后文档提交入库。

## 交付与基线

- 交付提交 `87d6df41bbba319a20d545781a9cd5581a80aaa8`（`fix(ompg): accept minimal schema-1 encoding policies and harden doctor diagnostics`），第一父链包含 `3280c046ba`（v18.12.3-gbk.1 发布验证）与合并提交 `6da8efd9b2`（Merge OMP v18.12.3）。
- 官方稳定基线 `v18.12.3`，标签提交 `53a0377db6845e0dae606146130766ec92d407fd`（2026-10-19T18:41:25Z 发布）。本轮修改前（13:05 前后 +08）、打包器内置检查（build-info.json `upstreamCheckedAt` 2026-10-20T05:16:55Z）与发布后三次查询一致，仍为 v18.12.3；`git merge-base --is-ancestor` 确认上游提交为交付提交祖先。上游基线与上一版相同，仅升 fork 后缀。
- 远端 `origin/feat/gbk-text-io` 推进到交付提交；新附注标签 `v18.12.3-gbk.2` 指向交付提交。旧资产未触碰（release-staging 历史目录与既有 Release 全部保留）。

## 本版修复（用户 2026-10-20 反馈驱动）

1. **schemaVersion 1 精简编码策略被无条件拒绝**（根因，非合并回归）：`crates/pi-edit/src/encoding.rs` 的编译器此前对任何启用策略强制要求 `newFileEncoding`，而同一编译器又规定 include 范围内该字段必须等于 `defaultEncoding`——唯一合法值却要求手写。现 schema 1 缺省时从固定 `defaultEncoding` 推导；schema 2 保持显式要求。双版本对照（本机缓存的 v18.11.1-gbk.1 与 v18.12.3-gbk.1 公开 EXE 对同一精简配置跑 doctor）证明该限制自 fork 首个 GBK 提交 `be4258d69c` 起即存在，用户更新前 GBK 读取实为无策略只读回退所服务。
2. **doctor 崩溃**：`encoding-cli.ts` 捕获 `EncodingConfigError`，以结构化 `configError` 字段（configPath/kind/message）+ 修复指引输出，人读模式附 `Policy Error` 行；目标解析降级为 unmanaged 报告而非抛栈。
3. **安装文档 5.1 优先**：release-assets 两个文档的安装示例改为优先 `pwsh`（PowerShell 7），注明系统自带 `powershell.exe` 5.1 兼容；起因是用户侧 5.1 继承 PS7 会话模块路径发生冲突。安装器脚本本身不自唤任何 PowerShell，两代均兼容。

## 验证记录

- `bun check` 退出 0；九个 GBK 定向套件 172 过 0 败（含新增 G11 三例：精简 schema-1 配置经真实 ReadTool 解码 GBK、EditTool 写回 GBK、doctor 对不可编译策略结构化报告）；`cargo test -p pi-edit --lib encoding` 35 过 0 败（含 4 个新增推导/拒绝边界）；`bun run test:rs`（nextest + doctest）退出 0；源码 CLI `--version`＝`ompg/18.12.3-gbk.2`、`--smoke-test: ok`。
- 干净提交 `87d6df41bb` 上构建 `dist/omp.exe`（224,336,896 字节，SHA-256 `30ba1a6a84d872bb53c21be069834eb643af4f9c1865452dfb2dcad9a33ba3f1`）。**关键坑位：EXE 探针必须同时隔离 `PI_CODING_AGENT_DIR` 与 `PI_NATIVES_DIR`**——只隔离前者时 loader 会从用户真实 `~/.ompg/natives` 加载旧版原生模块，TS 修复生效而 Rust 行为仍旧，极易误判为构建失败。双隔离下用户原始配置（`.omp/encoding.json`，schemaVersion 1、无 newFileEncoding）解析为 `assignment: gbk`、`writeEligible: true`。
- `package-ompg-release.ts --version 18.12.3-gbk.2 --sha 87d6df41bb…`：外清单 3/3、ZIP 内清单 7/7、build-info 字段齐全（nativeAddon.sha256 `237869a3f438e0d73a3e39e3252841dffc6748a4d6e7a9f976421971b7d54a49` 与仓库 `packages/natives/native/pi_natives.win32-x64-modern.node` 一致）。
- `test-install-ompg.ps1`（新 EXE + v18.12.3-gbk.1 PreviousExe）：parse/install/upgrade/rollback/checksum 拒绝/保守卸载/原 omp 与 PATH 保全 PASS。**该脚手架须用 `powershell.exe` 5.1 运行：pwsh 7 的 `Add-Type -OutputType ConsoleApplication` 不受支持。**
- 认证通道（gh）逐资产下载：3/3 哈希与 staging 一致，SHA256SUMS.txt 自身 digest 与远端一致；解压后内清单 7/7，EXE `--version`/`--smoke-test` 通过，双隔离 GBK 探针通过。
- `--draft=false --prerelease` 公开后回读：`isDraft=false`、`isPrerelease=true`、4 资产 digest 与本地一致。
- 公开（未认证 curl）下载 ZIP 哈希一致；下载版安装到沙箱成功；`-Download -Version 18.12.3-gbk.1` 公开回退成功，两版本目录并存。

## 未验证边界（如实记录）

Windows symlink 权限阻塞不等于测试通过。Unix、E630/Keil、ConPTY 性能、真实模型遵循度未验证；GB18030 不支持；保护模式不是操作系统沙箱。Bridge 为独立部署（沿用已验证的 `1a5a3ff7…` / SHA `ac7822bf…`，未随本版重验，真实 herdr GUI 仍未验收）。发布为未签名 Windows x64 AVX2 预发布。TypeScript 全仓 test:ts 本轮未重跑（改动面为 Rust 校验器 + CLI 容错 + 文档，定向套件与 check 已覆盖；上轮全量归因结论仍有效）。
