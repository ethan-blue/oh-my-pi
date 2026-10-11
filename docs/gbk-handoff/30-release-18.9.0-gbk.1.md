# v18.9.0-gbk.1 上游整合与发布

日期：2026-10-11。仓库：`ethan-blue/oh-my-pi`。

用户已明确授权关闭 #3、构建并发布新版、核对并合并最新 OMP。此次发布 Windows x64 AVX2 预发布，保留原版 omp 与旧 ompg 包。

## 1. Issue 与源码保存

前轮已验证的完整修复保存为 `f3c9052e83dbe58807769b1f1ea7a54baa77a8ae`，推送到 `feat/gbk-text-io`，远端 SHA 已读回一致。用户授权后通过 `gh issue close 3 --reason completed` 关闭 #3，没有额外评论；GitHub 读回 CLOSED，关闭时间 `2026-10-11T10:07:14Z`。

[29 号](29-pty-eval-direct-repair-verification.md)的未提交 / OPEN 状态描述的是关闭前的历史验收。原有范围限制继续有效；关闭缺陷不等于所有外部路径已获得完整编码识别或真实工程验收。

## 2. 上游选择与合并

官方 GitHub 最新正式 Release：`v18.9.0`，发布时间 `2026-10-11T08:08:01Z`。
标签指向 `eec114a9226da698ebc015fd8996a8ca3bc4625c`；本轮 fetch 时 upstream/main 是 `442a83c9e73562d5e311e07c800dc818dd365424`。按维护契约选择正式 release 标签，不发布未验收 main。

从保存后的功能分支建立 `integration/gbk-v18.9.0`，合并 v18.9.0。七处冲突逐项处理：

| 文件 | 决策 |
| --- | --- |
| `cli/ssh-cli.ts`、`modes/controllers/ssh-command-controller.ts` | 使用上游已解析的真实 userPath，保留 ompg 的目录解析，避免硬编码旧目录 |
| `modes/acp/acp-mode.ts`、`tools/browser/registry.ts` | 采用上游 getLogsDir()，继续显示实际 ompg 日志目录 |
| `cli/update-cli.ts` | 保留 FORK_DISTRIBUTION 与 CLI 更新阻断，采用上游新 build-service 接口，移除已不使用的旧 REPO 常量 |
| `test/update-cli.test.ts` | 保留 ompg 身份和拒绝 omp 版本串的断言，采用新版 prerelease 解析说明 |
| `eval/py/runner.py` | 同时保留 raw-output 协议和上游独立 _CONTROL_IN / fd-0 devnull 防护；Windows raw helper 响应窗口改读 _CONTROL_IN，不能继续读已被重定向的 sys.__stdin__ |

原 GBK codec / 策略 / Hashline / edit / LSP / AST 安全逻辑保留。上游 read 列截断范围、grep 长行匹配窗口、eval 有界 status event、legacy-Pi 同文件 mutation queue 等更新保留。新增 mutation queue 给扩展排队，不替代 built-in edit/write；legacy edit/write 工厂仍调用原生工具注册入口。

依赖使用 frozen lockfile 安装成功；RPC 源 schema/state 按 gen:rpc 重新生成 TS 与三个 SDK 文件。native 沿新版 host Cargo/N-API 构建流程，无需在 Windows 安装 Bazel。fetch 显示一个无效远端子仓库 ref 警告，但已取得目标 release 标签和 main；顶层没有待解决 gitlink，不能把该警告当成标签未取得或伪称整个 fetch 无警告。

## 3. 验证与分发

追加相邻回归发现实际缺陷：目录 grep 先严格解码 SQLite models.db，未等原有 NUL 二进制排除生效就报 invalid UTF-8。修复复用现有 bounded prefix codec，加入可选 binary-byte 分类；目录和显式文件也先按上游 NUL 规则排除。新增 2 个真实 native 消费测试覆盖 128 bytes 与 >4 MiB、目录 / 显式文件 / files-with-matches、无策略 / GBK 策略；无 NUL 非法文本继续拒绝。

上游更新器新测试残留 omp 身份，已调整为 ompg 的版本输出、exe、shim、回退消息，额外断言同目录原版 omp.cmd 保留。没有把真实原版文件改名或加入 fork 接管范围。

| 门禁 | 结果 |
| --- | --- |
| native | 优化构建成功，143 exports；SHA256 `f05f765e6c605f3d5e4aefc571df0f0e1c80340fe598d3bb7f3b42200ea5080b` |
| bun check | 退出 0，5986 文件 / 17 包 / fmt / clippy |
| Rust | 3061 passed、4 skipped；doctest 1 passed、18 ignored，退出 0 |
| GBK 等 15 文件 | 154 passed、3 skipped、0 failed、584 assertions |
| Python 3 文件 | 32 passed、4 skipped、0 failed、149 assertions |
| 文件工具相邻 10 文件 | 154 passed、11 skipped、0 failed、624 assertions |
| 身份 / 更新器等 11 文件 | 118 passed、6 skipped、7 failed、451 assertions；七项均 symlink EPERM，环境阻塞，退出 1 |
| 独立 EXE 候选 | 构建、version、smoke、fork update 阻断通过 |
| 安装候选 | 原版与用户 PATH 保留，安装 / 升级 / 回退 / 校验拒绝 / 保守卸载通过；真实 18.8.7 → 18.9.0 → 18.8.7 字节摘要一致 |

日志位于本机 `%TEMP%/ompg-18.9-{native,check,rust,gbk,python,files,adjacent}-final.log`，候选 EXE / 安装 / smoke 为 `cli-candidate` / `installer-candidate` / `smoke-candidate`。Rust test-only dead-code 和 native LNK4217 警告如实保留。没有重跑全仓 TS，不把 symlink 环境阻塞算作通过。

