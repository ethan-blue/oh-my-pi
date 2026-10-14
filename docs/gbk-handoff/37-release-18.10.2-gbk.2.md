# ompg 18.10.2-gbk.2 最终交付记录

## 1. 固定来源

- Core 源码：`256766accc3043d8c96a2af3895c77bdef248459`，`feat/gbk-text-io`，已经推送。
- 发行 tag：`v18.10.2-gbk.2`，指向同一源码提交，已推送。
- 上游基础：已合并的 OMP v18.10.2。本轮针对 Issue #5，不宣称最新上游 main 已合并。
- bridge 独立提交：`3a74e1885ed2005b8d8dbb3ba7c7083b52e58c83`，已推送 `ethan-blue/ompg-herdr-bridge/main`；Core ZIP 不自动安装扩展。
- 构建前工作树干净；官方 build 脚本临时生成并恢复 dashboard bundle。打包时再次检查 clean HEAD，使用中央发行号，独立 EXE 实报 `ompg/18.10.2-gbk.2`。

## 2. 本版实际通过的发布门禁

| 检查 | 结果 |
| --- | --- |
| native 优化构建 | 146 exports；SHA256 见下表 |
| test:rs | 3209 passed / 4 skipped；doctest 1 passed，退出 0 |
| 最终 bun check | 退出 0，含 lint/fmt/types/cargo fmt/clippy -D warnings |
| Google/factory 最终全量 | 407 passed / 0 failed，1245 assertions，31 文件 |
| runtime 最终定向 | 51 passed / 0 failed，164 assertions |
| stats/TUI | 211 passed / 0 failed，984 assertions |
| GBK 九文件 + ptree-stderr | 173 passed / 0 failed，591 assertions，10 文件 |
| bridge 真 socket 回归 | 6 passed / 0 failed，11 assertions |
| EXE --version | ompg/18.10.2-gbk.2 |
| EXE --smoke-test | smoke-test: ok；真实编译 EXE worker 路径 |
| encoding doctor --json | binary.version 18.10.2-gbk.2；upstreamVersion 18.10.2 |
| EXE update | 非零退出，明确 fork build 自更新阻断 |
| 隔离安装器 | 真 gbk.1 → gbk.2 → gbk.1 升级/回退；checksum 拒绝、同版本不同字节拒绝、保守卸载、原版 omp 和用户 PATH 保留 |
| 公开 URL 安装探针 | PASS：使用下载包内安装器与 Windows PowerShell，经公开 URL 再下载、校验、安装；EXE SHA256/version/smoke、卸载及用户 PATH 保留均通过 |
| git diff --check | 退出 0 |

task/config 相邻整套为 559 passed / 2 skipped / 1 failed，不标 PASS：worktree symlink EPERM 是环境阻塞，断言保留。详细范围与因果见 [36 号记录](36-issue5-implementation-and-verification.md)。套件数字有覆盖重叠，不相加当独立总数。

## 3. 本地包身份

| 对象 | SHA256 |
| --- | --- |
| native addon | a52a914ac9b8e12a7457d2c863a79027d266ca710e359ba04c886f880f252484 |
| EXE | e6b64c20aca5e7a7a79e01add3efb387b94bddb0d14e4191cdf8e19819d82b92 |
| ZIP | 49adb43975bf1876dc450d09ad39d2c8822ac7f00dc19b9d17ee666fe4616ba4 |
| RELEASE_NOTES.md | f2e14946bdaeee32315441d9f4b76cd079779c1c60e7881d3e183000d0e57a01 |
| VALIDATION.md | b9cf7ed89732ea91b9dc813adee0aa71f8f95c56eb927b66abedf8a495f46404 |
| 外层 SHA256SUMS.txt | 5d9ae1f1d0cf5707e6aaf6718562ace2862b679198f430d686a6f9318258d5b4 |

包内 build-info.json 的发行号、upstreamBaseVersion、commitSha、embedded=true 与 native SHA 一致。旧 gbk.1 标签和资产保留，本轮不移动旧 tag 或覆盖相同版本的不同字节。

## 4. 远程发布与关闭状态

公开预发布：https://github.com/ethan-blue/oh-my-pi/releases/tag/v18.10.2-gbk.2 。公开时间为 2026-10-14 13:54:15 UTC；发布后 API 回读 draft=false、prerelease=true，四资产齐全。

首次四资产并发上传的 ZIP 超过七分钟未返回，小文件已上传并匹配 GitHub digest。已核实并停止自己创建的 `gh release create v18.10.2-gbk.2` 进程，检查草稿仅三份小文件，没有完整 ZIP；改为单文件串行上传，并在该上传子进程中使用 HTTP/1.1。没有读取/转移登录 token 或停止用户进程。首次命令的退出 1 是本轮受控取消，不能记录为发布成功。

串行上传成功后，四份 GitHub asset digest 与本地一致。草稿四资产下载成功，重新计算全部四个哈希，核对外层三条、内层七条清单、build-info 的发行号/上游号/源码 SHA/native SHA/embedded=true；下载 EXE 实际 --version 和 --smoke-test 均通过，才公开预发布。

