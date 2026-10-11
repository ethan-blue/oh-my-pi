# 发布后问题改进设计与另一 AI 执行任务

设计日期：2026-10-10。仓库：`D:\Projects\GitProjects\oh-my-pi`。基线：已公开预发布 `v18.8.7-gbk.1`，源码标签对应 `b68f4c9ce864762b509a4b924d39df65cd71f17a`；本轮开始 HEAD 为 `1a945e3cf1`。

## 1. 输入和职责

- [issue 1](https://github.com/ethan-blue/oh-my-pi/issues/1)：模型混淆 ompg 与 omp 数据目录。
- [issue 2](https://github.com/ethan-blue/oh-my-pi/issues/2)：扩展模型切换入参与即时状态语义。
- [issue 3](https://github.com/ethan-blue/oh-my-pi/issues/3)：G1—G6 编码边界问题。
- issue 是待验证的用户报告，不能将报告中的推测直接当成根因。会话中的历史代码损坏需要单独授权修复；本任务不修改用户 E630 文件。
- 设计者负责约束、复核与验收；实现 AI 分别负责 1/2 和 3。不得相互覆盖修改，不自行发布、评论、关闭 issue。

## 2. 优先级与实施顺序

1. G1：先消除新建与已有文件策略不一致，防止成功写入后变成不可读文件。
2. G2/G3/G6：统一严格解码、错误提示，阻止未覆盖文本通过替换符进入上下文。
3. issue 1：注入可信运行时身份，降低模型误读旧数据的风险。
4. issue 2：复用解析器，明确成功、失败和读取当前模型的语义。
5. G4/G5：明确歧义与外部程序边界，提供可验证行为，不承诺可靠自动猜编码。

## 3. 编码决策

### G1：策略范围一致，声明冲突写前拒绝

入口：`crates/pi-edit/src/encoding.rs` 的 `EncodingPolicy.resolve`，以及 `packages/coding-agent/src/encoding/index.ts`、`src/tools/write.ts`。

新建与已有文件均先检查策略 enabled、根目录和 include。仅覆盖范围内使用 override / defaultEncoding / newFileEncoding。未覆盖文件保持 UTF-8；不能让 newFileEncoding 越过 include。override 是否独立扩展范围必须明确，本次保持已有文件语义：override 不扩展 include。

Python 首两行的合法 coding 声明与目标编码冲突时，在任何磁盘修改或 ACP 路由前拒绝并提示修改声明或显式策略。无声明的 Python 3 文件默认 UTF-8，显式 GBK 场景需要兼容声明。复用统一校验，不在每个工具复制 parser。检查 edit/patch 等写入路径，未覆盖的路径必须记录为未解决，不能只修 write 就宣布全完成。

验收：不含 .py 的策略下新建中文 .py 得到 UTF-8，后续 read/grep/edit 一致；受管 .py 的冲突声明零写入；匹配 .c 保持 GBK；新建/覆盖、disabled、outside root、override 的 Rust/TS 结果一致；不存在文件失败后仍不存在，已有文件失败前后字节相等。

### G2/G3/G6：失败可诊断，不猜测、不输出解码损坏文本

入口：`src/encoding/index.ts`、`src/tools/read.ts`、`src/tools/grep.ts`、`crates/pi-natives/src/grep.rs` 及现有原生读取入口。

未受管文本严格 UTF-8；无效字节明确失败或跳过并报告文件/原因。搜索 content、files、count、context、单文件及递归模式均需核对，不能只改某一展示函数。合法文本中原本存在 U+FFFD 不等于解码出错，不应按字符扫描误报。`:raw` 不能成为忽略解码错误的文本逃生口。

错误提示区分无策略与策略未覆盖，并给出具体显式配置方向。不得自动生成策略、扫描整盘、把当前项目规则扩展到另一个项目，或自动重试 GBK/GB18030。显式编码只读功能可另行设计，不能同时偷偷改变写入语义。

验收：GBK 文件位于项目外、未 include、完全无策略三种情况下，read/raw/grep 不产生解码替换内容；UTF-8 文件仍正常；搜索错误不能被解释成“零命中”；文件字节不变。

大文件保留上游前缀搜索范围和内存上限；只验证实际搜索窗口。允许为窗口末尾补读最多一个字符的续字节，不能为编码验证全扫未搜索的巨大尾部。结果继续明确 oversized/部分搜索语义，不宣称整文件已验证。流式窗口末尾的完整合法字符不得因人工截断报错。

### G4：严格解码与编码歧义分开

GBK 非法字节严格拒绝。无 BOM 的一段字节可能同时合法于 UTF-8 和 GBK，甚至两者都能 round-trip；无法只靠“中文是否常见”确定原编码。不能用字符密度阈值自动改写或覆盖明确策略。

为无 BOM UTF-8 被宽泛规则纳入 GBK 的场景提供明确诊断策略和文档，允许显式 override。若本轮只有文档/测试而没有完整用户可见诊断，G4 保持未完成；不得把理论解释作为修复证据。

### G5：复用 stdout 解码器，区分工具捕获与用户代码

已有 `crates/pi-shell/src/output_decode.rs` 实现增量 UTF-8 和 Windows ACP fallback；先审计 bash、受保护 build、eval 是否共用或绕过。模型在 Python 内把 UTF-8 错误 decode 为 GBK 后，外层收到的已经是合法错误文本，不能可靠逆转。

支持可观察的编码来源/显式输出编码应复用现有模块，覆盖分块边界、stderr、截断、多字节和非中文 ACP。若本轮未实现此协议，则只交付审计与建议，G5 保持未完成。

## 4. 运行时身份与扩展 API

issue 1：通过静态 Markdown 模板与 Handlebars 注入 APP_NAME、DISTRIBUTION_VERSION 和实际目录 helper 的绝对路径；尊重 PI_CONFIG_DIR、PI_CODING_AGENT_DIR、profile/XDG（适用平台）。不得硬编码 ~/.ompg，不将项目 .omp 当用户数据根，不注入配置内容/密钥。默认、自定义提示和子 Agent 路径需核对。注入身份降低误判，不宣称保证模型永不访问旧目录。

issue 2：修改前复现。现有 runner 使用原型委托保留 model getter，`ctx.models.current()` 也调用实时 getter；引用注释本身不能证明 stale bug。setModel 若增加字符串支持，统一复用 resolveModelRoleValue 和既有模型注册表，保留 Model 对象兼容、false 返回与安全诊断。非法字符串/输入不能触发不明确的 getApiKey 行为。仅在证实有异步 pending 状态时才引入新 API。

实现复核发现具体缺口：`createCommandContext()` 使用对象展开，仍把 model getter 固定为旧值；最终改为在新建上下文上 Object.assign 命令方法，保留自身 getter；后续 custom-command 适配使用原型委托，避免再次展开快照。普通事件与注册命令都有调用级回归。

验收：同一 handler 中 await setModel 后读取 ctx.model/current 的实际状态；失败不改变原模型；对象/字符串/角色解析、无凭证、compact/runtime 入口兼容；日志不输出凭证。

## 5. 门禁和关闭条件

- 实现者先跑针对性行为回归；设计者检查 diff 后跑 `bun check`，Rust 变化使用 `bun run test:rs`，需要原生绑定的测试先重建 native。
- 不使用 Python/sed/perl 经 shell 改源码，不创建全新重复 I/O/解析器，不修改旧版发布资产内容，不运行全局 npm release 流程。
- 给出每项 PASS / FAIL / UNVERIFIED，明确使用新源码还是旧 native。不能拿旧发布版测试当作新代码验证。
- issue 1/2 分别满足全部验收且修复提交可访问后，才可按用户授权关闭；关闭不等于已有新的二进制发布。
- issue 3 为六项集合，只有部分完成时保持 OPEN；不得删除未完成项后关闭。评论内容须遵守 AGENTS.md 的单独确认规则，本轮不自动发表评论。
- 新二进制如发布，必须使用新版本号，重新构建、验包、下载验证；绝不原地替换 18.8.7-gbk.1 ZIP。

## 6. 可复制给另一 AI 的完整执行 Prompt

```text
你是 ompg 实现工程师，设计者已批准本文件的技术约束。工作目录 D:\Projects\GitProjects\oh-my-pi。先读 AGENTS.md、本文件、当前 git status/diff、GitHub issues 1/2/3 和 release v18.8.7-gbk.1；不得覆盖其他人的未提交修改。

先复现报告，再按第 2 节顺序实施你的分配范围。优先复用 encoding policy、strict codec、现有 model resolver、目录 helper 和 stdout decoder。源码编辑只用原生 edit/apply_patch/write；不经 shell 使用 Python/sed/perl 改源码。不能用自动猜编码取代明确策略，不能写后再回滚冒充写前防护。

逐项记录：根因、修改文件/入口、可观察行为变化、回归命令与实际结果、未覆盖路径。原生代码变化后先重建，再运行依赖 native 的测试。运行 bun check；Rust 用仓库 bun run test:rs。失败要分析并修复，不删除测试、不宣称旧结果通过。不要私自修改 E630 工程或用户安装。

完成后向设计者提交文件列表、测试结果和各 issue/G1—G6 的 PASS/FAIL/UNVERIFIED。你不负责提交、推送、发布、发表评论或关闭 issue；由设计者检查后执行。尤其 issue 3 只修部分必须保持开放。不要在没有真实模型/E630/Keil 输入时声称端到端验收。
```
