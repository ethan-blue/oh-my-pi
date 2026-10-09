# ompg 修复与复验记录（2026-10-09）

本轮是在 `feat/gbk-text-io`、基于 `815c7675bb` 的工作区修复；尚未提交、打标签或发布新 Release。历史 `18.8.4-gbk.1` 发布记录不能作为本轮修复已上线的证据。

## 1. 修复范围与复用

| 问题 | 本轮改动 | 复用的设施 |
| --- | --- | --- |
| Windows 安装脚本无法解析、卸载标记字段不一致、误删非安装文件 | 修正 PowerShell 插值/语法；兼容 repo/repository；按安装归属删除；拒绝危险根目录和重解析路径；同版本不同字节拒绝替换；校验先于运行 | 原有版本目录、启动器、SHA256SUMS |
| bash 切换 cwd 后绕过项目保护 | 同时检查会话项目与执行目录；真实路径检查防止目录链接逃出；受保护任务限制为本地前台执行 | 现有 BashTool 分派与错误展示 |
| 原生工具关闭保护配置 | write/edit/delete/LSP 与本地 AST 检查保护配置及相关目录；检查现有链接目标、同项目硬链接；编码规则文件仍可编辑 | 现有写入回退入口、LSP 编辑入口、AST 预览 |
| 命令检查后再次被 shell 解释、同名 exe 混淆 | 复用严格参数解析；按解析后的真实可执行文件匹配；直接 argv 执行；不加载 shell/direnv 或委派 ACP terminal | shell-tokenize、ptree、OutputSink、BashTool 结果格式 |
| LSP create/rename 后的 text edit 误报不可读 | 按已有操作计划顺序预演文件状态，预检查全部输出编码后再执行 | planDocumentChanges、applyTextEditsToString、原有资源操作 |
| 非规范 GBK 字节被静默正规化 | 共享严格 codec 做读回编码比较；不稳定则拒绝写；LSP 批次在首次写入前拒绝 | 原有 native decode/encode，未引入第二套编码库 |
| 单路径 AST 工具漏传编码策略 | 补齐策略传递；本地预览及应用前检查目标；添加实际工具预览→应用测试 | 原有 AST native binding 和 resolve 队列 |

ptree 新增可选输出回调，受保护构建的 stdout 不再整体保存在内存中；stderr 保留已有有界错误尾部。普通调用不传回调时保持原契约。

## 2. 已执行验证

| 检查 | 结果与范围 |
| --- | --- |
| `bun check` | 通过格式、lint、全部包类型检查；本轮无 Rust 修改，仓库入口按设计跳过 Rust 检查 |
| 11 个相关测试文件合跑 | **200 通过、18 跳过、0 失败，676 次断言**；跳过项是当前 Windows 不执行的平台用例，不计为通过 |
| Windows standalone 构建 | `bun packages/coding-agent/scripts/build-binary.ts` 成功 |
| 安装/升级/回退测试 | `scripts/test-install-ompg.ps1` 通过；两版模拟程序验证版本切换与保留旧版；第三份同版本异字节包被拒绝 |
| 校验失败恢复 | 错误 SHA256SUMS 被拒绝，活动版本字节不变 |
| 卸载保留 | 保留版本目录中的用户文件及不受管理的版本目录 |
| 真实二进制安装 | 对旧暂存版、当前本地构建分别在独立临时目录安装/卸载，核对安装后 exe 哈希 |
| 原版共存 | 用户 PATH 未变；原版 omp.exe SHA256 未变 |
| `git diff --check` | 通过 |

完整测试命令：

```powershell
$env:PATH = "$env:USERPROFILE\.bun\bin;" + $env:PATH
bun test packages/coding-agent/test/gbk-encoding.test.ts packages/coding-agent/test/gbk-validation.test.ts packages/coding-agent/test/gbk-search-ast.test.ts packages/coding-agent/test/gbk-lsp-recovery.test.ts packages/coding-agent/test/gbk-protected-mode.test.ts packages/coding-agent/test/tools/ast-edit.test.ts packages/coding-agent/test/tools/shell-tokenize.test.ts packages/coding-agent/test/tools/lsp-regressions.test.ts packages/utils/test/ptree-stderr.test.ts packages/utils/test/ptree-timeout.test.ts packages/utils/test/ptree-bytes.test.ts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-install-ompg.ps1 -ReleaseExe D:\Projects\GitProjects\oh-my-pi\packages\coding-agent\dist\omp.exe
```

LSP 既有同文件重命名测试原先在 Windows 创建目录 symlink 时遇到 EPERM；改为 Windows junction，仍检验别名指向同一文件的合同，未跳过该测试。

## 3. 本地构建与更新边界

- 本地构建：`packages/coding-agent/dist/omp.exe`。内部构建文件名沿用上游，运行显示 `ompg/18.8.4-gbk.1`。
- 当前源码版本号没有递增，因此它是本地验证产物，**不能用同一个公开版本号覆盖旧发布资产或现有安装**。
- 本地构建 SHA256：`5DA7065D4D810EAC70A647909757BB07363AE7073B7F4CC6F3D59F759778B53E`。
- 原版 `%LOCALAPPDATA%\omp\omp.exe` SHA256：`D4A946359D97B943E0DD09B1ED204FC4DDA4228178928E8237402E2C47F0EB69`。
- `ompg update --check` 仍返回 fork 禁用自更新的说明；本轮没有改成访问上游更新通道。
- 已验证的是安装协议和独立目录安装；尚未演练远端新 Release 的实际下载更新。发布下一版需分配新版本号，重新构建、生成匹配哈希和清单，再进行下载验收。
- 本轮未运行打包脚本：它要求干净工作区且会重建 release-staging。本轮保留现有暂存资产。

## 4. 不能扩大解释的结论

保护模式是 ompg 所检查工具入口的限制，不是 Windows 文件系统沙箱。用户批准的编译器、构建脚本/响应文件、扩展及独立进程仍可能自行写文件；不能将本轮测试写成“所有未来工具或所有子进程都无法绕过”。非本地 URL 后端保留自己的写入契约。

本轮没有修改 Rust native ABI，也没有重跑 Rust 全套。直接调用 native binding 的第三方扩展不等同于经过上述工具保护入口。外部并发修改与跨文件磁盘故障的全事务回滚仍不在本轮证明范围。

真实 E630、GCC/Keil 工程构建、真实模型失败恢复、跨平台安装、上游升级合并、同机上游性能 A/B 均未验证。已跑大 GBK 文件回归，不代表性能已经“最优”。

## 5. 后续 AI 接手提示

```text
在 D:\Projects\GitProjects\oh-my-pi 接续 ompg 工作。
先读 AGENTS.md、git status/diff、docs/gbk-handoff/12-repair-verification-2026-10-09.md。
保留当前未提交修复；复用 shell-tokenize、ptree、OutputSink、encoding codec 和 LSP 操作计划，不另建同类引擎。
源码修改只用原生编辑工具；若编码失败，修复已确认的 encoding.json 规则，不用 Python/PowerShell 文本写入绕过。
保持通过/失败/未验证分开；200 通过是源码回归，不是新 Release 或 E630 验收证明。
正式发布要使用新版本号，不能覆盖 18.8.4-gbk.1；先完成仓库规定的提交与发布前检查，再构建/打包/上传，并下载验收。
原版 omp 安装、用户 PATH、~/.omp 与用户会话数据必须保留；安装更新演练使用独立目录和 -NoPath。
不要宣称工具保护等于操作系统沙箱，也不要宣称未来上游升级零维护。
```