空白检查：fork 未暂存差异 `git diff --check` 通过；合并暂存差异仅有上游新增 SCSS.sublime-syntax 的 EOF 空行提示，保留上游文件。用 `git -c core.whitespace=-blank-at-eof diff --cached --check` 确认其余空白检查通过，不宣称未调整选项的完整暂存检查零提示。

发布资产已从干净、确切提交重新构建；最终发布 SHA、下载校验与公开结果见第 5 节，不用候选产物冒充提交后成品。

首次提交后成品重建、CI=1 全仓 check、smoke 与真实安装回退均成功。首次打包因 Bun 子进程加载 Archive 脚本模块受 execution policy 限制失败；直接 shell 的模块加载成功不代表 Bun child 相同。打包器复用 Compress-Archive，沿安装器做法仅给新 PowerShell 子进程加 `-ExecutionPolicy Bypass`，使用 LiteralPath 与正确的单引号转义，不改系统 policy。保留失败 staging 后从新提交重建，避免重用旧 build-info 或覆盖失败产物。

## 4. 持续边界

- #3 为已解决的源码缺陷；如有新反例，由新 issue 继续跟踪。
- 缺省未管理文件不自动猜 GBK，使用明确诊断与项目策略；GB18030 不承诺。
- Python kernel fd-1 无可靠单请求归属，JS 持久 writer 无请求 EOF 证据时保持 unknown；用户内部错误 decode 的字符串不可逆。
- Unix 实机、无 AVX2 CPU、真实模型 / E630 / Keil、NumPy / matplotlib 缺依赖分支与性能 A/B 不冒称已验证。
- 新包使用独立标签和资产，不覆盖 `v18.8.7-gbk.1`，安装器保留旧版本目录；原版 omp 与用户安装不被本轮验证替换。

## 5. 正式分发结果与回读

GitHub 于 `2026-10-11T10:34:16Z` 公开为 Windows x64 AVX2 预发布；读回 `isDraft=false`、`isPrerelease=true`，四项资产均 uploaded。未标成稳定 Latest，也未覆盖旧版资产。

- Release：[v18.9.0-gbk.1](https://github.com/ethan-blue/oh-my-pi/releases/tag/v18.9.0-gbk.1)。
- ZIP：[ompg-18.9.0-gbk.1-windows-x64.zip](https://github.com/ethan-blue/oh-my-pi/releases/download/v18.9.0-gbk.1/ompg-18.9.0-gbk.1-windows-x64.zip)，111465346 bytes。
- 发布源码 / tag 解引用 SHA：`288e14199e5f23433ef8280d5ff1e9e0ad07e6be`；包含合并提交 `c9e6dbb5526ab789231d7e0915a0fa1f96cd3ec5`，前轮完整修复和上游 v18.9.0 均为祖先。
- ZIP SHA256：`34cf42711fe641f5ae63e03a50f0c62ae10e3f0feecc6592aabd79bcd0566cd5`。
- EXE SHA256：`84176201c91343a7faf4ebe8a15660f61385d34cedc67a1c01aa69428660be71`。
- native SHA256：`f05f765e6c605f3d5e4aefc571df0f0e1c80340fe598d3bb7f3b42200ea5080b`。

上传后下载到新的 `release-staging/18.9.0-gbk.1-download-verify`。GitHub 四资产 digest 与本地一致；下载的外层三条资产清单与内层七条文件清单全部通过。build-info 的版本、源码 SHA、上游版本、native SHA 均严格核对；下载 EXE 输出 `ompg/18.9.0-gbk.1` 和 `smoke-test: ok`。

公开后另用下载的 installer 在全新 TEMP 安装目录执行 `-Download -Version 18.9.0-gbk.1 -NoPath`，实际从公开 URL 获取 ZIP / sums，校验、展开、安装成功；安装后的 EXE 版本与 SHA256 一致，用户 PATH 不变，最后保守卸载探针。日志 `%TEMP%/ompg-18.9-public-install.log`。这是公开分发路径证明，不是仅运行本地构建。

最终提交后的源码构建、`CI=1 bun check`、smoke、18.8.7 → 18.9.0 → 18.8.7 隔离安装回退及打包均退出 0。日志为 `cli-release` / `check-release` / `smoke-release` / `installer-release` / `package`。源码功能分支和 integration 分支已推送，release tag 读回一致；发布后仅追加文档，不移动 tag 或重传资产。

最后核查官方最新正式 Release 仍为 v18.9.0；#3 仍 CLOSED。旧 v18.8.7-gbk.1 仍公开并保留原资产。

## 6. 用户升级与后续维护

退出正在运行的 ompg，完整解压新版 ZIP，在解压目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ompg.ps1
```

自定义安装目录时沿用原 `-InstallDir`。新开终端 `ompg --version` 应为 `ompg/18.9.0-gbk.1`。回退使用本版脚本 `-Download -Version 18.8.7-gbk.1`，同样沿用安装目录；不要用 `ompg update` 切换官方版。

后续 AI 从 release tag 对照源码，先读取本记录与 02 协议、28/29 修复证明。保存当前工作后，只合并最新官方正式 release 标签；重点复查 TextFileIO / bounded prefix、legacy mutation queue、Python _CONTROL_IN、native loader、fork 身份 / 更新阻断等调用入口。复用既有 native codec、生成器、安装器与打包器；不使用 Python / shell 改写源码绕过文件编辑工具。门禁区分通过、跳过与环境阻塞，使用新的 GBK 版本标签，干净提交重建、草稿上传、下载校验后公开，保留旧版和原版 omp。
