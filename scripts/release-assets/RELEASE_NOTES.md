# ompg v18.9.0-gbk.1（Windows x64 预发布）

同步发布时核实的 OMP 最新正式版 v18.9.0（上游 SHA `eec114a9226da698ebc015fd8996a8ca3bc4625c`），保留原版配置兼容与 ompg 安装隔离。

## 本次修复

- #3 的六项改进：Python coding 声明写前保护，未管理文件严格解码，read/grep 行为一致，GBK/UTF-8 范围诊断，命令输出编码参数与来源报告，策略缺失恢复指引。
- write/edit/LSP/AST/read 窗口复用共享诊断；大文件和未完整范围明确报告限制，保持 Hashline、原编码与原字节保护。
- shell 链、双流及 PTY 聚合真实来源；未知读取方不伪造 utf8/0。Python PIPE 原 bytes 经 host native 解码，EOF 与文本交付确认后才给完整摘要；显示截断仍排空。
- Python kernel-scope fd-1 跨请求持续解码，晚到输出单列；JS byte-write 使用同一 decoder，普通文本保持原样。
- 修复策略内容变化但 mtime 相同的缓存失效、ACP 损失计数、eval 取消来源丢失、双向 PIPE 死锁及 raw 帧大小边界。
- 保留 grep 原有的 NUL 二进制排除规则，在严格文本解码前跳过 SQLite 等二进制文件；覆盖目录、显式文件与大文件窗口，非法文本仍明确报错。
- 保留 Windows 安装校验、分版本升级与回退、保护构建和原版 omp 共存。上游独立 Python 控制输入通道与新增更新接口已整合，ompg 自动更新仍禁用，避免替换为官方版。

## 安装与升级
退出正在运行的 ompg，完整解压 ZIP，在解压目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

新开终端运行 `ompg --version`，预期 `ompg/18.9.0-gbk.1`。
自定义位置请沿用同一个 `-InstallDir`。
本版脚本支持 `-Download -Version 18.9.0-gbk.1`。
回退可使用本版脚本加 `-Download -Version 18.8.7-gbk.1`；不要执行更早包中有缺陷的安装脚本。

默认安装根 `%LOCALAPPDATA%\ompg`，数据根 `~/.ompg`；保留原版 omp。
`ompg update` 仍禁用，不会替换成官方版。
外层 SHA256SUMS.txt 校验发布资产，包内清单校验程序文件。

## 限制
- 仅 Windows x64（AVX2）；GBK 通过 .omp/encoding.json 显式指定，GB18030 不支持。
- 保护模式是工具入口限制，不是操作系统沙箱；外部程序、可信构建钩子与第三方扩展仍可能写文件。
- 真实 E630／Keil 工程、真实模型恢复、其他平台及同机性能 A/B 未验证，故保持预发布。
- 验证结果见 VALIDATION.md；构建身份与原生模块哈希见包内 build-info.json。
- fd-1 单请求归属和 JS 持久 writer EOF 未获证明时明确 unknown；用户代码内部错误 decode 的字符串不可逆，继承子进程 raw stdio 绕过 JS write hook 的路径未覆盖。
