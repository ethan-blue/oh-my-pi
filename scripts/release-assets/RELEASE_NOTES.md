# ompg v18.12.3-gbk.3（Windows x64 预发布）

基于 OMP 官方稳定版 v18.12.3（上游提交 `53a0377db6845e0dae606146130766ec92d407fd`），保留 ompg 的 GBK/Hashline、`.ompg` 优先与 `.omp` 兼容、runtime overrides、用户目录与自动更新隔离。完整构建提交与再次检查上游的时间以包内 `build-info.json` 为准。

## 本版变化

- 无策略 GBK 文件的读取回退提示与写入拒绝（write/edit/AST/LSP 共用同一检查点）现在携带"可原样写入"的策略提案：按文件字节证据（非 UTF-8 且严格 GBK 合法）给出最近工程根的 `.ompg/encoding.json` 路径和最小 JSON（include 由扩展名推导，无扩展名用精确文件名），照抄写入后下一次调用即恢复严格 GBK 读写。探测只提议、不授权写回。
- 含 v18.12.3-gbk.2 的全部修复：schemaVersion 1 缺省 `newFileEncoding` 自动跟随 `defaultEncoding`；doctor 以结构化 `configError` 报告坏策略不崩溃；安装示例优先 `pwsh`（PowerShell 7），5.1 兼容。
- 上游基线与 v18.12.3-gbk.2 相同（OMP v18.12.3），保留 fork 的严格编码读写与诊断、输出编码来源和替换次数、受保护构建及此前全部修复。

## 安装、升级与回退

完整解压 ZIP，在解压目录执行 `pwsh -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1`（装有 PowerShell 7 时优先；未装时系统自带 5.1 兼容：`powershell.exe` 同参数）。退出旧进程后升级；自定义安装须沿用原 `-InstallDir`。新开终端执行 `ompg --version`，应为 `ompg/18.12.3-gbk.3`。可用 `-Download -Version 18.12.3-gbk.3` 安装；回退旧版可用 `-Download -Version 18.12.3-gbk.2`。安装器保留旧版本、原版 omp 和用户数据；同版本不同字节拒绝覆盖。ompg 不从官方 OMP 更新源自动升级。

## 桥接与边界

herdr 桥接属于独立仓库 `ethan-blue/ompg-herdr-bridge`，Core ZIP 不替换扩展，须独立验收已安装文件及活动 profile 的发现路径。仅 Windows x64 AVX2、未签名预发布；GB18030 不支持，保护模式不是 OS 沙箱。测试结果与 Windows 权限、Unix、E630、真实模型和 GUI 边界见 `VALIDATION.md`。
