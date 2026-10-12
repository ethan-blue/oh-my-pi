# Issue #4：设计者直接修复与验证

日期：2026-10-12。工作区：`D:\Projects\GitProjects\oh-my-pi`，分支 `feat/gbk-text-io`，起始 HEAD `4ba285313acfa630c29590a87e0d6476df39bed3`。

本轮授权是检查交付报告并直接修复剩余问题。31/32/33 号文档及原工作树修改均保留；没有 reset/restore、提交、推送、发布或操作 GitHub issue。本文件是 32 号报告之后的追加复核，旧报告的数字和产物哈希不能用于当前树验收。

## 1. 结论与复现依据

入口处复跑原 `gbk-issue4-config.test.ts`：29 passed、0 failed、67 assertions。这只能证明原 29 个用例成立。

随后新增五个消费者反例：64 KiB 截断 UTF-8、晚出现 GBK、子工程 replace 编辑、无根策略递归 grep、损坏子配置与 alias。实测 29 passed、5 failed。进一步复现 native AST 子工程解析失败、配置和源码混合批次被允许、auto 错拒仅 UTF-8 合法文件。

以上均通过原生工具或持久回归测试验证；配置权限用例仍属于故障注入，不是操作系统 ACL 验收。

## 2. 直接修复项

| 项 | 根因与触发 | 最终行为 | 主要文件 |
| --- | --- | --- | --- |
| D01 | 64 KiB probe 在 UTF-8 字符中间截断，错误选 GBK | 删除采样定编码；严格 UTF-8 扫描失败才重新扫描 GBK | `tools/read.ts` |
| D02 | 首窗双合法、后续 GBK 触发切换，之前返回的行仍按 UTF-8 解码 | 丢弃失败扫描的全部收集状态；decoder/行/预览/统计重新构建，不混用编码 | `tools/read.ts` |
| D03 | native edit/store 先接受父策略，子工程策略没有机会 | 文件读取、新建、patch 新建及 snapshot 统一使用更近的目标策略；错误传播或不记录快照 | `pi-edit/path_policy.rs`、`files.rs`、`store.rs`、`modes/patch.rs` |
| D04 | native grep 无根策略时直接退出发现 | 无策略搜索根也发现每个候选文件的工程；fixed UTF-8 不被自动 GBK 回退覆盖 | `pi-natives/encoding.rs`、`grep.rs` |
| D05 | 子配置读取/编译 `.ok()` 把错误当不存在，回退 alias/父配置 | 共用严格目录探测；只在真实缺失时回退；report 标记未搜索，fail 模式抛错 | `pi-edit/path_policy.rs`、`pi-natives/encoding.rs` |
| D06 | AST 解析、写出和 TS 快照/稳定性检查使用 cwd 策略 | AST 与 grep 复用调用级目录缓存；每个待写文件携带解析时的实际 codec，先验证全部输出再写；TS 检查和 Hashline 快照按目标策略 | `pi-natives/ast.rs`、`tools/ast-edit.ts` |
| D07 | 配置是目录/namespace 是文件，被认作缺失；Windows 可能返回 ENOENT | typed invalid；不回退旧文件。保护配置和 peer 非普通文件均 fail closed | `utils/project-config.ts`、`encoding/index.ts`、`tools/protected-mode.ts` |
| D08 | 只有 WriteTool 清理发现缓存，edit/LSP 创建新配置仍读旧结果 | 复用 filesystem mutation 失效模块，成功写/删/移动及权限回退后清理；LSP 直接文本写和资源操作同样处理 | `tools/fs-cache-invalidation.ts`、`file-write-fallback.ts`、`lsp/edits.ts` |
| D09 | 一批先改编码配置，再写源码，新旧规则可能混用 | edit/apply_patch 与 LSP 写前拒绝配置+源码混合批次；配置和源码均保持原字节 | `edit/index.ts`、`lsp/edits.ts` |
| D10 | MCP/skills 仍硬编码 `.omp`；仅有编码文件的新目录遮住旧提示文件 | MCP、SYSTEM/SYSTEM_TEMPLATE、RULES、AGENTS 按对应文件发现；skills 支持两命名空间；MCP 路径 API 与选择一致 | `discovery/builtin.ts`、`utils/dirs.ts` |
| D11 | 两套设置合并使 legacy 字段覆盖 preferred；保存模型角色仍写旧目录 | singleton 设置按文件整份选择，模型角色保存到当前选中的 config.yml | `discovery/builtin.ts`、`config/settings.ts` |
| D12 | auto 复用“已知 GBK 是否也合法 UTF-8”的诊断 helper，未验证 GBK | 写资格同时严格验证两个 codec；仅 UTF-8 合法文件正常写，真正双合法仍要求 override；保留旧诊断 helper 的接口语义 | `encoding/index.ts`、`pi-edit/encoding.rs`、`pi-natives/encoding.rs`、`ast.rs` |
| D13 | 独立 EXE doctor 的 binary.version 仍是上游基础号，与 --version 不一致 | version 输出 fork 发行号，upstreamVersion 单列基础号；增加持久断言并实际复核新 EXE | `cli/encoding-cli.ts` |

