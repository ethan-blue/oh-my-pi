# Issue #5 修复与验收（2026-10-14）

## 1. 范围、授权与证据

跟踪项：https://github.com/ethan-blue/oh-my-pi/issues/5 。Core 基线为 `61c67713b8`，上游基线仍为已合并的 OMP v18.10.2；本轮不宣称已经追踪上游 main。新发行号为 `18.10.2-gbk.2`，旧 `gbk.1` 的标签和资产保留。

用户要求修复、关闭 issue，并补充：herdr 是“整体”闪烁，“新增或者切换以后才好”；另一台机器的日志“你排查一下，没有可以不改”。因此，能在当前源码和本机复现的缺陷进行修复；无法访问的原机日志和运行场景保留未验证，不能写成根因已经确认或全部现象已经消失。

当前 Codex 项目列表只有本地工程，没有可访问的远程项目；本机无 SSH Host 配置。没有找到原机 `~/ZCodeProject/oh-my-pi` 或 10 月 14 日诊断原始会话。没有迁移聊天、扫描认证文件、安装远程工具或修改另一台机器的配置。

## 2. 修复矩阵

| 跟踪项 | 已确认的缺陷与修复 | 证据边界 |
| --- | --- | --- |
| Gemini 400 循环 | 自定义 CCA provider 别名未继承 first-function-call bypass；KDL 改为按 google-gemini-cli adapter 继承。中断且首调用无有效签名的整组调用不再重放为 functionCall，配对结果保留为普通用户观察内容 | 请求转换、别名与并行调用回归通过；原机真实认证模型重放未验证 |
| Windows 终端阻塞 | Windows 原先禁用 native TtyWriter，阻塞写在 JS 线程。扩展现有线程、队列、pending、drain、dead、stop 机制到 Windows；不另写一个输出队列 | 原生真实管道与 NAPI 字节证明通过；41.425 秒 stall 的具体成因、ConPTY GUI 同机性能 A/B 未验证 |
| 子代理超时 | 全局上限不能按 agent 定制，部分入口提前注入全局值遮蔽覆盖。统一 exact-name 解析，并接入结构化、in-process、workpool follow-up 路径；修复原生工程策略重新加载遗漏 task/retry 等组 | 实际 ExecutorOptions、follow-up、配置重载回归通过；不修改用户的实际运行策略 |
| stats 停更 | 无消息、无错误事件的 worker 可永久占有同步锁。复用 withTimeout，60 秒默认请求期限；失败 finally 终止本轮 worker 并释放锁，后续同步可创建新 worker | 真 session 夹具：静默 worker 超时后下一轮实际入库通过；原机 9:55 停更根因未证实 |
| herdr 闪烁 | sendQueue 没有推进，实际并发；任意 data 当成功；切换后 activeCtx 旧值；异步元数据覆盖新会话；未知字段未清空；退出后旧发送仍可能重试 | 独立 bridge 仓库已修复，真实 socket/Windows named-pipe 6 用例通过；真实 herdr GUI、多实例相互覆盖未验证，仍要求每 pane 一个集成报告方 |

### 2.1 Gemini 所有权与历史保留

- `packages/catalog/src/compat/rules/classes/gemini.kdl`：first-call 签名规则归属 CCA adapter，覆盖自定义 provider 别名；移除 canonical provider 文件中的重复轴；官方 gen:compat 更新 rules.json。
- `packages/ai/src/providers/google-shared.ts`：仅对 aborted/error 且首调用签名无效的历史组移除工具调用；不修改磁盘会话。toolResult 转普通用户文本/图片，避免孤立 functionResponse，并保留已经发生的观察。
- 保留 completed 跨模型正常 replay 的 bypass；保留有真实首签名的并行调用组。CCA 后续并行调用无签名是既有 adapter 合同，不把它误判为坏历史。公开 Google adapter 的 every-call 规则保持原样。
- thinking fence 已有独立处理路径，本轮运行其现有回归，不重复实现另一套 fence 清洗器。未声称所有 provider 400 都能自动恢复。

