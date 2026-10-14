# 最新 OMP 合并与桥接安装（2026-10-14）

## 1. 用户要求与上游身份

用户要求更新本机桥接，并且每次修改完成后合并最新 OMP。这里的“最新版本”落实为官方最新非预发布、非草稿 Release；若要 main/nightly，必须另有明确要求。

本轮基线为 9f483edc71，已公开版本 18.10.2-gbk.2。查询官方最新 Release 得到 v18.10.4，published_at=2026-10-13T19:38:04Z；实际提交为 `687892d1046ecaf18829b45f5b86928a308258f4`。相较 v18.10.2 多 205 个提交、308 个变更文件。

## 2. 合并冲突与功能保留

| 冲突 | 处理 |
| --- | --- |
| pi-builtins/du.rs | 保留 Windows/Unix 各自正确的 mounts 声明，避免 Windows unused_mut；上游其他 du 改动保留 |
| catalog rules.json | 不手改、不选旧整文件，合并 KDL 后运行官方 gen:compat：1027 rules、21 classes |
| extension-ui-controller.ts | 保留 fork 的 runExtensionSetModel 编码策略与上游 ApprovalDialogComponent |
| task/settings.ts | 合并 isRecord 和 MAX_TIMER_DELAY_MS，保留 runtime overrides 与上游新配置 |
| bash.ts | 同时保留 GBK/mixed/unknown 来源报告，以及上游 wall-time 阈值及 detail 标记 |
| eval.ts | 同时保留 protectedEvalDenial 与新版审批详情截断，删除无用旧 import |
| write.ts | 同时保留 hasActiveWriteBridge 编码边界与新版 ApprovalDetailsOptions |

RPC schema 和四语言 SDK通过官方 gen:rpc 重新生成。没有 reset/restore 用户工作，未采用整文件 ours/theirs 丢弃另一侧实现。原 ompg GBK/Hashline、.ompg 优先/.omp 兼容、坏配置 fail closed、按 agent 上限、Windows writer、stats worker 期限保留。

## 3. 桥接实际安装

源码仓库 `D:\Projects\GitProjects\ompg-herdr-bridge`，最新提交 `1a5a3ff723ac545f6d3ee637894ea6559f3b0084` 已推送 main。核对最新 OMP SDK 后发现 notify 第二参数必须为 severity 字符串，改为复用 ExtensionUIContext 的 notify 类型并传入 info；没有猜测另一套 UI API。

通过仓库现有 install.ps1 部署到：

`C:\Users\Ethan\.ompg\agent\extensions\herdr-ompg-bridge.ts`

文件 SHA256：`ac7822bfb2334dfe599e92370b4e5a5e6838b6d90c4423fbabb1d78d4f1d067a`，与发布源码完全一致。该默认目录之前没有 extensions，已创建。原版 omp 的 `~/.omp/agent/extensions/herdr-omp-agent-state.ts` 是另一配置根；默认 ompg 实际发现列表不加载它，本轮未改动它。

运行 discoverExtensionPaths（includeAmbientHooks=false）得到唯一 herdr 路径即上述 .ompg 文件，没有两份报告方。桥接管道回归 6 passed / 0 failed、11 assertions。

现有 pane 重载扩展或重启后启用；未停止用户进程。默认 profile 安装/发现已证明，不代表另一台机器、非默认 profile 或真实 GUI flicker 已验收。

## 4. 今后每轮修改的强制流程

- AGENTS.md 已增加 ompg Fork Upstream Maintenance：修改前和完成后两次检查最新正式版，合并精确 tag，若发布前又有新正式版则重复合并与受影响门禁。
- 包装脚本复用中央发行号；通过 gh 的官方认证接口获取当前正式版及真实 commit，验证版本匹配且 commit 是 HEAD 祖先。未知、错误或未合并时拒绝打包，不冒充已经更新。
- build-info.json 新增 upstreamCommitSha/upstreamCheckedAt，记录实际核对证据；只改 package version 不能绕过。
- 新字节用新版本，本版为 18.10.4-gbk.1。旧标签与资产保留，不覆盖刚发布的 18.10.2-gbk.2。
- 这是当前工程内的维护与发布门禁，不是额外创建定时自动更新任务，也不自动合并未发布 main。

## 5. 合并后门禁

| 检查 | 结果 |
| --- | --- |
| 官方 native 优化构建 | 退出 0，146 exports；LNK4217 warning 保留 |
| native SHA256 | 8213931d68082632237a5de6afb28c57c72124607261d128025fb46e2e7800d5 |
| test:rs | 3210 passed / 4 skipped，退出 0，doctest 1 passed |
| bun check | 退出 0，lint/fmt/workspace types/cargo fmt/clippy -D warnings |
| 最终 native 下 GBK + ptree | 173 passed / 0 failed，591 assertions，10 文件 |
| task/stats/Gemini/KDL 定向 | 251 passed / 0 failed，1139 assertions，36 文件 |
| 审批/AST/ACP write/设置重载/bash render | 114 passed / 1 skipped / 0 failed，450 assertions |
| 桥接回归、安装字节与实际发现 | PASS；真实 GUI 未验证 |

首轮 GBK 调用误写 ptree 文件位置，实际只运行 9 文件/166 passed；纠正为 packages/utils/test/ptree-stderr.test.ts，并在最终 native 下运行上表 10 文件。首轮结果不冒充包含 ptree。所有套件数字有重叠，不能相加当独立总数。

Windows symlink EPERM 的历史环境阻塞不因本轮未重新运行而变为 PASS；Unix/真实 E630/Keil/模型/ConPTY 性能及原机症状未验证。

