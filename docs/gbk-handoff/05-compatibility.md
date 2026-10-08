# 05 — P10—P11：与原版 OMP 共存、兼容和更新

## 1. 兼容目标

原版继续使用 `omp`；Fork 首版使用拟定命令 `ompg`。不要求用户卸载原版，不自动修改原版安装、不迁移真实会话、不写入官方 npm 包。

兼容包括 CLI、工具协议、Hashline、插件/SDK、数据格式、子进程、原生模块、安装器和更新器。只把 exe 重命名不能满足这些要求。

## P10｜分发身份、配置与运行时隔离（P0；依赖 P09）

**目标：**用户能明确区分两种程序，且两者同时运行不会加载彼此的 addon 或改坏彼此的数据。

**范围：**`packages/utils/src/dirs.ts`、`packages/coding-agent/src/cli.ts`、`src/task/omp-command.ts`、`src/task/executor.ts`、`packages/natives/native/loader-state.js`、构建身份模块（拟新增）。

**步骤：**

1. 定义 Fork 身份：distribution=`ethan-blue/oh-my-pi`、上游版本、Fork 版本、构建 SHA、native ABI/能力版本。集中维护，避免几十处硬编码替换。
2. 保留原有工具名、JSON schema、Hashline 协议、RPC 协议和内部 `@oh-my-pi/*` 导入；新增字段使用向后兼容方式。
3. 首次启动默认独立用户数据根，拟定 `~/.ompg`；源码定位仍读取工程 `.omp` 的原配置，Fork 编码策略放独立文件。
4. 区分全局配置根、agentDir、named profile、logs、daemon、cache、native cache。只设置 `PI_CODING_AGENT_DIR` 不足以隔离全部目录。
5. `loader-state.js` 默认 native 缓存为 `~/.omp/natives`，还可能独立于 named profile。Fork 必须在加载前使用独立 native 根/分发身份键，不能在 CLI import 完后才设置变量。
6. 利用现有 `PI_CONFIG_DIR`、`PI_CODING_AGENT_DIR`、`PI_NATIVES_DIR` 能力，但明确覆盖优先级；已有显式用户配置不能被无提示重写。
7. 可提供可选配置导入：预览可导入项目、只复制用户选择内容、备份目标、不删除源。真实密钥与会话不可进入测试 fixture 或公共产物。
8. `resolveOmpCommand()` 当前编译程序可能回落到 PATH 中的 `omp.cmd`。修复为可靠重入当前 Fork executable，并保留显式 `PI_SUBPROCESS_CMD` 合同；测试路径含空格及参数转义。

**验收：**同时启动两版；分别检查版本、配置写入、日志/缓存路径；child、worker 和 eval 重入本 Fork；错误 ABI 不静默加载；卸载 Fork 后原版仍可用。

**失败处理：**发现原版目录被写入，停止安装/迁移流程，依据预先记录的文件清单恢复，不能递归删除整个 `.omp`。

## P11｜安装器、更新器和版本兼容（P0；依赖 P10）

**目标：**用户安装和更新 Fork 时不会被替换成官方版本，也不会污染原版命令。

**范围：**`scripts/install.ps1`、`packages/coding-agent/src/cli/update-cli.ts`、`packages/natives/native/version-sentinel.js`、`scripts/stamp-native-version.ts`、Fork 安装/发布脚本（拟新增）。

**步骤：**

1. 审计更新器内写死的 `can1357/oh-my-pi`、官方 npm 包、Homebrew/mise 源；不能只替换 GitHub URL 后保留 npm 路径。
2. 优先增加小型分发策略边界与 Fork 专用安装器，复用校验/下载能力；避免对上游所有品牌字符串进行全局替换。
3. 初版只提供 GitHub 二进制分发；installer/update 必须验证仓库、channel、tag、资产名、架构、SHA-256 及下载后版本身份。
4. Fork 更新器尚未完成时必须明确禁用自更新并给出版本化手动安装方式；禁止回退到官方源作为“更新成功”。
5. 构建版本拟定 `18.8.4-gbk.1`；上游 baseVersion 单独记录。不能只改 Release 标题，程序仍报告纯 `18.8.4`。
6. native version stamp、packageVersion、embedded addon 元数据同步；审计只接受 x.y.z 的解析/缓存清理，避免 prerelease 被忽略或误删。
7. 默认安装目录拟定 `%LOCALAPPDATA%\ompg`，启动命令 `ompg.cmd`/`ompg.exe`；不创建覆盖原版的全局 `omp` alias。
8. Windows 正在运行的 exe/addon 不能直接覆写；采用版本目录与受控切换，更新失败保留旧版本。不能自动杀用户进程。
9. SDK/插件协议测试通过后才写兼容说明。新增 native 导出应有能力检查，对旧 addon 清晰失败，不能接受缺少 GBK 能力的“兼容加载”。

**验收：**离线、坏校验和、错误仓库、错误架构、下载中断、版本回退和文件占用均不会破坏旧安装；原版 `omp` 路径前后相同。

**失败处理：**保留可运行的版本目录和失败日志；恢复只涉及 Fork 自有文件。用户可以继续使用原版，不需要紧急重新安装。

## 2. 兼容矩阵（发布前逐项填写）

| 场景 | 必须观察的行为 | 初始状态 |
| --- | --- | --- |
| 不启用编码策略 | 原 UTF-8 read/edit/write 行为保持 | 未验证 |
| 原有项目 `.omp/config.yml` | 可读取；Fork 不加入原版不认识的编码字段 | 未验证 |
| 原扩展和技能 | 基本加载与工具调用成功；不承诺外部扩展直写 GBK | 未验证 |
| 原 SDK/RPC 调用方 | 旧调用能运行，新增参数可选，错误结构可处理 | 未验证 |
| 历史会话 | 在导入副本上可读取；不强制迁移原数据 | 未验证 |
| 原版与 Fork 并发 | 命令、账号状态、native 缓存及 daemon 无错误串用 | 未验证 |
| Fork 子 Agent | 当前 executable、策略和配置根一致 | 未验证 |
| 原版二进制仍在 PATH | Fork child 不误启动原版 | 未验证 |
| 覆盖用户 `PI_*` | 尊重明确输入或拒绝冲突，不偷偷改全局环境 | 未验证 |
| 关闭 GBK 功能 | 新会话恢复原行为，旧快照不能混用策略 | 未验证 |
| Fork 自更新 | 只使用个人 Fork；不支持时明确禁用 | 未验证 |
| 卸载/回滚 | 只处理 Fork 所有文件，原版可继续启动 | 未验证 |

## 3. 不该做的兼容工作

不要承诺旧版 OMP 能直接编辑 GBK，仅因为它能读取同一配置；不要把官方账号/插件生态全盘复制；不要为改名称而修改 provider 协议指纹或 User-Agent 行为；不要用分享真实凭据证明兼容。

若需要“用 Fork 完全替换 omp 命令”，先完成并存版本和回退验收，作为独立可选安装模式处理，默认不启用。
