# ompg v18.10.2-gbk.2（Windows x64 预发布）

本版基于已合并的 OMP v18.10.2，修复 [Issue #5](https://github.com/ethan-blue/oh-my-pi/issues/5) 中可在当前源码和本机验证的缺陷，保留上一版 GBK/Hashline、.ompg 配置发现与原版 omp 共存能力。构建来源见 build-info.json。

## 本轮修复

- 自定义 Cloud Code Assist provider 别名继承 Gemini 3+ 首调用签名 bypass；中断且缺失有效首签名的历史调用组不再重放为 functionCall。配对工具结果保留为用户观察；真实首签名覆盖的并行调用不被误删。
- Windows 真 TTY 使用现有 native writer 的后台线程，缓慢终端排空不再在 JS 线程直接执行阻塞写。保留 FIFO、Unicode、pending、dead、有界 stop 与构造失败回退。
- 新增 task.agentRuntimeOverrides：按精确 agent 名设置运行上限，显式 run 参数优先，0 取消上限，缺失时使用全局 task.maxRuntimeMs。结构化、in-process 与 workpool follow-up 统一解析。
- 工程原生配置重载合并完整策略，避免能力发现缓存或新建配置导致 task/retry 等组遗漏。
- stats parser worker 静默无响应时请求默认 60 秒到期，退出本轮并释放同步锁，后续同步可用新 worker 重试。stats.db 仍是按同步更新的派生库。
- 包装脚本的默认发行号复用 Core 中央发行号，避免遗漏 fork 后缀造成同版本不同字节。

## herdr 桥接是独立更新

[ompg-herdr-bridge](https://github.com/ethan-blue/ompg-herdr-bridge) 修复真正串行发送、完整匹配 ACK、错误响应误报健康、切换会话旧 context、延迟元数据覆盖与旧 reporter 退出后发送。

桥接提交：3a74e1885ed2005b8d8dbb3ba7c7083b52e58c83。Core ZIP 不自动替换用户扩展；请按桥接 README 单独更新、每个 pane 保留一个集成报告方，再重启对应 pane。没有对用户机器执行安装或卸载。

## 配置示例

工程 .ompg/config.yml，或 ompg config path 显示的用户设置文件：

```yaml
task:
  maxRuntimeMs: 600000
  agentRuntimeOverrides:
    worker: 1200000
```

worker 是示例，须替换为实际 agent 的精确名字。值必须为 0 至 2147483647 的整数；不会自动扩大所有 agent 的上限。现有 .omp 配置继续兼容。

## 升级与回退

退出运行中的 ompg，完整解压新版 ZIP，在解压目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

沿用原自定义 -InstallDir；新开终端 ompg --version 应为 ompg/18.10.2-gbk.2。
本版脚本也支持 -Download -Version 18.10.2-gbk.2；回退用 -Download -Version 18.10.2-gbk.1。
默认 %LOCALAPPDATA%\ompg 分版本安装，保留原版 omp、旧包与 ~/.ompg；同版本不同字节拒绝覆盖。ompg update 继续阻断官方替换。

## 验收边界

仅 Windows x64 AVX2，未签名预发布。GBK 推断仍只读；写入需要明确工程策略，GB18030 不支持，保护模式不是 OS 沙箱。

另一台机器的原始日志不可访问，用户允许缺证据项不改。真实 Gemini 400、41.425 秒 stall、stats 9:55 停更和 herdr GUI 闪烁未完成原机复现；本版不宣称这些现象全部根治。Unix、真实 E630/Keil、ConPTY 性能 A/B 与 Windows symlink 权限场景未验收。已跑门禁见 VALIDATION.md，详细范围见 docs/gbk-handoff/36。
