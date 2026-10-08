# 04 — P05—P09：工具覆盖与外部写入边界

P04 通过只代表 Hashline 核心闭环，不代表整个 OMP 已支持 GBK。以下每一阶段都必须分别留证据。

## P05｜write、创建、移动与删除（P0；依赖 P04）

**目标：**覆盖绕开 Hashline 的普通文件变更，保留创建/覆盖的原有语义。

**范围：**`packages/coding-agent/src/tools/write.ts`、`src/edit/index.ts`、`src/lsp/writethrough.ts`、`src/tools/file-write-fallback.ts`。

**步骤：**

1. 覆盖已有 GBK 文件时复用原编码状态；新增文件按 project/override/newFileEncoding 选择。
2. 移动时带上源文件编码；只有目标保存成功并满足约定验证后才能删除源文件。
3. 保留 exclusive-create、不覆盖目标、目录与普通文件区别、symlink/junction 和权限语义。
4. 核对 fallback 接口携带的是哪种表示；若需要扩展字节能力，保持旧扩展调用合同，新增明确能力检测。
5. no-op 不重写，失败不删除源文件，不将 `ENOENT` 一律理解为允许创建。

**验收：**已存在、新建、ASCII→中文、移动到另一规则目录、目标已存在、写失败、权限拒绝均有实际磁盘测试。

**失败处理：**碰到编码策略冲突要报错，不为了移动成功悄悄升级编码；恢复材料保留真实 bytes。

## P06｜patch、多文件与自动修复（P0；依赖 P05）

**目标：**所有启用的编辑变体与 repair 路径遵守同一编码规则。

**范围：**`crates/pi-edit/src/modes/patch.rs`、`crates/pi-edit/src/session.rs`、`packages/coding-agent/src/edit/auto-repair.ts`、`src/edit/index.ts`。

**步骤：**

1. 核对当前版本 `apply_patch` 是工具别名、编辑模式还是 SDK 入口；按照实际注册覆盖，不强行添加同名工具。
2. 覆盖 patch 创建、修改、删除、rename；检查 restore/backup 是否仍是 UTF-8 String。
3. 预检批次中所有文件的解码、目标编码和输出可表示性，再进入写入阶段。
4. 故障注入第二个文件写失败，验证已写文件恢复和失败报告；明确不可恢复状态。
5. repair 读取经过统一边界，不能在首次失败后用原来的 UTF-8 fallback 再损坏文件。

**验收：**不同编码文件组成的批次成功；不可编码批次在写前拒绝；中途失败恢复原字节；默认 UTF-8 patch 用例继续通过。

**失败处理：**不允许跳过错误文件并整体返回成功；多文件恢复失败必须阻止后续自动应用。

## P07｜grep、AST 查询与 AST 编辑（P0；依赖 P03、P06）

**目标：**GBK 中文可搜索，结构化修改使用正确字符与偏移。

**范围：**`crates/pi-natives/src/grep.rs`、`src/ast.rs`、`packages/coding-agent/src/tools/grep.ts`、`src/tools/ast-edit.ts`。

**步骤：**

1. 追踪 native filesystem 到实际 read/write 的路径，包括本地文件与内部 URL provider。
2. GBK 文件严格解码后参与文本匹配；返回行号、上下文、快照和显示内容一致。
3. AST parser 接收解码后的文本；替换位置不得拿 UTF-8 偏移直接切 GBK bytes。
4. 保留 AST 预览/确认流程；preview 后文件变更必须被 apply 察觉。
5. AST 写入用相同编码保存入口，成功后的快照不能再次用 Bun.file().text() 当 UTF-8 读取。
6. 保留扫描忽略规则、文件上限、超大文件、取消和无效语法报告；不把所有搜索改为逐文件 JS callback。

**验收：**中文关键词/正则、中文路径、中文前后 AST 修改、混合编码目录和预览过期负例通过；搜索性能独立测量。

**失败处理：**源码包含中文导致语法异常时定位 decode/parser 两层，不将 GBK 源文件整体转成 UTF-8 作为补救。

## P08｜LSP、格式化和 ACP（P0；依赖 P07）

**目标：**代码智能不会在成功编辑后把文件改回 UTF-8。

**范围：**`packages/coding-agent/src/lsp/edits.ts`、`src/lsp/writethrough.ts`、`src/lsp/clients/`、`src/tools/acp-bridge.ts`。

**步骤：**

1. 对 LSP workspace edits、rename、create/delete、code actions 和 rollback 分别接入编码层。
2. 按实际协商的 position encoding 映射字符位置，验证中文附近的位置；保留服务器文档版本检查。
3. 支持返回文本的 formatter 时，在内存中处理 Unicode 后统一编码保存。
4. 对直接执行 `formatter --write` 的路径，若不能保证编码，则在受保护 GBK 文件上阻止该自动写入并提示可用方式；不放任先损坏再猜测修复。
5. ACP 未提供编码保留合同。初版对受保护 GBK 文件的客户端写入默认拒绝，除非有明确适配并完成保存后/延迟格式化测试；UTF-8 ACP 保持原行为。
6. 不绕过已有 ACP bridge 向磁盘偷偷写入，造成编辑器脏缓冲覆盖；阻止时清楚告知用户原因。

**验收：**真实或确定性测试 LSP workspace edit 成功；GBK 外部格式化/ACP 不支持路径在写前拒绝；UTF-8 路径回归通过。

**失败处理：**限制属于已知不支持，写进 Release 支持矩阵。不得同时宣称“完整 ACP GBK 支持”。

## P09｜Shell、eval、子 Agent 与新增工具（P0；依赖 P08）

**目标：**明确内置工具保证与任意外部程序的边界，保证 child 不丢失编码策略。

**范围：**`packages/coding-agent/src/task/executor.ts`、`src/task/omp-command.ts`、`src/exec/`、`src/eval/`、工具注册与扩展包装。

**步骤：**

1. 子 Agent 继承项目策略版本、项目 root、Fork 身份和受限写入策略；多 session 不共享错误的文件编码缓存。
2. eval 回调内置 read/edit/write 时走同一能力；直接 Python/JS 文件操作仍是外部路径，不能声称自动覆盖。
3. 提供实际可用的保护模式：受保护工程中可以关闭任意 shell/eval 执行，构建通过明确入口执行；若允许自由执行，清楚报告该范围不提供编码保证。
4. 不使用命令字符串黑名单来宣称拦截一切 Python/PowerShell 写入；不因本阶段要求转去实现虚拟文件系统。
5. 审计新增或 discoverable 工具、internal URL 写入、扩展 tool override；建立“支持 / 显式拒绝 / 用户负责”的矩阵。
6. 允许原有 GBK-aware 构建工具按其合同运行；不能把所有外部执行一刀切删除，破坏用户工作流。

**验收：**child 使用同一 Fork 和同一策略；策略禁用的入口在写前报错；允许的构建路径实际可用；启用任意外部写入时产品不做全局保护承诺。

**失败处理：**无法验证的外部工具标记未验证，保留可继续的内置路径；不得用提示词约定替代技术保证。