## 6. 发布交付

公开预发布：https://github.com/ethan-blue/oh-my-pi/releases/tag/v18.10.4-gbk.1 ，发布时间 `2026-10-14T14:31:54Z`（北京时间 22:31:54）。回读确认 draft=false、prerelease=true，四资产全部 uploaded。

编译源码与 tag 固定为 `7231750733c7e2f1240427ed82f9590754977bba`；上游 `687892d1046ecaf18829b45f5b86928a308258f4` 是其祖先。合并后工作树干净，官方 binary build、实际 version/smoke/encoding doctor、fork update 阻断通过。doctor 报发行 18.10.4-gbk.1、上游 18.10.4。

打包器实际通过最新版本/提交硬校验：build-info 的 upstreamCheckedAt=`2026-10-14T14:25:35.457Z`，upstreamCommitSha 与上游一致。公开前再次查询最新正式版仍为 v18.10.4，才发布；不是依据旧版本记录推断。使用浅克隆时须补齐上游历史，不能证明祖先关系会拒绝打包。

| 对象 | SHA256 |
| --- | --- |
| EXE | 9c107fbfb7191ec336eab274bc3d83e192513ee0c7110bafdb760fd856c88e62 |
| ZIP | f1c1bb6dc840ceb0de37f71595b67a82b947a9153b58eaf0372719f5c819cbe1 |
| RELEASE_NOTES.md | 639ddcedfd83591db7e23a3953a12eb11f023bc7e5fb0e6a5d349343a70e5646 |
| VALIDATION.md | a313b060209838e954b9c500e94c232689ad10a432878491638cdfbb54b2ff70 |

先建草稿上传三份小文件，再单文件上传 ZIP，使用上传子进程的 HTTP/1.1 设置；没有复制登录 token。核对四份 GitHub digest，草稿下载到新的 18.10.4-gbk.1-download-verify，重算四个实际哈希、外层三条和内层七条清单，确认源码/上游/native/embedded 身份；下载 EXE version/smoke 均通过后才公开。

隔离安装器以真 EXE 执行 18.10.2-gbk.2 → 18.10.4-gbk.1 → 18.10.2-gbk.2 升级/回退，checksum 拒绝、同版本不同字节拒绝、保守卸载、原版 omp 与用户 PATH 保留均通过。

公开后用下载包内安装器在独立 TEMP 目录执行 `-Download -Version 18.10.4-gbk.1 -NoPath`，实际公开下载、校验和安装。安装 EXE 哈希等于上表、版本正确、smoke 成功，随后保守卸载，用户 PATH 保留，主探针返回 PASS。期间小范围匿名请求另返回 HTTP 206/1024 bytes，该小范围响应不代替完整主探针验收。

本轮没有升级用户当前运行的 Core 安装或停止用户进程；本机桥接已部署，当前会话重载/重启后生效。其他机器或非默认 profile 需按实际 agentDir 另部署。旧 18.10.2-gbk.2 标签和发行资产保留，不覆盖旧字节。

最终文档提交不移动发行 tag；源码身份以 build-info 与本节固定 SHA 为准。证据目录：

`C:\Users\Ethan\Documents\Codex\2026-10-08\gbk-extension-omp-pi-ai-read\upstream-sync-evidence\2026-10-14-18.10.4`

## 7. 后续 AI 工作提示

```text
在 D:\Projects\GitProjects\oh-my-pi 工作，先读 AGENTS.md、02 编码协议、36/37/38 与 git status/diff。
最新已合并正式版 v18.10.4，上游 SHA 687892d1046ecaf18829b45f5b86928a308258f4；发行 tag v18.10.4-gbk.1 固定源码 7231750733c7e2f1240427ed82f9590754977bba。
每轮修改开始与完成后都检查官方最新正式 Release，合并精确 tag，证明真实 commit 为交付 HEAD 祖先；发布前再检查，有更新则重复合并和受影响门禁。
不能只改 package version，不能忽略 merge conflict 或整文件 ours/theirs 丢 GBK/ACP/Hashline/保护策略。generated 文件用官方生成器。
发行打包脚本已硬校验最新正式版与 commit；网络/浅克隆/历史不足导致无法证明时保留工作、解决阻塞，不能冒充已同步。
保留用户未提交工作、原版 omp、.ompg/.omp 优先级、坏配置 fail closed、编码与来源真实性、按 agent runtime 和 stats/writer 生命周期。
bridge 仓库 D:\Projects\GitProjects\ompg-herdr-bridge，最新提交 1a5a3ff723ac545f6d3ee637894ea6559f3b0084；默认安装 C:\Users\Ethan\.ompg\agent\extensions\herdr-ompg-bridge.ts。
先核对目标 agentDir、源码与安装哈希及真实 discovery，勿复制成两份报告方；notify 类型复用官方 API。Core ZIP 不自动部署 bridge，不主动停止用户 pane。
按修改影响跑 bun check、build:native/test:rs、GBK+真实 ptree 路径及相邻消费者；环境阻塞/skipped/未验证不得计 PASS。
当前 GUI、原机 41秒等日志、Unix/E630/ConPTY性能仍缺证据。不能以已关闭 issue、历史绿灯或这一轮 merge 代替实际证明。
新运行字节必须新版本，旧 tag/资产不可移动或覆盖。新包从 clean commit 构建并验证 EXE、隔离升级回退、远程 SHA 和公开安装。
GitHub 评论仍遵守 AGENTS 预览/确认规定，未授权不发。项目维护规则已持久化，无需另创建定时自动升级任务。
```