共享严格 codec、glob matcher、EditStore、Hashline 和 native staging 机制继续复用，没有新增字符映射表或脚本源码改写通道。

## 3. 回归与兼容口径

- Issue #4 持久套件从 29 增至 43 个：包括 native AST 真实落盘、AST 实际 resolve 队列、edit/LSP 新配置立刻生效、两类非文件配置、两种混合批次、auto 单合法写入。新增 Rust 双 codec 判定回归一项。
- 增加 native resource 发现、MCP preferred 整份优先、设置不混合和 `.ompg` 模型角色保存用例；config.yml/config.yaml 两种兼容文件名均实际验证。
- 原 AST 用例曾要求“父策略胜过子策略”，与本轮目标合同矛盾：改为子策略预览成功，再修改子策略，queued apply 必须重新验证并拒绝不稳定 GBK 字节，保留 pending action 和原字节。没有删除安全断言。
- 原 native grep “无策略”用例磁盘上其实有 encoding.json：现在明确移除该夹具策略后，继续要求 strict UTF-8 错误，不把省略参数误当没有配置。
- 扩大检查发现旧日志/插件测试仍硬编码原版用户根和日志前缀：使用 `APP_NAME` / `getPluginsDir`，保持原 project 隔离、插件命名和去重断言。
- Codex settings 测试 Windows 临时目录 EBUSY 来自测试存储句柄：cleanup 关闭测试构建的 Settings/AgentStorage，再 GC，未停止任何用户进程。

## 4. 最终门禁

| 检查 | 实测 | 口径 |
| --- | --- | --- |
| Issue #4 持久回归 | 43 passed，0 failed | 最终 GBK 套件内的真实消费者子集 |
| GBK 九文件 + ptree-stderr | 172 passed，0 failed，589 assertions，退出 0 | 10 个文件；实际包含 `packages/utils/test/ptree-stderr.test.ts` |
| 相邻读/搜/AST/编辑/写/LSP | 624 passed，37 skipped，0 failed，退出 0 | 68 文件，2319 assertions |
| 配置/发现/dirs 扩大检查 | 323 passed，7 skipped，6 failed，退出 1 | 40 文件，1078 assertions；六个失败均是 symlink 创建 EPERM，不能报整套 PASS |
| `CI=1 bun run test:rs` | 3063 passed，4 skipped，退出 0 | 34 个测试二进制；doctest 1 passed，未把 ignored 算通过 |
| `CI=1 bun check` | 退出 0 | 格式、lint、包 typecheck、Rust fmt/clippy `-D warnings` 均完成 |
| `bun run build:native` | 退出 0 | win32-x64-modern，143 ESM exports；保留构建中的既有 Windows linker warning |
| 独立 EXE 官方构建脚本 | 退出 0 | `bun packages/coding-agent/scripts/build-binary.ts` |
| 独立 EXE `--smoke-test` | `smoke-test: ok`，退出 0 | 真实 EXE worker/子进程探针，不是源码 smoke |
| 独立 EXE `encoding doctor ... --json` | 退出 0 | fork version `18.9.0-gbk.1`，upstreamVersion `18.9.0`，目标为实际 UTF-8 源文件；不冒充真实模型编辑 |
| `git diff --check` | 退出 0 | 无 whitespace error |

