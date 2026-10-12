# ompg v18.10.2-gbk.1（Windows x64 预发布）

合并 OMP 官方 v18.10.2，保留 ompg 命令、用户数据隔离、严格 GBK codec、Hashline 和 Windows 分版本安装器。源码和构建身份见包内 build-info.json。

## Issue #4 修复

- 无需创建配置目录即可 read/grep 合法 GBK 源码。严格 UTF-8 失败才回退严格 GBK；读取明确标注推断来源，推断不授权写入。
- 递归搜索兼容 GBK/UTF-8 混合工程和子工程策略；坏文件默认报告并继续，零命中不冒充未搜索文件没有结果。
- .ompg 工程配置优先，.omp 兼容；对应文件缺失才回退，坏配置不降级。doctor/init、全局只读开关、config.yml/config.yaml、MCP、skills 和提示文件入口贯通。
- 修复父策略覆盖子工程、外部 read/edit 不一致、AST 解码/持久化错用 cwd 策略、大文件边界误判和混用编码。
- 编辑/LSP 修改配置立即失效缓存；配置和源码的混合批次在写前拒绝。auto 真正双合法字节要求显式 override，仅 UTF-8 合法文件正常编辑。
- 保留原 GBK 字节、BOM/换行冲突保护、Python coding 声明保护以及命令输出混合/未知来源报告。doctor 显示实际 fork 发行号并单列上游版本。

关联：[Issue #4](https://github.com/ethan-blue/oh-my-pi/issues/4)。具体回归和未验证边界见 VALIDATION.md。

## 合并后的 Windows 修复

- `rmdir e/.` 拒绝移除目录，并验证原目录保留。
- LSP mux 关闭等待自己的子进程退出；断开的会话完成文档清理后再复用服务器；重叠 connect 请求只能绑定一次。
- 统一 LSP 工程配置入口继续识别 .ompg 优先和 .omp 兼容，使用实际 loadConfig 回归验证。

## 升级与回退

退出运行中的 ompg，完整解压新版 ZIP，在解压目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

自定义安装目录时沿用原 -InstallDir；新开终端 ompg --version 应为 ompg/18.10.2-gbk.1。
支持本版安装器 -Download -Version 18.10.2-gbk.1；回退用 -Download -Version 18.9.0-gbk.1。旧包保留，不覆盖同版本的不同字节。

默认安装根 %LOCALAPPDATA%\ompg，用户数据根 ~/.ompg，保留原版 omp。ompg update 继续阻断官方更新，避免替换成原版。

## 发布边界

仅 Windows x64 AVX2，未签名预发布。GB18030 不支持。保护模式是工具入口限制，不是操作系统沙箱；外部程序、第三方扩展和可信构建仍需自行约束。

真实 E630/Keil、真实模型、其他平台和完整 symlink 权限场景尚未验收；不把环境阻塞或 skipped 计为通过。输出已经被 ConPTY 或用户代码错误解码的内容不可恢复。
