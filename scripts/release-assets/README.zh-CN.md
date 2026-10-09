# ompg v18.8.7-gbk.1

基于 OMP v18.8.7 的 Windows x64（AVX2）GBK 支持分支，预发布。
命令 ompg、用户目录 ~/.ompg 与原版 omp 分开。

## 安装／升级
退出 ompg，完整解压后在本目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

默认安装到 %LOCALAPPDATA%\ompg\versions\18.8.7-gbk.1 并切换启动器。
自定义位置须加原来的 `-InstallDir "D:\Tools\ompg"`。
新开终端执行 `ompg --version`，预期 ompg/18.8.7-gbk.1。
旧版本保留；同版本不同字节拒绝覆盖。
回退使用本版脚本加 `-Download -Version 18.8.4-gbk.1`，不要用旧包中的缺陷脚本。
-NoPath 可禁止修改用户 PATH；-Uninstall 保留用户会话数据及非安装文件。

## 编码设置
复制 encoding.example.json 到工程 .omp\encoding.json，按实际编码调整 include/overrides。
如果 tests/**/*.py 也是 GBK，需要将其加入规则；不能仅凭扩展名判断编码。
编码失败先修正规则，不用 Python/PowerShell 重写源码绕过原生工具。
支持 read、edit/Hashline、write、grep、AST、LSP 的 GBK 路径；
非法字节、不可表示字符、会正规化原 GBK 字节的写入会被拒绝。GB18030 不支持。

## 可选保护模式
用户创建 UTF-8 文件 .omp\protected-mode.json：

```json
{"schemaVersion":1,"enabled":true,"buildTasks":[]}
```

默认拒绝 bash/eval，原生文件工具可用。需要构建时由用户配置可信 exe 的绝对路径与受限参数。
agent 不能修改保护配置，但仍可修复 encoding.json。
受保护构建只支持本地前台，不支持 PTY、后台任务或 ACP terminal 委派。
可信程序及构建响应文件仍可能写文件，此限制不是操作系统沙箱。

## 验证边界
ompg update 禁用，从 ethan-blue/oh-my-pi Releases 手动升级。
E630／Keil 工程、其他平台尚未验收；详见 Release 的 VALIDATION.md。
包内 build-info.json 记录构建提交和原生模块哈希，SHA256SUMS.txt 校验文件。
