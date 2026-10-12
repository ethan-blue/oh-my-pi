# Issue 4 配置发现与源码编码修改方案

日期：2026-10-12。接手仓库：`D:\Projects\GitProjects\oh-my-pi`。设计基线：功能分支 `feat/gbk-text-io` 的 `4ba285313acfa630c29590a87e0d6476df39bed3`；已发布程序源码 tag 为 `v18.9.0-gbk.1`，解引用提交 `288e14199e5f23433ef8280d5ff1e9e0ad07e6be`。

目标是让无工程编码配置的合法 GBK 源码能够被原生 read / grep 查阅，让 `.ompg` 配置真正贯通，并保留原始编码、Hashline、跨工程隔离和旧 `.omp` 兼容。核心方案继续采用 OMP Core 改造，复用已经实现的严格 Rust codec，不引入工程副本、虚拟盘或依赖 Agent 选择特殊扩展。

本文是待实施设计。本轮只完成问题核查、临时复现和方案；未修改生产代码，未关闭新 issue，未重新发布。下文的新设置和 CLI 命令均尚不存在。

## 1 问题与证据

问题：[Issue #4](https://github.com/ethan-blue/oh-my-pi/issues/4)。用户补充：出错工程没有编码配置目录。固件源码为 C89 / Keil 的 GBK / CP936 文件，问题报告中的路径为 `03_func/COMM/f_modbus.c`。

源码已经支持受明确策略管理的 GBK，并非所有 read / grep 都硬编码 UTF-8。实际缺口是默认策略、配置发现、目标工程选择以及搜索错误传播。bash 的进程输出 decoder 与磁盘文件 codec 是两套输入边界，不能把终端的 ACP 选择当作文件编码证明。

| 已核查事实 | 源码位置 | 影响 |
| --- | --- | --- |
| 用户数据目录是 `.ompg`，工程配置目录仍为 `.omp` | `packages/utils/src/dirs.ts`，CONFIG_DIR_NAME / PROJECT_CONFIG_DIR_NAME | 存在用户 `.ompg` 不代表工程 GBK 策略已启用 |
| 编码发现路径硬编码 `.omp/encoding.json` | `packages/coding-agent/src/encoding/index.ts` | 工程 `.ompg/encoding.json` 被忽略；无配置保持严格 UTF-8 |
| read / grep / AST 多处从 session.cwd 发现策略 | `tools/read.ts`、`tools/grep.ts`、`tools/ast-grep.ts`、`tools/ast-edit.ts` | 外部文件不能稳定获得自己工程的策略 |
| 部分写入与 LSP 按目标文件目录找策略 | `encoding/index.ts::resolveWriteEncoding`、`lsp/edits.ts` | 读取与写入可能采用不同策略来源 |
| EditStore 当前只持有一个 CompiledEncodingPolicy | `edit/store.ts`、`crates/pi-edit/src/store.rs` | 不能只修改 read 的解码，随后快照又回到 UTF-8 |
| 发现循环在检查 home 边界之前先读取配置 | `encoding/index.ts::discoverEncodingPolicy` | home 级旧 `.omp` 可能成为项目策略，违背既有注释与边界 |
| read 的恢复提示也会吞掉配置发现错误 | `tools/read.ts::encodingPolicyGapHint` | 特定错误路径可能退回旧的 `:raw` 建议，诊断应统一 |
| 二进制探测把非法 UTF-8 也计为 binary | `packages/utils/src/binary.ts` 与 `tools/read.ts` | 无配置 GBK 在进入 codec 前就可能被挡住 |
| @file 自动读取另走二进制判断与 Bun.file().text()，快照直接记录该字符串 | `utils/file-mentions.ts` | 仅修 ReadTool 仍无法让附件/文件提及正确显示 GBK |

临时 fixture 用独立 GBK 字节 `D6 D0 CE C4` 表示中文，调用真实 ReadTool / GrepTool。四项复现断言通过、10 assertions，含无配置、两种目录、外部工程与模拟 home 边界；日志 `%TEMP%/ompg-issue4-design-probe.log`。这些断言证明旧行为存在，不是四项修复已通过。临时测试已移除，不能把锁定旧故障的测试加入正式回归。

没有用户固件的真实 bytes，不能把 fixture 当作 E630 / Keil 工程验收。issue 引用的旧式短错误与当前恢复提示不完全一致，实施第一步仍须确认运行 EXE、hash、cwd、工具覆盖和是否复用了旧会话。

## 2 配置目录与兼容规则

### 2.1 用户目录继续隔离

默认用户数据根保持 `~/.ompg`，全局设置继续使用现有 Settings 的 `~/.ompg/agent/config.yml`。实际位置必须通过目录 API / `config path` 取得，支持现有 profile、PI_CONFIG_DIR、PI_CODING_AGENT_DIR、XDG 和配置覆盖，不在代码中拼接 home 路径。

不新建平行的全局 `~/.ompg/encoding.json` 去重复 Settings，也不迁移、扫描或复制原版 `.omp` 的认证与会话。全局提供读入行为默认值，不以一个 `defaultEncoding: gbk` 把所有磁盘文件都改成 GBK。

拟新增现有 Settings 注册项：

```yaml
textEncoding:
  readFallback: utf8-then-gbk
  invalidSearchFile: report
```

`readFallback` 枚举 `strict-utf8` / `utf8-then-gbk`。ompg 推荐默认后者，仅作用于工具已经路由为源码/普通文本的合适输入；结构化内部数据、配置协议文件、已转为字符串的内容、远端转换结果和真实二进制不套用该 fallback。默认不依赖 Windows ACP，GBK 文件在非中文 Windows 同样可被读取；复用现有 codec，不修改系统代码页。

`invalidSearchFile` 枚举 `report` / `fail`。report 保留其余结果并给出明确不完整状态；fail 维持严格遇错终止模式。

### 2.2 工程配置以 .ompg 为新入口

| 类别 | 新入口 | 旧兼容入口 |
| --- | --- | --- |
| 编码策略 | `<工程>/.ompg/encoding.json` | `<工程>/.omp/encoding.json` |
| native 工程设置 | `<工程>/.ompg/config.yml`，沿用现有文件名兼容表 | `<工程>/.omp/config.yml` / config.yaml / 现有 settings.json |
| 保护模式 | `<工程>/.ompg/protected-mode.json` | `<工程>/.omp/protected-mode.json` |
| 工程扩展、插件等资源 | 通过统一目录 resolver 暴露 `.ompg` | 原 `.omp` 继续作为兼容来源 |

实现集中在现有目录和 discovery 层，不全仓替换字符串。第三方 `.claude` / `.codex` / `.vscode` 等目录名称不变。

具体优先级：先找目标文件最近的工程边界，再在同一 root 内选择 `.ompg`，不存在对应配置才退到 `.omp`。嵌套工程的 `.omp` 优先于父工程的 `.ompg`。只存在新的配置目录，但该目录没有 encoding.json 时，仍可读同 root 的旧 encoding.json。

普通 singleton 配置同 root 两份同时存在时，新入口整份优先，doctor 列出被覆盖的旧路径；不能把两个 encoding.json 按字段拼起来，也不能把两份 overrides 拼成不可解释的顺序。新入口损坏、权限失败或类型错误时必须报该配置错误，不能偷偷选择旧配置。`enabled:false` 为显式关闭信号，不继续继承父策略。

集合型资源复用现有能力发现与去重规则，让 `.ompg` 的同标识资源优先；插件安装 registry 单一所有者，不并集两份安装状态。新建设置、安装工程插件等新入口使用 `.ompg`；编辑已经选中的旧配置继续写其真实 source，除非用户明确迁移。不能通过新建只含一个字段的配置悄悄遮掉旧配置的其余设置。

保护模式单列：新旧两份语义不同就 fail closed，报告冲突，不使用普通优先级静默放宽权限。只有编码目录迁移而未同步保护文件时也不能解除旧保护。新旧 protected-mode 路径、其父目录、realpath 与 hardlink 别名均纳入禁止 Agent 修改的保护；迁移需要用户执行明确的管理操作。

### 2.3 发现边界与缓存

目录 resolver 返回 `configPath`、`projectRoot`、`namespace`、`source`、`revision`，错误及 UI 显示真实选中的路径。诊断不再永远建议 `.omp`。

在尝试读取配置前排除用户 home 本身和实际用户数据根；使用规范化 Windows 大小写、verbatim / UNC 路径与 canonical path 做边界判断。遇到最近 `.git` 边界时停止隐式向更远父工程继承；没有 Git 的固件目录仍可通过最近显式工程配置界定。新文件由最近存在的父目录确定所属工程，不能自动扩大到兄弟工程。

修复 ENOENT 与 EACCES 混淆，权限错误不可作为“配置不存在”。显式未启用和缺失两种状态分别缓存。正缓存至少比较配置路径、内容和修订；新 namespace 出现、切换 root、同 mtime / 同大小变化、删除配置与显式禁用均要失效。负缓存保留有界 TTL，并提供原生 init 后立即失效的入口，不用 sleep 等缓存过期。

## 3 无配置读取与编码决策

### 3.1 复用同一严格 codec

| 输入 | 读取规则 | 后续写入规则 |
| --- | --- | --- |
| 明确 GBK 策略 | 严格 GBK，保留既有 BOM 冲突与 UTF-8 歧义提示 | 保留原 GBK bytes、换行与 round-trip 检查 |
| 明确 UTF-8 策略 | 严格 UTF-8，错误不得降为 GBK | 保留 UTF-8 / BOM |
| 无策略、合法 UTF-8 | 沿用原 UTF-8 快速路径 | 沿用原 UTF-8 写入合同 |
| 无策略、非法 UTF-8 但严格 GBK 合法，且为允许的文本输入 | 返回正确 GBK 文本，标记为自动 fallback 推断 | 此推断不独自授权 GBK 写入；先建立明确项目/路径策略 |
| 有策略但 include 未覆盖目标 | 可按全局只读 fallback 查阅，并指出具体缺失规则 | 不继承该项目 default/new 编码；写前仍需明确覆盖范围 |
| 两种 decoder 都失败 | 路径、字节 offset、实际 scope 与原生恢复步骤 | 不写任何字节 |
| NUL / 已识别二进制 / 内部结构化数据 | 保留既有专用读取或 binary 排除 | 不通过 GBK 降级变成可写源码 |

不能使用 replacement decoder、汉字比例、扩展名单独判编码，也不能因为系统 ACP=936 就断言某文件一定是 GBK。UTF-8 优先是选择规则，不是文件真实编码的证明。合法 GBK 与其他编码可能重叠；自动读取标签必须如实表达这种限制。

路径文件类型仅决定可否进入源码 fallback，不是 codec 证据。复用已有 read 文件路由、二进制 magic / NUL 规则和集中类型定义，不另写一套私有类型猜测器。`utils/binary.ts` 原 UTF-8 默认语义供其他调用者保留；新增明确的结构二进制分类能力，避免全局更改破坏图片、IDA、notebook、archive、PDF 等分流。

`:raw` 仅表示文本展示选择，不是字符集、不放宽严格校验，也不是任意 bytes 导出。普通读、raw、行选择、多范围、尾部选择必须采用同一个解码决策。

`@file` 自动读取也必须经过同一 context 和严格 codec，其 Hashline 快照不能再直接记录 UTF-8 replacement 字符串。speculation 的 binary gate / 证据采纳同样审计：仍需原文件版本和策略修订一致才能采用结果，不能仅改正式执行却留下推测路径拒绝 GBK。Git TUI 与 gh 等其他字节读取点列入调用链清单；能明确指向本地源码的路径接入共享 resolver，远端已解码内容保持原来源，不无差别套全局 fallback。

### 3.2 大文件与双合法内容

小文件使用已经取得的原 bytes，避免为 sniff / codec / snapshot 各读一遍。大文件先按有界窗口决定读取候选 codec，再以该 codec 持续严格增量解码；多字节跨 chunk 时继续复用非 final decoder。被读取尾段出现非法序列就报告实际 offset，不能中途换编码。

只读取窗口就只能给 window 证据，不能宣称整文件合法；建立可写快照前仍需完整严格验证和原 bytes / policy revision 检查。自动候选只供读取，不能通过一次前缀嗅探让编辑获得写权限。

新增 schemaVersion 2 时可允许 include 范围内 `defaultEncoding: auto`，自动混合读取优先 UTF-8、失败后严格 GBK；newFileEncoding 仍只允许 utf8 / gbk，不能是 auto。schemaVersion 1 的规则、first-match override 顺序、include 限定和 default/new 一致性保持原样。auto 是新 schema 的明确分支，不放宽所有旧规则。

auto 中双方合法且非 ASCII时返回 UTF-8 优先视图并标记 ambiguous，不作为无歧义编辑依据；写现有文件需明确 override 或明确的固定项目策略。纯 ASCII 不存在文本差异，但未来新增非 ASCII 的持久编码仍必须由明确的新文件/路径规则决定。已知 GBK 固件推荐固定 GBK 默认加 UTF-8 overrides，auto 更适合混合读取和待梳理参考目录。

## 4 目标文件上下文与快照

### 4.1 目标拥有自己的策略

每个磁盘目标按自己的路径和工程边界解析，不以当前 cwd 的 GBK 默认覆盖外部参考库。相对路径仍以 session.cwd 定位；权限审批仍使用原工具边界，编码 resolver 不额外授予读取或写入权限。

建立共享不可变 `ResolvedTextContext`：目标 canonical path、选中配置路径/root/revision、effective codec、selectionSource、evidenceScope、writeEligibility。同一次操作固定该 context；apply 时重新验证配置修订与原 bytes，变化后要求重读，而非应用旧字符串到新编码文件。

外部 UTF-8 母本按它自己的明确 UTF-8 或原默认 UTF-8 读取；外部 GBK 工程采用自己的策略。没有策略时仅适用相同的读取 fallback 规则，不继承当前工程的写编码。ACP 已解码字符串、LSP server 给定 Unicode、文档转换结果必须标明各自来源；不能对已知字符串再做一次 GBK decode。

### 4.2 统一 registry，不拆坏 EditStore

复用 `CompiledEncodingPolicy`，增加轻量的 context / policy registry，按目标 root 返回已编译策略与决策。其文件与 parser 语义由 Rust 共享，TS encoding/index.ts 作为工具接入门面；不是新增一套 JS glob / codec 实现。

一个工具调用持有一个 registry revision 视图。TS 已知显式目标通过该 registry 获取 context；Rust grep / AST 的目录 walker 通过同一 registry 按目录缓存发现嵌套策略，不能每一行/每个 match 回调 JS，也不先用 JS 完整遍历一遍再让 native 重遍历。配置变化只在调用边界/受控 apply 边界生效。

现有单 root N-API 参数保留兼容适配，旧调用无新参数时仍为严格 UTF-8。native 接口与 binding 按生成器更新，必要的 RPC wire 字段再跑 gen:rpc。

EditStore 保留一个会话级 store 和原 Hashline / CUT / PUT / retention 能力，不能简单按 root 分裂 store 导致跨文件操作失效，也不能反复切换单策略并清空所有快照。快照带目标 context / codec / policy revision / 写入资格；同 root 策略失效只影响相应快照。自动 GBK 的只读文本可用于定位/展示，编辑时不能因持有 Hashline 就绕过写入资格检查。

批量 LSP / AST / edit 为每个目标单独预检编码，再复用原事务与保存流程。一个文件不符合编码或写入条件时，在任何文件落盘前拒绝该批次。原字节校验、BOM、CRLF、no-op、取消、文件占用与恢复失败语义继续有效。

## 5 搜索继续执行但不能虚报完整

原生 grep 使用同一 context registry 和严格 decoder。先保留 NUL 二进制跳过，再进行编码决策；GBK 源码不因非法 UTF-8 被归为 binary。正常单文件、目录、oversized prefix、files-with-matches、count、流式 sink 与分页均采用同一规则。

report 模式下，单文件无法解码时收集 typed failure，继续其余合法文本；返回 `searchComplete:false`、`encodingFailureCount`、有界的 failure 样本和 scope 信息。失败样本上限建议 20 条，总数不截断；消息只带安全的路径、错误类别和 offset，不带整文件正文。

匹配结果数量只描述成功搜索的窗口。零命中且存在失败时，输出必须表示“已搜索文件中零命中，部分文件未搜索”，不能显示完全无结果或把未知总数当 0。分页、match budget、超时、取消和编码失败分别标明，不能合并成一个含糊的 skipped。原先 `limitReached` 等字段语义不被覆盖。

fail 模式仍遇编码错误终止，返回可操作的编码 ToolError。配置 JSON 损坏、权限失败等不是普通 GBK fallback 条件：相关 root 必须阻断；多 root report 搜索可返回其他 root 的结果，但要报告被阻断的 root，不能采用旧配置或假定 UTF-8 去搜索它。

AST grep 的可继续只读结果同样要标明 coverage；AST apply、LSP 写入和普通 edit 不采用“跳过坏文件后成功”的批量写入语义。read 不把解码失败包装为普通成功字符串，错误与 requires-policy 状态需要让 RPC / Agent 消费方可识别。

## 6 原生配置指引

拟新增 CLI `ompg encoding doctor [path] --json`，复用目录 API 和 registry，输出：实际程序身份/版本、cwd、目标 root、配置候选与选中路径、include 命中、override 来源、有效 codec、自动推断范围、写入资格、下一步原生命令。只输出编码相关设置，不 dump 全局配置或认证信息。

拟新增 `ompg encoding init --path <工程> --profile gbk-source`，向新的 `.ompg/encoding.json` 写 UTF-8 配置文本。复用现有严格配置验证和 native write；不扫描并转换源码。先展示/检查将覆盖的源文件范围；已有策略不覆盖，已有旧策略不默认替换，重跑保持幂等。成功后主动失效正负缓存并提示重新 read。

已知固件的示例策略：

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "include": ["03_func/**/*.c", "03_func/**/*.h"],
  "defaultEncoding": "gbk",
  "newFileEncoding": "gbk",
  "overrides": []
}
```

此示例只覆盖用户报告的源码目录；真实其他源码、测试、脚本需在工程确认后加入 include。实际 UTF-8 母本/供应商目录应设置明确 override，override 不独立扩大 include。Python 默认编码/coding cookie 的写前校验不变。

Agent 第一次自动读到 GBK 时应看到可操作的编码来源与写入指引。提示正文放入静态模板并复用 render，不在代码里拼接长 system prompt；新会话、恢复会话、子 Agent、ACP、RPC 和 SDK 都收到同一语义。编码配置可由原生 write 创建/修正；保护模式配置始终用户管理。

终端编码不并入文件默认值。bash / PTY / eval 的既有 outputEncoding 与来源报告保留；文件 GBK 策略不能使读取 UTF-8 母本的命令输出被再次按 GBK 转码。原生文件工具可读后，Agent 用 read / grep 查阅源码；构建输出按其原 bytes 解码。若用户脚本已产生错误解码的字符串，仍无法由 Core 恢复，不能以本修复承诺逆转。

## 7 按依赖实施的文件计划

| 阶段 | 主要文件 | 改动与完成条件 |
| --- | --- | --- |
| A 复现与协议 | `02-encoding-contract.md`、新增 issue4 合同回归 | 核实 EXE/hash/cwd；确认本设计对旧 strict-unmanaged 读合同的显式调整；记录无配置的真实消费者反例 |
| B 目录与保护 | `packages/utils/src/dirs.ts`、`discovery/helpers.ts`、`discovery/omp-plugins.ts`、`discovery/omp-extension-roots.ts`、`config/settings.ts`、`tools/protected-mode.ts` | `.ompg` 新入口与 `.omp` alias 集中发现；home/Git边界；新旧保护文件和目录别名受保护；该阶段不可拆成放开新目录后再补保护 |
| C context与codec | `encoding/index.ts`，拟新增 `encoding/settings.ts`；`config/all-settings.ts`；`crates/pi-edit/src/encoding.rs`，拟新增同域 registry 模块；`crates/pi-natives/src/edit.rs` | 注册全局设置；共享目标 context、严格 fallback、schema1兼容、schema2 auto只读分支；缓存内容修订可靠 |
| D read与snapshot | `tools/read.ts`、`utils/file-mentions.ts`、`speculation/host.ts`、`packages/utils/src/binary.ts`、`edit/store.ts`、`crates/pi-edit/src/store.rs`、`crates/pi-edit/src/engine.rs` | 分开 binary 与非法UTF8；只读fallback端到端；raw/stream/tail/@file统一；EditStore与Hashline context一致，编辑资格和revision前置校验 |
| E 搜索及批量工具 | `crates/pi-natives/src/grep.rs`、`crates/pi-natives/src/ast.rs`、`tools/grep.ts`、`tools/ast-grep.ts`、`tools/ast-edit.ts`、`tools/write.ts`、`lsp/edits.ts`、`lsp/utils.ts` | 单/多root、目录/窗口/模式统一；report/fail和partial消费；每个批量写目标先预检 |
| F 展示及协议 | `packages/tui/src/tools/read.ts`、`packages/tui/src/tools/grep.ts`、`modes/rpc/wire/`的omptype源定义、`scripts/gen-rpc/index.ts`、native binding生成器 | 机器可读诊断、coverage、来源；终端sanitize；schema.json本身是生成产物，只在实际协议新增字段时改源定义后gen:rpc同步四SDK，禁止手改生成文件 |
| G 原生管理入口 | `cli-commands.ts`、`cli/command-help.ts`，拟新增encoding CLI/command模块；已有config CLI/setting UI | doctor/init真实调用registry和write；不读取认证；创建后即时失效缓存；沿仓库command架构审查注册方式，不借新增命令引入额外动态import |
| H 验收与交付 | `test/gbk-*`、工具/LSP/AST/config/discovery测试、`scripts/release-assets/*`、本交接目录 | 原失败先复现再消失；原门禁无回退；性能A/B及下载升级证明；更新文档与执行prompt |

上述 engine 与 RPC 文件在动手时以当前 checkout 实际模块清单为准；扩展已有 helper 优先，不因表中“拟新增”而强行造新模块。B→C→D→E→F→G→H 是合并依赖，A 先于所有生产改动。不要仅修 read，再留下 snapshot / write / grep 回到另一套编码。

## 8 回归矩阵与发布门禁

| 门禁 | 必须证明的真实行为 |
| --- | --- |
| G1 无配置 | GBK f_modbus fixture普通read、@file与grep中文正确，不提示用shell恢复；严格开关仍拒绝GBK；合法UTF8保持原显示与字节 |
| G2 配置兼容 | 只有.ompg、只有.omp、两份并存、新配置损坏、enabled:false、嵌套root、cwd位于子目录均符合选中规则 |
| G3 跨工程 | 当前GBK→外部明确UTF8、当前UTF8→外部GBK、外部自己的override、无策略、不同root混合grep；不是只断言resolver返回值 |
| G4 home与路径 | home配置不泄漏；大小写/verbatim/UNC；symlink/junction/hardlink边界；无Git固件和嵌套Git；权限失败不当ENOENT |
| G5 内容边界 | 小文件/>4MiB/尾部/多范围/raw、split multibyte、截断scope、非法GBK、UTF8 BOM、双合法非ASCII、ASCII、NUL和SQLite都得到对应分类 |
| G6 可编辑性 | 自动GBK read后edit被明确阻止且bytes不变；native init明确策略后read→Hashline edit→read字节正确；policy同mtime同大小变化清除对应旧快照 |
| G7 批量写入 | write/LSP/AST共同context；混合root；一个目标失败整批写前拒绝；原CRLF/BOM/noop/Python声明/不可表示字符/取消保证不回退 |
| G8 搜索coverage | report找到合法文件并报告不可读文件；零命中不是完整无结果；fail拒绝；content/count/filesWithMatches、分页、budget、streaming均有持久消费者测试 |
| G9 保护与消费 | 新旧保护配置、目录rename/remove与别名不可被agent绕过；子Agent/ACP/RPC/sdk遵守同一状态；模拟协议与真实磁盘证明分别记录 |
| G10 分发 | 重建native和独立EXE；原生doctor/init；真实18.9.0-gbk.1→新版→旧版安装回退；原版/PATH保留；草稿下载hash/version/smoke后公开 |

只使用 `bun check` 和 `bun run test:rs`，不改成 tsc / cargo test。最终干净提交门禁设置 CI=1，避免Rust因工作树检测被跳过。native `bun run build:native`，binding/RPC使用既有生成器。现有GBK十五文件、Python三文件、文件工具十文件、identity/extension/updater相邻套件继续运行；新增回归以实际行为为准，不用source-grep和mock.module。

本机 symlink EPERM、Unix实机、真实模型、E630/Keil、无AVX2等未验证项继续如实记录。可以追加真正可运行的Windows junction测试，但不能用它替代symlink用例假称通过，也不能自动安装WSL或改系统权限。真实f_modbus验收须由用户工程或明确提供的副本运行，先校验原bytes，再确保测试不改源码。

性能沿用现有grep benchmark/runner、Bun计时和nativeprofile，同机比较旧版与候选：UTF8主路径、GBK大目录、混合root、配置缓存、>4MiB窗口、首次/热启动。记录扫描文件/bytes、墙钟、内存与decode次数；两版搜索覆盖范围要一致，不能用漏搜换速度。建议UTF8热路径中位数回退超过5%且超过噪声区间时先定位，不能直接宣称所有模块最优。不为此新增Rust→JS逐文件/逐行回调或全仓预读。

发布前再次核查最新官方正式release；如仍18.9.0，新fork候选可为18.9.0-gbk.2，未实施前不打tag。新issue保持OPEN至相应修复证据和用户所需交付完成；本轮未授权发布新的issue评论，先留本地审查材料。

## 9 失败与回退规则

先保存/隔离本轮工作，保留现有未提交修改，禁止reset/restore覆盖他人实现。不修改已发布tag/ZIP。已有 `.omp` 配置不自动删除，用户数据根不改名，原认证/会话不迁移。

未知或非法schema、配置冲突、codec错误都必须出现typed诊断。不得回退到旧策略制造成功，不得输出replacement文本进入快照，不得把partial搜索变成完整成功，不得绕过保护模式与原写入校验。

实施中若multi-context EditStore尚未准备好，暂时让新自动读取保持只读，不提前宣称可编辑。若跨目录策略或保护目录alias有回归，阻止候选发布，不能只在TUI隐藏错误。编码codec或native版本不匹配时阻止加载/打包；保留日志与失败staging。

## 10 接手 AI 执行 prompt

```text
你在 D:\Projects\GitProjects\oh-my-pi 修复 ethan-blue/oh-my-pi Issue #4。
先读取 AGENTS.md、docs/gbk-handoff/31-issue4-config-and-encoding-plan.md、02-encoding-contract.md、28/29/30验收记录，再检查当前git状态、分支和diff。用户已反馈出错工程没有编码配置目录；不要把创建encoding.json的建议当作完整修复。

先用真实ReadTool/GrepTool复现无配置GBK拒读/搜索中断、.ompg被忽略、外部工程策略未采用和home策略泄漏。确认实际EXE/path/hash/版本/cwd，区分原生工具、扩展覆盖及旧会话。fixture用独立预期GBK字节，不以生成器自身产生的bytes自证正确，不冒充真实E630工程。

按31号A→B→C→D→E→F→G→H顺序实施。用户~/.ompg和现有Settings位置保持；工程.ompg为新入口、.omp为兼容alias，具体优先级/冲突/保护例外按31号，不能全仓字符串替换。修复home边界、权限错误与同mtime缓存。保护新旧目录要和目录支持同批交付。

复用 Rust encoding_rs 严格codec、CompiledEncodingPolicy、现有binary/file路由、EditStore/Hashline/事务、Settings/CLI/生成器/安装器。共享按目标文件解析的context registry，保留单会话store和CUT/PUT。read/grep/AST/write/LSP/子Agent/ACP/RPC不能各自猜编码，目录搜索不能每个match调用JS。新全局fallback只读合法GBK源码；明确UTF8/GBK规则不能被fallback覆盖。旧schema1兼容，新schema2 auto语义按31号；自动推断不独自授权GBK写入。

先确保无配置read/grep可读；read/raw/stream/tail与native快照一致。新init/doctor通过原生API管理UTF8配置，不转换源码。grep report模式返回剩余结果和明确partial/失败数量/有界样本，fail模式仍可用；零命中不冒充全工程无结果。批量编辑任何预检失败都在写前拒绝，保留bytes/BOM/CRLF/roundtrip/Python声明/取消等现有保护。

源码和测试的修改只使用原生edit/write或当前客户端apply_patch，不使用bash中的Python/sed/perl重写。不要新增codec、替换字符降级、中文比例猜测或性能优化式漏搜。不要读取认证内容，不改系统权限，不自动安装WSL，不停止用户进程，不删/跳过失败用例造通过。不要mock.module、source-grep、any、ReturnType或手改生成文件。

完成31号G1—G10真实消费回归；原失败先复现后修复。按实际接口改源schema后运行生成器。重建native，CI=1 bun check、bun run test:rs及既有相关套件，区分pass/skipped/blocked/unverified。做同机UTF8/GBK/多root性能对照，不宣称所有模块最优。

每个阶段报告根因、文件、实测行为、未验证范围，更新交接记录。提交/发布遵从当前用户授权与AGENTS；本设计请求本身不授权新issue评论、关闭或发布。若后续获发布授权，核对最新官方正式release，再使用新forktag、干净提交重建、草稿上传、下载内外hash/build-info/version/smoke、旧版升级回退和公开Download安装验证。保留所有旧版资产和原版omp。
```