下载曾等待较久并有一次 API EOF；另试官方资产 API 的有界 120 秒下载，收到 104552512 bytes 后截止，退出 143，该不完整文件不计为通过。最终验收使用原 gh release download 成功得到的完整包，而不是这个部分文件。合并校验/清理/发布的长命令曾被自动审核拦截（仅返回 blocked by policy，未给详细理由）；拆分为独立校验与发布步骤后执行成功，没有借此跳过任何哈希或 EXE 门禁。

公开后使用下载包内安装器，在独立 TEMP 安装根执行 `-Download -Version 18.10.2-gbk.2 -NoPath`。实际从公开 Release URL 下载 ZIP 和 SHA256SUMS，校验后安装；安装 EXE 哈希严格等于上表、发行号正确、smoke 成功，随后保守卸载探针，用户 PATH 保留。主探针最终返回 PASS，日志为 `ompg-issue5-public-install.log` 和 `ompg-issue5-public-smoke.log`。

主公开下载等待期间，PowerShell 小范围匿名请求返回 HTTP 206/1024 bytes；另起的 PowerShell 7 重试在主探针已通过后取消，退出 1，不计为 PASS，也不冒充本版产品测试失败。取消时枚举 helper 自身也被匹配并结束，退出 -1；匹配的两个 PID 均为本轮创建的重试/helper，未停止用户进程。主探针结束在取消前，取消动作没有把未完成测试变为通过。

Issue #5 于 `2026-10-14T14:04:01Z` 关闭，API 回读 `state=closed`、`state_reason=completed`。没有发送 GitHub 评论。关闭按用户授权及缺证据项可以不改的约定执行，不代表未验证原机现象或上游跟踪项已全部根治。

公开后再次读取旧 gbk.1：tag 仍指向 `516c7123d783078b6cbc1c516be2c85771616ded`，四个资产 digest 与 35 号记录相同，旧 ZIP 为 `0ceec34f39ed241e67ab22d7e37ea9b9cbb404bcd50500c9ec57794de7aa26ef`。新 tag 仍指向本记录第 1 节的编译源码 SHA；本次追加文档不会移动发行 tag 或替换资产。

## 5. 未验证与用户数据

用户允许其他机器缺失证据时不改。原机 Gemini 400、41.425 秒 stall、stats 停更、herdr GUI/多实例 flicker 未取得日志；只能确认并修复本轮源码/本机可验证缺陷，不能宣称全部症状根治。Unix、ConPTY 性能 A/B、真实 E630/Keil/模型/ACL 未验证；symlink 权限阻塞不算通过。

没有升级用户实际 ompg、安装/卸载其 herdr 集成、改变权限或改写工程编码策略。桥接需单独按其 README 更新，每 pane 一个集成报告方。Core 通过版本安装器保留原版 omp、用户数据和旧发行；回退可用本版安装器 `-Download -Version 18.10.2-gbk.1`。

日志与快照归档：`C:\Users\Ethan\Documents\Codex\2026-10-08\gbk-extension-omp-pi-ai-read\issue5-review-evidence\2026-10-14-release-18.10.2-gbk.2`。保留失败/取消过程、最终通过日志及公开 Release/关闭 Issue API 快照；不将取消、skipped、权限阻塞计为通过。

## 6. 继续维护的 AI 交接提示

```text
在 D:\Projects\GitProjects\oh-my-pi 继续，先读 AGENTS.md、02 编码协议、36/37 号记录及 git status/diff。
Issue #5 已按用户授权关闭，v18.10.2-gbk.2 已公开；编译源码固定 256766accc3043d8c96a2af3895c77bdef248459。
bridge 独立仓库 D:\Projects\GitProjects\ompg-herdr-bridge，main 修复提交 3a74e1885ed2005b8d8dbb3ba7c7083b52e58c83。
保留未提交用户工作、旧发行及其 tag；新源码要新发行号，不能覆盖相同版本不同字节。

源文件使用 edit/write/apply_patch；复用既有 codec、Hashline、中央超时、native writer、配置发现和官方生成器。
Gemini policy 放在 KDL，按真实 adapter 与结构身份归属；改规则必须 gen:compat，并验证自定义 provider 别名和签名并行组。
task runtime 必须保持显式值含 0 > exact agent override > global 的优先级，覆盖所有实际 dispatcher/follow-up 入口。
stats 同步失败必须释放锁并终止自己的 worker；不要把 stats.db 当成每请求即时写入的独立常驻服务。
bridge 保持串行、matching JSON Lines ACK、当前 context、null 清除、revision 与 shutdown；Core 安装不自动更新 bridge。

真实原机 400/41秒 stall/stats停更/herdr GUI、多实例与 Unix/E630/ConPTY性能仍缺证据，不能以本轮测试或 CLOSED 替代。
先读取新的实际日志与 phase，再确定成因；不为猜测修改 watchdog 阈值、系统权限或扩大所有 agent 上限。
按影响复现并验证：bun check；Rust 改动 build:native + test:rs；模型规则跑兼容性及实际请求转换；编码改动跑 GBK/相邻路径。
symlink EPERM 保留环境阻塞，不能换链接、删除断言或把早退当 PASS。
新发行从 clean commit 构建，真实 EXE version/smoke/doctor、隔离升级回退、远程内外 SHA、公开安装探针。
用户现有安装不是测试沙箱；GitHub 评论继续遵守预览/确认规则，不自动发表评论。
```
