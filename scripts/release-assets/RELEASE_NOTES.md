# ompg v18.11.1-gbk.1（Windows x64 预发布）

合并 OMP 官方稳定版 v18.11.1，上游提交 7cc912940b107eb2d771b0d106c640a8eddc9edf（2026-10-15T15:02:20Z）。保留 GBK、Hashline、.ompg/.omp、保护模式及 Issue #5 修复。

## 本版修复

- 本地记忆改为“必要规则直接生效、历史摘要按需读取”。默认不再预载最多约 5000 token 的历史摘要；已有显式 memories.summaryInjectionTokenLimit 设置继续有效，正数可开启预载。
- 压缩重复引导，只有摘要的工程仍保留读取入口；不增加规则筛选模型调用。规则仍占上下文，需要回顾历史时仍有读取开销，不保证每个任务总 token 更低。
- 合并上游读取行范围/末尾换行修复、eval JSON 显示去重、grep 路径筛选等稳定版改动，保留编码诊断和输出来源信息。

此前修复继续保留：

- #8：learned.md 完整规则直接进入会话系统提示词，不再被摘要挤出；关闭摘要注入仍保留规则。复用已有清洗、脱敏和项目隔离。
- #7：只有 learned.md、尚无固化摘要时，不再要求先读不存在的摘要；读取默认摘要返回正常 pending 说明，生成后立即可读，不创建伪文件。
- Windows 长路径：记忆固化、规则文件与摘要读取改用现有 node:fs，解决超过 260 字符时 Bun.write ENOENT 中断固化的问题。
- 上游配置发现安全边界兼容 .ompg 和 .omp；保留子项目优先、外部目标策略、无效首选配置拒绝回退。
- 用户自定义 agent 目录生效；task agent 同时识别 .ompg/.omp，并保持子工程优先与同根 .ompg 优先。

会话首个请求后的系统前缀保持冻结以兼容签名 thinking；新 learn 文件规则在下一会话采用。禁用 local memory、受限工具会话及 SDK 显式 systemPrompt 覆盖保持原语义。注入不等于保证真实模型每次遵循。

## 安装、升级与回退

完整解压 ZIP，运行 powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1。
退出运行中的 ompg 后升级，自定义安装继续使用原 -InstallDir；新开终端 ompg --version 应为 ompg/18.11.1-gbk.1。
也可使用安装器 -Download -Version 18.11.1-gbk.1；回退使用 -Download -Version 18.11.0-gbk.1。
原版 omp、旧版本、用户数据保留，同版本不同字节拒绝覆盖，ompg update 阻断官方版本替换。

## 桥接与边界

herdr 桥接由独立仓库 ethan-blue/ompg-herdr-bridge 管理，不由 Core ZIP 静默替换扩展。
仅 Windows x64 AVX2，未签名预发布。GB18030 不支持；工具保护不是 OS 沙箱。
验证数字见 VALIDATION.md；Windows symlink EPERM 单独记录。Unix、E630、真实模型遵循度与 herdr GUI 未验证。
