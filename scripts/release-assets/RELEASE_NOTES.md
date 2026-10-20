# ompg v18.12.3-gbk.2（Windows x64 预发布）

基于 OMP 官方稳定版 v18.12.3（上游提交 `53a0377db6845e0dae606146130766ec92d407fd`），保留 ompg 的 GBK/Hashline、`.ompg` 优先与 `.omp` 兼容、runtime overrides、用户目录与自动更新隔离。完整构建提交与再次检查上游的时间以包内 `build-info.json` 为准。

## 本版变化

- schemaVersion 1 的 `encoding.json` 只要写明 `defaultEncoding` 即可生效：缺省的 `newFileEncoding` 自动跟随固定默认编码，手写的精简 GBK 配置无需补字段即可 read/edit；schemaVersion 2 仍要求显式声明。
- `ompg encoding doctor` 遇到无法读取或无法编译的编码策略时，以结构化 `configError` 字段报告并给出修复指引，不再抛栈崩溃。
- 安装示例改为优先 `pwsh`（PowerShell 7），系统自带 5.1 保持兼容，避免 5.1 继承 PS7 会话模块路径导致的冲突。
- 上游基线与 v18.12.3-gbk.1 相同（OMP v18.12.3），保留 fork 的严格编码读写与诊断、输出编码来源和替换次数、受保护构建及 v18.12.3-gbk.1 的全部修复。

## 安装、升级与回退

完整解压 ZIP，在解压目录执行 `pwsh -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1`（装有 PowerShell 7 时优先；未装时系统自带 5.1 兼容：`powershell.exe` 同参数）。退出旧进程后升级；自定义安装须沿用原 `-InstallDir`。新开终端执行 `ompg --version`，应为 `ompg/18.12.3-gbk.2`。可用 `-Download -Version 18.12.3-gbk.2` 安装；回退旧版可用 `-Download -Version 18.12.3-gbk.1`。安装器保留旧版本、原版 omp 和用户数据；同版本不同字节拒绝覆盖。ompg 不从官方 OMP 更新源自动升级。

## 桥接与边界

herdr 桥接属于独立仓库 `ethan-blue/ompg-herdr-bridge`，Core ZIP 不替换扩展，须独立验收已安装文件及活动 profile 的发现路径。仅 Windows x64 AVX2、未签名预发布；GB18030 不支持，保护模式不是 OS 沙箱。测试结果与 Windows 权限、Unix、E630、真实模型和 GUI 边界见 `VALIDATION.md`。