最终产物 SHA256：

- `D:\Projects\GitProjects\oh-my-pi\packages\natives\native\pi_natives.win32-x64-modern.node`：`54b3f913df44494e077fabce42d9f32de4970e937f34bc16dabbc8715bb52c73`。
- `D:\Projects\GitProjects\oh-my-pi\packages\coding-agent\dist\omp.exe`：`f795f67c867cf41eef0ec8b8cc27c0775be0c76b5b2c2e94c5fb160838214011`。

在最终源码与 native 固定之后重新构建并验证了 EXE，以上哈希替代 32 号及本轮中间产物的哈希。

证据日志保存在 `C:\Users\Ethan\Documents\Codex\2026-10-08\gbk-extension-omp-pi-ai-read\issue4-review-evidence\2026-10-12-direct-repair`。构建、Rust、check、GBK、相邻、配置套件分别单列；doctor JSON 单列。首次失败和中间重建已经在本文件记载，最终日志仅代表最终执行。

六项环境阻塞用例仍原样保留：

1. agent-plugins：escaping plugin.json symlink。
2. agent-plugins：escaping skill symlink。
3. agent-plugins：escaping mcp.json symlink。
4. agent-plugins：`--plugin-dir` escaping manifest。
5. builtin：noncanonical home symlink 边界。
6. claude-plugins：local/project canonical symlink 隔离。

它们均在创建链接时 EPERM，尚未执行到安全断言，不能据本机结果判定防护已通过。没有改变系统权限或规避测试。

## 5. 边界与使用说明

1. 当前支持的 GBK 编辑仍要求目标工程显式策略。无策略/auto 的 GBK 自动回退只供读取和搜索，不授权外部脚本或默认 UTF-8 覆盖。
2. 修改 `.ompg/encoding.json` / `.omp/encoding.json` 等项目策略，先单独提交一次工具调用；重新 read/grep 后再编辑源码。混合批次收到 `separate tool calls` 时按此拆分。
3. 大文件 UTF-8 路径通常一次扫描；GBK 回退可能先扫描到 UTF-8 错误再重新扫描。内存仍按原收集预算，不缓存全文件，不宣称性能“最优”或已跑 100 GB 基准。
4. Windows 特权 symlink 用例保留，不换 hardlink、删测试、放宽断言或修改系统权限。Unix 实机、真实 ACL、真实模型和 E630 工程验收仍不由本地窄测试代替。
5. 新独立 EXE 是本地候选，尚未提升 fork 版本号。不能把相同版本的不同字节覆盖到已发布 release ZIP；正式发布时必须另行提升版本并重新构建校验。

## 6. 后续 AI 交接提示词

```text
在 D:\Projects\GitProjects\oh-my-pi 的现有工作树继续。先读 AGENTS.md、02 协议、31/33/34 文档、git status/diff；保留所有未提交工作，不 reset/restore。

本轮设计者已直接修复 D01—D13，当前验收以 34 号记录为准，32 号数字与哈希是历史报告。不要恢复父 cwd 策略优先、64 KiB probe 定编码、吞配置错误或混合 policy/source 批次。

源文件增删改只用原生 edit/write/apply_patch，不用 bash Python/sed/perl 改源码；编译器和官方生成脚本可以运行。复用共享 codec/path discovery/EditStore，不复制映射表。

如需进一步修改，先复现消费者失败、补持久回归，再修根因；配置权限注入与真实 ACL 分开记录。不得删除 symlink 用例、以 hardlink 替代或用未执行来宣称通过。

Rust 改动使用 bun run build:native 生成 bindings，然后 CI=1 bun run test:rs 和 CI=1 bun check；GBK 九文件外还要跑 packages/utils/test/ptree-stderr.test.ts。涉及配置/资源时跑 config/discovery/dirs；报告实际 exit code、pass/skip/fail 与阻塞原因。

正式发行要收到当前用户的发行授权，提升 fork 版本号，重新构建独立 EXE，实际执行 --smoke-test 和 encoding doctor，校验 SHA256；不能拿源码 smoke 或旧发布 EXE 冒充。当前任务未授权提交、推送、发布、评论或关闭 issue。
```
