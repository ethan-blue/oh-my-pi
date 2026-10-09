# ompg v18.8.7-gbk.1（Windows x64 预发布）

同步 OMP 正式版 v18.8.7，并修复 GBK 编辑及安装升级问题。

## 本次修复
- Windows 安装脚本语法、卸载归属、升级和回退；同版本异字节包拒绝覆盖，校验失败保留当前版本。
- 保护模式检查会话目录与执行目录；原生工具不能关闭保护配置。
- 可信构建直接执行已检查的 argv，复用进程树超时、取消和有界输出。
- LSP 支持先创建／重命名再编辑；不稳定 GBK 原字节和不可表示字符在写入前拒绝。
- 单路径 AST 编辑补齐编码策略；兼容上游新的语法加载和 LSP 磁盘读取接口。

## 安装与升级
退出正在运行的 ompg，完整解压 ZIP，在解压目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

新开终端运行 `ompg --version`，预期 `ompg/18.8.7-gbk.1`。
自定义位置请沿用同一个 `-InstallDir`。
本版脚本支持 `-Download -Version 18.8.7-gbk.1`。
回退可使用本版脚本加 `-Download -Version 18.8.4-gbk.1`；不要执行旧包中有缺陷的安装脚本。

默认安装根 `%LOCALAPPDATA%\ompg`，数据根 `~/.ompg`；保留原版 omp。
`ompg update` 仍禁用，不会替换成官方版。
外层 SHA256SUMS.txt 校验发布资产，包内清单校验程序文件。

## 限制
- 仅 Windows x64（AVX2）；GBK 通过 .omp/encoding.json 显式指定，GB18030 不支持。
- 保护模式是工具入口限制，不是操作系统沙箱；外部程序、可信构建钩子与第三方扩展仍可能写文件。
- 真实 E630／Keil 工程、真实模型恢复、其他平台及同机性能 A/B 未验证，故保持预发布。
- 验证结果见 VALIDATION.md；构建身份与原生模块哈希见包内 build-info.json。