### 2.2 Windows 输出与资源所有权

- `crates/pi-natives/src/tty_writer.rs`、`Cargo.toml`：DuplicateHandle 复制标准输出/错误句柄，worker File/OwnedHandle 负责关闭副本；原标准句柄不转移所有权。Windows console codepage 检查在 worker，普通管道保留原字节语义。
- 共用原有 16 KiB 写入分块、FIFO、pending、dead 与有界 stop；Windows 分块避开 UTF-8 字符边界。Unix 保留原非阻塞/poll 路径，并在线程创建失败时关闭自己的 dup。
- `packages/tui/src/terminal.ts`：真实 TTY 使用 writer，测试/headless guard 与构造失败回退保留。没有放宽 LoopWatchdog 的睡眠阈值，也没有把约 1M token 压缩移入新 worker。
- 四个 Windows Rust 回归覆盖满管道 enqueue 不阻塞、Unicode FIFO、broken-pipe dead、stop 超时与句柄释放、UTF-8 分块。实际 NAPI constructor 探针输出 220000 bytes，严格 UTF-8 与输入完全一致。
- 上游 #15689 的反馈也未能复现 41 秒 stall，低 CPU stall 不能仅凭时间靠近压缩就认定由压缩引起；原机 phase/decision 日志缺失，本轮不伪造结论。

### 2.3 运行上限配置

`packages/coding-agent/src/task/settings.ts` 注册并统一解析 `task.agentRuntimeOverrides`。优先级：显式 run 参数（包括 0）→ 精确 agent 名覆盖 → 全局 `task.maxRuntimeMs`。0 取消上限；覆盖值必须为 0 至 2147483647 的安全整数，非法值拒绝。

用户可以在工程 `.ompg/config.yml` 或 `ompg config path` 显示的用户设置文件内配置：

```yaml
task:
  maxRuntimeMs: 600000
  agentRuntimeOverrides:
    worker: 1200000
```

`worker` 是示例，必须替换为实际 agent 的精确名字；不是 provider 或模型名字。不会把全体 agent 的默认上限一律扩大。旧 `.omp` 兼容与 `.ompg` 文件优先级保持既有合同。

调用入口为 `task/structured-subagent.ts`、`executor.ts`、`index.ts`、`workpool.ts`。`config/settings.ts` 在能力发现后合并完整的原生工程策略，避免新建/重载配置只刷新 modelRoles 而丢失 task/retry。

### 2.4 stats 同步恢复

`packages/stats/src/aggregator.ts` 在 postMessage 失败时清理 dispatcher 状态；请求期限复用公共 withTimeout。`SyncOptions.workerTimeoutMs` 是 SDK 测试/嵌入参数，不是新增用户 config.yml 设置。默认 60000 ms，必须为 1 至 2147483647 的整数。

stats.db 是按命令/dashboard 同步的会话派生库，不是保证每次模型调用立即写入的常驻记账服务。本轮保障静默 worker 不会无限阻塞下一轮同步；没有证据证明原机一定发生过该缺陷。

测试用真实 10 ms seam 模拟静默 worker。初次尝试 Bun fakeTimers 未触发期限而导致测试挂起，已废弃；只停止了本轮自己创建并核实命令行的测试进程，未停止用户实例。最终回归不依赖 fakeTimers 或放宽断言。

### 2.5 bridge 独立交付

仓库：https://github.com/ethan-blue/ompg-herdr-bridge 。修复提交 `3a74e1885ed2005b8d8dbb3ba7c7083b52e58c83` 已推送 main。原报告中的未发布 `4d5fa91` 无法从公开仓库取得，本轮不冒充复用了该提交。

