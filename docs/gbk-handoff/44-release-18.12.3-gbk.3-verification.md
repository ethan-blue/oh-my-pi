# 44 · v18.12.3-gbk.3 发布验证

发布时间 2026-10-20T06:15Z 前后；本文件为发布后补记，随发布后文档提交入库。

## 交付与基线

- 交付提交 `11ffa5dcb55082bcafd5e4f721a9ef45da718bb2`（`chore: bump fork distribution to 18.12.3-gbk.3`），其第一父为功能提交 `517f376b55`（`feat(ompg): propose a ready-to-write encoding policy from GBK byte evidence`），再往上含 v18.12.3-gbk.2 的发布验证提交 `e5973a35aa` 与合并提交 `6da8efd9b2`（Merge OMP v18.12.3）。
- 官方稳定基线 `v18.12.3`，标签提交 `53a0377db6845e0dae606146130766ec92d407fd`（2026-10-19T18:41:25Z 发布）。发布前（14:00 前后 +08，`git ls-remote` 复核最新 tag 仍为 v18.12.3）、打包器内置检查（build-info.json `upstreamCheckedAt` 2026-10-20T05:45Z 前后）两次一致；`git merge-base --is-ancestor` 确认上游提交为交付提交祖先。上游基线与 gbk.2 相同，仅升 fork 后缀。
- 远端 `origin/feat/gbk-text-io` 已含两个交付提交；新附注标签 `v18.12.3-gbk.3` 指向交付提交并已推送。旧资产未触碰。

## 本版内容（产品功能）

无策略 GBK 文件的读取回退提示与写入拒绝（write/edit/ast-edit/LSP 共用 `assertTextWriteEligibility` 闸口；doctor 经 `writeRefusalReason` 带出）现在在字节证据成立（非 UTF-8 且严格 GBK 合法）时追加**可原样写入的策略提案**：最近 `.git` 工程根的 `.ompg/encoding.json` 路径 + 最小 schema-1 JSON（include 由扩展名推导为 `**/*.c` 形式，无扩展名用精确文件名 glob）。G12 测试证明从拒绝文本原样提取 JSON 写入后重试即成功且落盘为严格 GBK 字节。探测只提议、永不授权写回（#6 审计边界不变）。

## 验证记录

- `bun check` 退出 0；九个 GBK 定向套件 175 过 0 败（含 G12 三例：提案往返闭环、无扩展名精确 glob、回退提示携带提案）。纯 TS 改动：原生模块未重编，`pi_natives.win32-x64-modern.node` SHA-256 `237869a3f438e0d73a3e39e3252841dffc6748a4d6e7a9f976421971b7d54a49` 与 v18.12.3-gbk.2 所嵌一致（build-info 记录同值）。
- 干净交付提交 `11ffa5dcb5` 上构建 `dist/omp.exe`（224,345,600 字节，SHA-256 `215b968f013238d2132b80ff6c13e2f9b393b446bd6e676d1774297f107917a2`），`--version`＝`ompg/18.12.3-gbk.3`、`--smoke-test: ok`。双隔离（`PI_CODING_AGENT_DIR`+`PI_NATIVES_DIR`）探针：用户原始精简配置 → `assignment: gbk`、`writeEligible: true`；无策略 GBK 文件 doctor → 拒绝理由携带完整提案文案与路径。
- `package-ompg-release.ts --version 18.12.3-gbk.3 --sha 11ffa5dcb5…`：外清单 3/3、ZIP 内清单 7/7、build-info commitSha 指向交付提交。
- `test-install-ompg.ps1`（5.1 运行；新 EXE + v18.12.3-gbk.2 PreviousExe）：parse/install/upgrade/rollback/checksum 拒绝/保守卸载/原 omp 与 PATH 保全 PASS。
- 认证通道（gh）逐资产下载：3/3 哈希与 staging 一致；SHA256SUMS.txt 自身 digest `04939815…` 与远端一致；解压后内清单 7/7，EXE `--version`/`--smoke-test` 通过，双隔离 GBK 探针（托管 + 提案文案）通过。
- `--draft=false --prerelease` 公开后回读：`isDraft=false`、`isPrerelease=true`、4 资产 digest 与本地一致。
- 公开（未认证 curl）下载 ZIP 哈希 `153f6930…` 与 staging 一致；下载版安装到沙箱成功（`ompg/18.12.3-gbk.3`）；`-Download -Version 18.12.3-gbk.2` 公开回退成功。

## 未验证边界（如实记录）

Windows symlink 权限阻塞不等于测试通过。Unix、E630/Keil、ConPTY 性能、真实模型遵循度未验证；GB18030 不支持；保护模式不是操作系统沙箱。Bridge 为独立部署（沿用已验证的 `1a5a3ff7…` / SHA `ac7822bf…`，未随本版重验，真实 herdr GUI 仍未验收）。发布为未签名 Windows x64 AVX2 预发布。TypeScript 全仓 test:ts 本轮未重跑（纯 TS 文案与提示改动，定向套件与 check 已覆盖）。
