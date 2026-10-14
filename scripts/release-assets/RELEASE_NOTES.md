# ompg v18.10.4-gbk.1（Windows x64 预发布）

完整合并 OMP 官方最新正式版 v18.10.4（检查时发布于 2026-10-13 19:38:04 UTC），上游提交 687892d1046ecaf18829b45f5b86928a308258f4。相较原 v18.10.2 基线，包含 205 个上游提交、308 个变更文件。保留原 GBK/Hashline/.ompg/.omp 兼容与 Issue #5 运行稳定性修复。

## 合并与维护

- 保留上游新版审批详情、终端渲染和 wall-time 提示阈值，同时保留 GBK 输出来源、ACP 写入保护和受保护 eval。
- Gemini adapter 别名签名规则、按 agent runtime 覆盖、stats worker 到期恢复与 Windows 后台 writer 保留。
- KDL 规则和 RPC SDK 通过官方生成器重新生成；冲突不使用整文件 ours/theirs 覆盖。
- 每次修改前后均检查最新正式版，合并准确 tag 并重新验证。AGENTS.md 已记录；打包器还会核对最新正式版和其真实提交的祖先关系，失败拒绝打包。不是仅改版本号。

## 桥接更新

桥接仓库：https://github.com/ethan-blue/ompg-herdr-bridge 。最新提交 1a5a3ff723ac545f6d3ee637894ea6559f3b0084，追加对齐官方 notify API，保留串行报告、完整 matching ACK、会话 context/revision 和 shutdown 修复。

本机默认路径 ~/.ompg/agent/extensions 已安装并验证文件哈希、实际发现路径；原 ~/.omp 的独立集成未修改。Core ZIP 不自动替换用户扩展，其他机器需按桥接 README 单独安装。现有会话重载或重启后启用；真实 herdr GUI 闪烁未重新验收。

## 安装、升级与回退

完整解压 ZIP，在解压目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

退出运行中的 ompg 后升级，沿用原自定义 -InstallDir；新开终端 ompg --version 应为 ompg/18.10.4-gbk.1。
本版安装器也支持 -Download -Version 18.10.4-gbk.1；回退使用 -Download -Version 18.10.2-gbk.2。
保留原版 omp、旧版本、~/.ompg 用户数据；同版本不同字节拒绝覆盖，ompg update 阻断官方替换。

按 agent 上限仍可通过 .ompg/config.yml 中 task.agentRuntimeOverrides 精确配置，0 取消上限。GBK 推断仍只读，编辑需要明确 encoding.json 策略。

## 验收边界

仅 Windows x64 AVX2，未签名预发布。门禁与未验证范围见 VALIDATION.md、docs/gbk-handoff/38。
原机 400/41 秒 stall/stats 停更/herdr GUI、多实例、Unix/E630/ConPTY 性能尚缺证据，不以合并或已关闭 issue 冒充全部症状根治。GB18030 不支持；工具保护不是 OS 沙箱。