- 真正推进串行 Promise 链；完整 JSON Lines + matching id + result 才确认成功。
- error、错误 id、关闭、超时都走失败/重试；full resync 的 session/state/metadata 全部成功才算完整恢复。
- /new 和 session_switch 刷新 context、model、session manager 与 idle/working；未知 metadata 用 null 清除，revision 防止旧异步结果覆盖新会话。
- shutdown 取消在途连接与排队报告、停止 heartbeat/resync；不向旧 pane 发 idle/release 去清除新实例状态。UI 通知不再附带 console.log 污染 TUI。
- `HERDR_OMP_BRIDGE_DISPLAY_NAME=0` 按文档禁用 display override。
- 协议依据为 https://herdr.dev/docs/socket-api/ 。seq 拒绝旧值不能替代客户端串行与会话状态管理；未引入猜测的独占 lease 或随机 source。
- bridge 是独立扩展，Core ZIP 不会自动覆盖用户扩展。需要使用 bridge 仓库的安装器/手动复制并重启该 pane，先确认每个 pane 仅一个官方或社区报告方。

## 3. 已运行门禁

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| build:native | PASS，146 exports | win32-x64-modern optimized；既有 LNK4217 warning 保留 |
| native SHA256 | a52a914ac9b8e12a7457d2c863a79027d266ca710e359ba04c886f880f252484 | 构建后的实际 addon 字节 |
| test:rs | 3209 passed / 4 skipped，退出 0 | 34 binaries，含新增 4 个 Windows writer；doctest 1 passed |
| bun check | PASS，退出 0 | lint/fmt/所有 workspace types/cargo fmt/clippy -D warnings |
| KDL 编译/级联/分类/一致性与 Gemini 回归 | 83 passed / 0 failed，211 assertions | adapter 别名新增回归包含在内 |
| Google/factory 最终全量 | 407 passed / 0 failed，1245 assertions | 31 文件，包含本轮最新 adapter 规则 |
| task/config 相邻套件 | 559 passed / 2 skipped / 1 failed | 整套非 PASS；worktree detachGitDir 的 fs.symlink EPERM，ENVIRONMENT BLOCKED |
| runtime 定向最终回归 | 51 passed / 0 failed，164 assertions | 结构化与 workpool，实际 dispatch 优先级 |
| stats/TUI 相邻套件 | 211 passed / 0 failed，984 assertions | 34 文件，含串行 sync、静默 worker 恢复、LoopWatchdog/write-phase |
| GBK 九文件 + ptree-stderr | 173 passed / 0 failed，591 assertions | 实际 10 文件；保留 Issue #4 现有合同 |
| bridge 本地管道回归 | 6 passed / 0 failed，11 assertions | 分包 ACK、串行、error/wrong-id、new/switch、旧异步元数据、shutdown |
| git diff --check | PASS | 未删除/跳过 symlink 断言制造通过 |

Google/factory 全量最后一轮、最终发行 EXE、升级/回退与远程资产校验见发布验收文档；这些不能由本表的源代码/单元测试替代。各套件有覆盖重叠，不将数字相加当作独立用例总数。

## 4. 仍未验证与关闭口径

- 原机 Gemini 400 真实请求、41.425 秒 compaction stall、9:55 stats 停更、真实 herdr GUI/多进程闪烁，未取得原始日志；按用户“没有可以不改”保留。
- Unix 实机、真实 E630/Keil、原机 ACL/权限、完整 GUI 与性能 A/B 未验证。Windows symlink EPERM 不算 PASS，不修改系统权限或换 hardlink。
- 本 issue 可按用户授权关闭追踪，但 CLOSED 不代表上游 #15688/#15689 已关闭、全部运行现象已根治或每个环境已验收。新问题需用新日志复查。
- 不发送 GitHub 评论；项目 AGENTS 要求评论先获得文本确认。直接关闭 issue 已有用户授权。

## 5. 升级与回退

新 Core 包 `18.10.2-gbk.2` 使用原分版本安装器，原版 omp、`~/.ompg` 用户数据与旧包保留。手动解压后运行 install-ompg.ps1；原自定义 InstallDir 必须沿用。回退用本版脚本 `-Download -Version 18.10.2-gbk.1`。fork 的 `ompg update` 继续阻断官方替换。

不会在用户实际运行目录就地替换 EXE；测试全部在隔离临时安装目录。bridge 更新与 Core 更新分别执行。本轮未替用户重启 herdr/ompg、卸载原集成或修改工程编码策略。
