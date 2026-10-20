# ompg v18.12.3-gbk.1（Windows x64 预发布）

基于 OMP 官方稳定版 v18.12.3（上游提交 `53a0377db6845e0dae606146130766ec92d407fd`），保留 ompg 的 GBK/Hashline、`.ompg` 优先与 `.omp` 兼容、runtime overrides、用户目录与自动更新隔离。完整构建提交与再次检查上游的时间以包内 `build-info.json` 为准。

## 本版变化

- 合并 OMP v18.12.3 的功能和修复，保留 fork 的严格编码读写与诊断、输出编码来源和替换次数，以及受保护构建。
- 显式指定超过 4 MiB 的 UTF-8 文件时，grep 搜索全文，在返回早期匹配或计数前验证整个文件；大文件的 GBK、递归和 multiline 搜索仍受前缀窗口限制。
- SDK 指定独立 agent 目录时，用户 `SYSTEM.md` / `SYSTEM_TEMPLATE.md` 从该目录发现，不借用其他 SDK 会话的用户配置。
- `always-ask-cached` 搜索现有、名称类似公网 URL 的本地文件或目录时会先请求授权，不再直接放行；GBK 诊断指向实际生效的编码策略（优先 `.ompg`，兼容 `.omp`）。
- 保留先前的本地记忆策略：完整 learned.md 规则在新会话生效，历史摘要默认按需读取；已有显式摘要预载预算仍有效。

## 安装、升级与回退

完整解压 ZIP，在解压目录执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1`。退出旧进程后升级；自定义安装须沿用原 `-InstallDir`。新开终端执行 `ompg --version`，应为 `ompg/18.12.3-gbk.1`。可用 `-Download -Version 18.12.3-gbk.1` 安装；回退旧版可用 `-Download -Version 18.11.1-gbk.1`。安装器保留旧版本、原版 omp 和用户数据；同版本不同字节拒绝覆盖。ompg 不从官方 OMP 更新源自动升级。

## 桥接与边界

herdr 桥接属于独立仓库 `ethan-blue/ompg-herdr-bridge`，Core ZIP 不替换扩展，须独立验收已安装文件及活动 profile 的发现路径。仅 Windows x64 AVX2、未签名预发布；GB18030 不支持，保护模式不是 OS 沙箱。测试结果与 Windows 权限、Unix、E630、真实模型和 GUI 边界见 `VALIDATION.md`。
