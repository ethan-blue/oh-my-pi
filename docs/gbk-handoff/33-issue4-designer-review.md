# Issue 4 设计复核与返工要求

日期：2026-10-12。仓库：`D:\Projects\GitProjects\oh-my-pi`。评审对象：基于 `4ba285313acfa630c29590a87e0d6476df39bed3` 的未提交修改、31 号设计、32 号验收记录以及用户粘贴的交付报告。

结论：当前不通过完整验收。基础无配置 GBK 读取、部分配置优先级和 report 搜索已实现；保护配置错误分支、跨工程编辑、嵌套搜索、大文件解码、auto 写入资格和完整配置入口仍有可复现缺陷。先按本记录返工，不以“Phase A—H 完成”关闭 [Issue #4](https://github.com/ethan-blue/oh-my-pi/issues/4) 或发布候选。

## 1 本轮实测

| 项目 | 本轮结果 | 能证明的范围 |
| --- | --- | --- |
| `gbk-issue4-config.test.ts` | 17 passed、0 failed、46 assertions | 交付方的新套件能够重现通过，不能因此推定 G1—G10 全覆盖 |
| 评审补充合同集 | 0 passed、12 failed、17 assertions | 下列 12 个反例仍未满足对应合同；包含用于确认前提的正向对照 |
| `git diff --check` | 退出 0 | 现有 tracked 差异的空白检查，不是行为证明 |
| Issue #4 | GitHub 读回 OPEN | 本轮未评论或关闭 |
| 生产代码 | 未修改 | 保留交付方全部工作树实现；评审只新增记录和复现材料 |

复现包含实际磁盘 fixture、真实 ReadTool / GrepTool / EditTool / WriteTool / file mention / Settings 消费调用。EACCES 为受控故障注入；doctor 的 strict 设置为受控 Settings 注入；cache 用冻结时钟稳定复现；home 案例用模拟 home 和真实 Windows 大小写路径。不能把这些包装成真实 Keil 文件锁、真实用户 ACL、独立 EXE 或 Unix 证明。

日志：`%TEMP%/ompg-issue4-review-existing.log`、`%TEMP%/ompg-issue4-review-counterexamples.log`。复现源见同目录 [issue4-review-repro.test.ts](issue4-review-repro.test.ts)。临时运行文件已移回交接目录，不把预期失败集混入交付方的常规套件。

本轮未重跑全仓 Rust 和 bun check。交付报告中的历史通过数字可以保留，但不能替代新反例，更不能证明全部产品路径或发布产物一致。

## 2 必须先修复的缺陷

### RF01 P1 优先配置不可读时会放弃保护

位置：`packages/utils/src/project-config.ts:131`—`140`；`packages/coding-agent/src/tools/protected-mode.ts:151`—`157`。

`findProjectConfigUpward` 遇到 `.ompg` EACCES 后把路径加入数组并继续循环；只要 `.omp` 可读，就提前返回 found，根本不会返回 permission。protected-mode 的另一份配置冲突探测又把 stat 错误吞掉。组合后，新的保护文件无法 stat、旧配置 enabled=false 时，`protectedEvalDenial` 返回 undefined，错误分支允许了 eval。

复现 R3：两份真实配置分别 enabled=true/false，仅对优先文件 stat 注入 EACCES。预期 deny-all，实际无 denial。

修改要求：优先文件的权限或非缺失错误必须立即返回 typed error，不探测旧配置作为成功替代。另一份保护配置无法检查时也要 fail closed。区分 ENOENT、EACCES/EPERM、循环链接、错误类型；不要把所有异常当“没有文件”。保持编码的错误报告与保护的 deny-all 处置分别明确。

验收：preferred stat 不可读、preferred read 不可读、legacy 冲突探测不可读三个分支均不能解除保护；原普通缺失 fallback 仍可用。既有保护文件与目录 mutation 门禁继续通过。

### RF02 P1 auto 双合法文件仍被允许写入

位置：`packages/coding-agent/src/encoding/index.ts:487`—`511`；`crates/pi-natives/src/encoding.rs` 的 Auto 解码分支。

写资格只检查“当前 bytes 是否合法 UTF-8”。schema2 auto 的非 ASCII bytes 即使同时合法 GBK，也被允许覆盖；native Auto 分支还明确把歧义置为 false。31 号要求双合法 auto 保留歧义，并在写现有文件前取得明确策略，不能用有效 UTF-8 代替真实编码/写资格证明。

复现 R6：先证明 `// 中文\nint x = 1;` 的原 bytes 对两种 codec 都合法，然后通过真实 WriteTool 在 auto 策略下改为 2。工具没有拒绝，磁盘 bytes 的 49 已变为 50。这个证明是“未经明确策略仍改变了文件”，不声称该 UTF-8 fixture 已必然发生乱码。

修改要求：区分明确固定策略、auto、普通未管理 UTF-8 三种资格。auto 必须给出双合法状态与相应写限制；明确 override 或固定 GBK/UTF-8 策略可授权写。不能为了修 auto 把全部原版 UTF-8 写入都禁掉。probe 失败/缺失也不能无证据授权，只读推断的来源与资格必须进入同一 context。

验收：双合法 auto → write/replace/hashline/AST/LSP 均写前拒绝且 bytes 不变；加明确 override 后恢复编辑；纯 UTF-8 默认路径、ASCII 与新文件的明确规则仍正确。

### RF03 P1 跨工程 read 与编辑仍使用不同策略

位置：`packages/coding-agent/src/edit/index.ts:644`—`659`；`edit/store.ts`；`crates/pi-edit/src/store.rs`；`tools/ast-edit.ts:329`、`516`。

ReadTool 按目标路径解析，但 EditSession 的 encodingRoot / encodingJson 仍从 session.cwd 取得。EditStore 仍只有一个会话策略。AST preview/apply 也仍按 cwd 取策略。前置 eligibility 只证明目标可写，并没有让 native 编辑采用该目标的 codec。

复现 R1：当前工程 UTF-8，外部工程已有有效 GBK 策略。read 正确显示中文；同一会话随后 replace 编辑，native 返回“当前工程策略不覆盖此路径 / not valid UTF-8 / refusing to edit”。跨工程 read 的成功不等于跨工程 read→edit 成功。

修改要求：补齐 31 号的目标 context / policy registry，并接入 native 编辑、store 与 AST。快照和 apply 使用相同 codec、配置来源与 revision；不能靠多加一次 TS eligibility 检查解决。保留单会话 CUT/PUT 和 retention，不简单拆 store 或反复换策略清空全部历史。

验收：双 root 的 read→replace、read→hashline、AST preview→真实队列 apply、LSP workspace edit，均逐目标解码和保存。配置改变后拒绝旧 context；一个目标失败时批次在写前拒绝。

### RF04 P1 大文件动态换 decoder 会丢失跨块字符

位置：`packages/coding-agent/src/tools/read.ts:715`、`735`—`744`。

代码注释称首 chunk 确定 codec，但 utf8ProbeDecoder 会持续检查后续 chunk。失败时直接新建 GBK decoder，只喂当前 chunk，丢掉前一个 decoder 保存的尾字节；也没有重放此前原 bytes 或重解码已收集的非 ASCII 文本。这不是稳定的一次编码选择。

复现 R7：文件 >4 MiB，8192-byte 边界前最后一个字节为 GBK lead D6，下一块为 D0 CE C4 与换行。原始数据是合法 GBK，`:raw:1` 却抛 ERR_ENCODING_INVALID_ENCODED_DATA。

修改要求：保留原 bytes 和 carry，使用可证明一致的增量解码/有界探测流程，不能重置 decoder 后丢尾。ASCII 前缀可保持未决，但之前已经输出非 ASCII 的文本不能在后续隐式换编码后继续拼接；需要固定版本的重放/重新验证或明确拒绝。选中窗口、整文件和编辑快照的证据 scope 分开。复用既有严格 codec 与流式边界能力。

验收：边界前后 GBK 字符、UTF-8 字符、ASCII 长前缀后 GBK、尾部/多范围、EOF 残字节和取消，均得到正确文本或严格、位置准确的错误；不得产生 replacement、混合解码视图或未证明的整文件合法状态。

### RF05 P1 递归搜索没有发现目录内部策略

位置：`packages/coding-agent/src/tools/grep.ts:514`—`526`；`crates/pi-natives/src/encoding.rs::SearchEncoding`。

TS 只收集搜索入口路径和 cwd 上方的策略，Rust 只在这份静态列表中选 root。目录内部的 `.ompg` / `.omp` 或新的 `.git` 边界不会被发现。拥有更多单独入口 root 的数组，不等于递归文件拥有自己的 context。

复现 R2：父 root 为 UTF-8，child 有有效 GBK 策略，child/main.c 为合法 GBK。搜索父目录的“中文”，结果为零命中并把该文件列为不可解码。它本来可以由自己的策略正确搜索。

修改要求：walker 按目录发现/缓存目标工程 context，尊重嵌套配置、Git 边界与 disabled 屏蔽。也要审查 ast_grep、ast_edit、单文件和 glob 入口；不要每行回调 JS，不先 JS 全遍历再 native 全遍历。只加载真正涉及的 root，report 的配置错误应按受影响 root 记录，不能让无关 cwd 配置阻断有效外部目标。

验收：从父 root 搜索嵌套 GBK、嵌套 UTF-8、独立 Git 无策略工程以及混合 root；与对每个目标单独调用 read 的 codec 一致。仍保留正确 partial/strict、oversized 和分页行为。

## 3 配置与诊断返工

### RF06 P2 工程 .ompg 设置和资源入口尚未贯通

位置：`packages/utils/src/dirs.ts:41`；`discovery/helpers.ts:49`；`discovery/builtin.ts:882` 起；既有插件/扩展 discovery。

新的 project-config helper 只接到了编码与保护模式。原 PROJECT_CONFIG_DIR_NAME 仍为 `.omp`，native Settings/provider 与项目扩展/插件入口没有相应接入。

复现 R9：`.omp/config.yml` 的 strict-utf8 正向对照可以使真实 ReadTool 拒读 GBK；同内容移到 `.ompg/config.yml` 后仍自动显示中文。这与“`.ompg` 真正贯通”的交付结论不符。

修改要求：按 31 号 B 阶段接入现有目录/discovery/Settings 来源链。按对应文件 fallback，不因某个 `.ompg` 目录存在就屏蔽 `.omp` 的全部资源；singleton 与集合型资源分开沿用原规则。新建 canonical，编辑既有 source 保持来源；不能全仓字符串替换，不改变第三方目录和用户认证数据。

验收：真实 Settings.loadReadOnly、config CLI、同 root 新旧文件、project 插件 registry、extensions/skills/commands 的读取与写入口符合约定，不只测新 helper。

### RF07 P2 Windows home 边界仍有大小写泄漏

位置：`packages/utils/src/project-config.ts:61`—`80`。

boundaryKey 只把 drive 字母转大写，未统一其余 Windows 路径大小写；userDataRoot 又自己按 path.resolve 推导 PI_CONFIG_DIR，未复用实际 dirs/profile/XDG 解析。

复现 R13：把真实 fixture root 模拟为 home，经小写路径读 child/main.c，strict-utf8 下仍采用 home 的 GBK 策略并显示中文。相同字面 home 的测试通过不能证明 Windows 边界隔离。

修改要求：复用集中路径比较/realpath 能力；Windows 按平台语义处理大小写、verbatim 与 UNC，POSIX 保留大小写。实际用户目录边界从目录 API 注入/取得，避免第二份环境变量解释。新文件以已存在父目录的实际路径界定，符号链接不能绕过策略归属与权限。

验收：大小写 home 正向/负向、PI_CONFIG_DIR 相对/绝对、profile/XDG 实际 root、verbatim/UNC、Windows junction 与环境可用的 symlink。不能把 junction 通过写成 symlink 通过。

### RF08 P2 原生配置写入后缓存仍选旧 alias

位置：`packages/utils/src/project-config.ts:87`—`104`；`encoding/index.ts` 的缓存失效；原生 write 配置写入路径。

statEntries 把不存在的优先路径缓存一秒。已有 legacy 正缓存时，原生 WriteTool 创建了新的 `.ompg/encoding.json`，后续 read 仍在这秒内选 `.omp`；失效只接在 CLI init，不覆盖原生配置创建/修改。

复现 R4：冻结时钟，先确认旧 UTF-8 策略拒绝该 GBK 文件；通过真实 WriteTool 成功创建新 GBK 策略；立即 read 仍按旧策略报错。不是首次无策略 discovery 的负 TTL 案例。

修改要求：受控配置 mutation 统一失效所涉及的 discovery、policy、store context；apply 边界重新核对实际选中路径与内容 revision。外部 mutation 的缓存窗口要明确，但已成功的原生配置写入不能要求用户 sleep 或等 TTL。继续保留同 mtime / 同大小的内容比较。

验收：原生 write 创建 preferred、删除 preferred、同 mtime 内容/override 顺序改变、enabled 切换，以及随后 read→edit 的快照资格，均在下一次受控调用正确生效。

### RF09 P2 相同保护语义仅因排版不同而被 deny-all

位置：`packages/coding-agent/src/tools/protected-mode.ts:159`—`169`。

冲突判断是原始字符串相等。31 号定义的是语义冲突，不是空白/对象键序冲突。

复现 R12：单独的 compact 配置可允许已配置的 Bun --version 任务；加入语义相同的 pretty legacy 文件后，相同任务被拒绝。正向对照已证明配置 id、exe 和 args 有效。

修改要求：复用现有 parser 验证两份配置后比较规范化语义。仅排版/对象键序差异不算冲突；真实授权差异、不可读或非法配置仍 fail closed，不能简单弱化为“任一份允许就允许”。

验收：compact/pretty、对象键序、真实 enabled/task/args 差异和不可读配置分别覆盖。

### RF10 P2 解码来源和 BOM 规则在读取入口间不一致

位置：`utils/file-mentions.ts:317`—`354`；`tools/read.ts:2438`—`2442`、`2998` 起；`encoding/index.ts::decodeTextByMode`。

复现 R10：固定 GBK 策略遇 UTF-8 BOM，直接 ReadTool 正向对照正确拒绝；@file 却显示“锘縤nt x;”。file mention 直接调用固定 codec，跳过 BOM 策略冲突检查。

复现 R8：>4 MiB 的无配置 GBK 窗口成功显示中文，却没有自动 fallback / 只读来源通知。通知仅在 wholeFileBytes 存在时计算，stream 没有返回实际 codec 选择。

修改要求：共享解码决策包含 BOM、配置来源、实际 codec、证据 scope 与写资格；不要由每个端点另补字符串。覆盖普通/raw/@file/stream/tail/桥接及 RPC/TUI。auto 配置下的 fallback 应显示 auto 策略来源，不能说“没有配置”；JSON/协议配置、已解码远端字符串与真实二进制不无差别套源码 fallback。

验收：同 bytes 在直接 read 与 @file 的一致分类，BOM/非法序列/配置错误均可观察；stream fallback 有准确 window 通知和 typed 状态，不能暗示整文件 proof。补全有界失败样本的消费者输出，多个搜索目标聚合后仍有总体样本上限。

### RF11 P2 doctor 的 codec 与设置相矛盾，init 参数需校验

位置：`cli/encoding-cli.ts:118`—`138`、`156`、`232`—`276`。

doctor 在加载 Settings 前把 unmanaged effectiveCodec 写死为 utf8-then-gbk。复现 R11：受控 Settings 为 strict-utf8，JSON 同时报告 strict-utf8 和 utf8-then-gbk。doctor 不应成为另一套推断实现。

静态补充：doctor 使用上游 VERSION，缺少 fork 分发版本与实际入口身份；init 接受任意 profile 字符串，但总生成 GBK 模板；existsSync 后 Bun.write 也不能保证并发时“不覆盖已有策略”。

修改要求：doctor 复用实际 Settings + 目标 context，不先猜 codec；使用现有 runtime 身份能力。未知 profile 写前拒绝，目标类型/实际 root 检查明确；创建配置使用原有安全写入口或排他创建语义，不 truncate 竞态下新出现的配置。显示计划范围，不把所有 C/H 的 GBK 假设默默扩展到混合 vendor。

验收：strict/fallback/fixed/auto/missing/invalid/permission 分支的 CLI JSON 与真实工具一致；未知 profile 零落盘、已有/legacy/并发创建不覆盖，成功后缓存即时生效。源码 CLI 与独立 EXE 分别验证。

## 4 覆盖与交付口径

### RF12 P2 G1 至 G10 和 Phase H 不能标为完整通过

| 31 号门禁 | 当前结论 | 主要缺口 |
| --- | --- | --- |
| G1 无配置 | 部分通过 | 小文件案例通过，大文件 fallback/来源尚失败 |
| G2 配置兼容 | 部分通过 | encoding 基本优先级通过，Settings/权限/semantic conflict 未完整 |
| G3 跨工程 | 不通过 | read 成功后 edit 仍使用 cwd codec，嵌套 grep 不采用子策略 |
| G4 home与路径 | 不通过/部分未验证 | Windows 大小写反例；其余 alias/profile/Unix 矩阵未完整 |
| G5 内容边界 | 不通过 | 8 KiB carry、BOM入口、auto 双合法及来源 |
| G6 写资格 | 不通过 | auto 双合法现有 bytes 仍被覆盖 |
| G7 批量工具 | 未完整 | 非UTF8批次拒绝案例有效，但共同context、跨root AST/LSP等未证明 |
| G8 搜索coverage | 部分通过 | report零命中指引有效，嵌套策略与聚合诊断缺口 |
| G9 保护与消费 | 不通过 | EACCES分支解除保护；语义相同alias误禁构建 |
| G10 分发 | 未验证新版 | CLI helper/init幂等不是成品、升级回退和下载证明 |

实际成品核对：`packages/coding-agent/dist/omp.exe` SHA256 仍为旧发布的 `84176201c91343a7faf4ebe8a15660f61385d34cedc67a1c01aa69428660be71`，修改时间 2026-10-11；当前 native SHA256 是 `be99bdeaabdacec973bb438c63088a4bd9c56e190fbb4e9a9545b20cd01ee810`，修改时间 2026-10-12。旧 EXE 尚未包含 Issue #4 新实现。

`bun run ci:test:smoke` 在根 package.json 中运行源码 CLI，不能作为新独立 EXE 的 smoke。Rust测试与静态检查也不能单独证明发布成品与源码完全一致。并非要求在本轮评审发布，而是要把源码门禁、native、独立EXE、安装/回退和下载分别记录。

修改 32 号时保留首轮真实数据与违规记录，把全阶段完成结论改为实际覆盖；附本轮反例与返工记录，不删除失败历史。同机性能 A/B 仍缺证据，不宣称性能门禁已完成；只读文件/EACCES注入不能称为真实 Keil 进程占用锁的等价验收。

补充需要明确的语义：交付方在 02 号把 enabled=false 与无策略统一为全局 fallback。31 号要求 explicit disabled 屏蔽继承，但其是否同时禁全局只读 fallback 应在 ADR 中明确，并按决定补负向测试。本次不把这一语义选择计入上述已确认实现缺陷，也不能通过偷偷重写旧合同来消除其他反例。

## 5 依赖顺序与返工门禁

1. 先修 RF01 的权限 fail-closed 与 RF02 的 auto 写资格，阻止权限/资格失效。给真实读取 probe 不可用的分支明确拒绝状态。
2. 完成目录来源链与边界：RF06/RF07/RF08/RF09，复用已有 dirs、路径比较、parser、Settings/provider，不增加平行解释器。
3. 完成共同 context：RF03/RF05，同时把编辑/store/AST/LSP与目录walker接上。避免只修工具外观，native仍使用旧cwd策略。
4. 修 RF04/RF10：增量carry、只读推断和统一BOM/诊断，兼顾普通/raw/@file及实际读取窗口。
5. 修 RF11 CLI，使其消费同一决策；补并发/参数/错误分支。
6. 全部反例先进入正式消费者回归，再重建native、跑现有套件、CI=1 bun check与bun run test:rs，补性能和成品门禁，按RF12重写覆盖矩阵。

复现文件在 docs，被 Bun 配置排除。用当前客户端原生 edit/write/apply_patch 将它保存到 `packages/coding-agent/test/zz-issue4-review-repro.test.ts` 后运行：

```powershell
bun test packages/coding-agent/test/gbk-issue4-config.test.ts
bun test packages/coding-agent/test/zz-issue4-review-repro.test.ts
```

正式修复时将相应案例放入恰当的持久套件，保留前提对照，不固定随机TEMP路径，不以“某个错误发生了”代替预期失败根因，不把文件移进ignored目录来制造通过。EACCES、受控Settings与冻结时钟的证据标签保留；Windows专属case在其他平台应明确SKIPPED。

## 6 接手 AI 返工 prompt

```text
继续在 D:\Projects\GitProjects\oh-my-pi 修复 Issue #4。
先读 AGENTS.md、31号设计、32号首轮验收、33号设计复核，再检查git状态/diff。保留所有未提交实现、首轮验收与违规记录；不要reset/restore，不删除失败历史，不重复用Python/sed/perl经shell修改源码。

33号结论不通过。原17个case通过不代表Phase A—H完整；评审补充12个合同case目前均失败。先用原生编辑工具把docs/gbk-handoff/issue4-review-repro.test.ts放入临时test路径并复现；正向对照、EACCES/Settings注入、冻结时钟和Windows专属标签要保留。复制到正式回归时不要引入mock.module、source-grep或实现恒等断言。

依33号§5顺序返工：首先拒绝优先配置不可读时alias放行和auto双合法未经明确策略写入；然后完成.ompg的Settings/资源入口、Windows canonical/home边界、配置mutation缓存与保护semantic比较；接着按目标context贯通EditStore/EditSession/AST/LSP与递归walker；最后修流式carry、统一BOM/@file/来源诊断和doctor/init。

复用现有严格Rust codec、CompiledEncodingPolicy、目录/路径/parser、Settings、原生事务与Hashline/CUT/PUT。不要把read改好了而edit仍用cwd，不要让静态入口root数组冒充嵌套root发现，不要每个match回调JS，不复制第二份用户目录解释器。未知/不可读probe不授权写，auto与普通默认UTF8资格要区别，明确override后正常恢复编辑。

每项给根因、改动文件、真实消费者结果和未验证项。全部反例通过后重建native，CI=1 bun check、bun run test:rs及既有GBK/相邻套件，补新独立EXE、性能与安装升级回退门禁。32号按实际覆盖重写并保留返工历史；不得用源码ci:test:smoke冒充新EXE，不用静态检查宣称产物同源。

本次只授权评审/返工范围按当前用户指令执行，不自行发布、评论或关闭Issue。发布获授权后再核对最新正式上游、使用新的forktag、干净提交构建、草稿下载hash/build-info/version/smoke与公开Download验证，保留所有旧资产和原版omp。
```
