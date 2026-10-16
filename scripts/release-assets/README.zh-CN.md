# ompg v18.11.1-gbk.1

基于 OMP v18.11.1 的 Windows x64（AVX2）GBK 支持分支，预发布。
命令 ompg、用户目录 ~/.ompg 与原版 omp 分开。

## 安装／升级
退出 ompg，完整解压后在本目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

默认安装到 %LOCALAPPDATA%\ompg\versions\18.11.1-gbk.1 并切换启动器。
自定义位置须加原来的 `-InstallDir "D:\Tools\ompg"`。
新开终端执行 `ompg --version`，预期 ompg/18.11.1-gbk.1。
旧版本保留；同版本不同字节拒绝覆盖。
回退使用本版脚本加 `-Download -Version 18.11.0-gbk.1`，沿用原安装目录。
-NoPath 可禁止修改用户 PATH；-Uninstall 保留用户会话数据及非安装文件。

## 编码设置
没有配置目录也可直接读取和搜索合法 GBK 源码：严格 UTF-8 失败时尝试严格 GBK，附只读回退提示；这不会授权覆盖文件。
需要编辑 GBK 工程时，先运行 `ompg encoding init --path "D:\Work\E630" --profile gbk-source`，或复制 encoding.example.json 到工程 .ompg\encoding.json，按实际编码调整 include/overrides。
运行 `ompg encoding doctor "D:\Work\E630\src\main.c" --json` 检查来源、有效模式和写资格。
.ompg 是新工程入口；旧 .omp 继续兼容。同 root 新文件整份优先，损坏、权限拒绝或类型错误不回退到旧配置。子工程和外部参考库按目标路径查找各自策略。
如果 tests/**/*.py 也是 GBK，需要将其加入规则；不能仅凭扩展名判断编码。
编码失败先修正规则，不用 Python/PowerShell 重写源码绕过原生工具。
支持 read、edit/Hashline、write、grep、AST、LSP 的 GBK 路径；
非法字节、不可表示字符、会正规化原 GBK 字节的写入会被拒绝。GB18030 不支持。

同时无法按 UTF-8/GBK 严格解码的文件明确报错。搜索默认继续其他文件并报告未搜索范围；全局 `textEncoding.invalidSearchFile: fail` 可恢复失败即中断。
全局 `textEncoding.readFallback: strict-utf8` 可禁用只读 GBK 回退；设置位置通过 `ompg config path` 查看，默认 ~/.ompg/agent/config.yml。
schemaVersion 2 的 auto 范围同时合法于 UTF-8/GBK 的非 ASCII 文件，写前要求明确 override；GBK 自动推断仍只读。不要用 shell 改写绕过原生工具。
编码/保护/项目设置配置与普通源码修改要分两次调用，混合批次会在写前拒绝。成功修改配置后立刻刷新发现缓存。
新 .py 的 coding 声明与目标编码冲突时写前拒绝。GBK 默认路径与 UTF-8 bytes 双合法时附范围明确的提示，需按真实工程配置 override。

## 命令输出编码

bash 的本地 shell／保护构建／PTY，以及 eval 的 Python shell helper PIPE／JS Buffer 输出支持可选 `outputEncoding: "gbk"` 或 `"utf8"`；缺省复用原生 UTF-8 优先 auto 模式。
完整捕获报告解码来源和替换次数，取消／未结束读取方报告 unknown。普通字符串不二次解码。
Python fd-1 单独显示 kernel-scope 输出，不把晚到字节归给下一请求；JS 持久 writer 未证明 EOF 时同样不虚报完整摘要。
Windows ConPTY 可能先转换终端输出，这个参数不能恢复系统转换前的原 bytes；ACP client-terminal 和服务日志是独立捕获路径。

## 可选保护模式
用户创建 UTF-8 文件 .ompg\protected-mode.json（旧 .omp 兼容）：

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

## 本版运行稳定性设置

本版修复 Gemini CCA 别名历史签名、Windows 后台终端输出、stats 静默 worker 和按 agent 运行上限。精确范围与未验证场景见 RELEASE_NOTES.md、VALIDATION.md。

可在工程 .ompg/config.yml 或 ompg config path 显示的用户设置中配置：

```yaml
task:
  maxRuntimeMs: 600000
  agentRuntimeOverrides:
    worker: 1200000
```

worker 须替换成实际 agent 的精确名字；0 取消上限。显式 run 参数优先于此覆盖，然后才使用全局上限。

herdr 桥接须单独从 https://github.com/ethan-blue/ompg-herdr-bridge 更新，Core ZIP 不自动替换扩展。每个 pane 仅一个集成报告方；真实 GUI 的全部闪烁原因尚未证明。


本版完整合并官方 v18.11.1，保留 GBK、Hashline 和 Issue #5 修复。维护规则要求每次修改完成后再次检查并合并最新正式版；发行打包会验证真实上游提交已在交付历史中。
桥接最新提交 1a5a3ff723ac545f6d3ee637894ea6559f3b0084，与官方 ExtensionUIContext.notify API 对齐。本机默认配置已单独部署桥接；其他机器仍需自行安装并重载对应会话。

## 本地记忆规则

启用 local memory 后，当前工程 learned.md 的完整规则在会话创建时直接进入系统提示词，不依赖模型先调用 read。历史摘要默认按需读取：memories.summaryInjectionTokenLimit 默认 0；正数可开启预载，既有显式设置保持有效。摘要预算不裁剪规则。缺失摘要返回“尚未生成”说明，不创建空文件或要求反复读取。减少常驻历史内容不代表每个任务总 token 都更低，需要历史时仍有读取成本。

为保持模型签名和提示缓存一致，活跃会话不会在每次 learn 后改写已发送的系统前缀；新规则保存在文件并在下一新会话自动采用。当前工具结果仍可见。禁用记忆或 SDK 显式覆盖 systemPrompt 的行为保持不变。大规则文件会占用实际上下文，请保留必要且明确的规则。
