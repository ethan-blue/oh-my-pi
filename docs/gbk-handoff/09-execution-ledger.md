# 09 — 执行台账与证据模板

本文件必须由接手 AI 随实现更新。初始状态来自 2026-10-08 的文档制作现场，不代表后续代码状态。

## 1. 当前状态

> 接手会话更新：2026-10-08（实施开始）。以下"当前状态"表为文档制作时初始快照；实施进展见 §2 阶段记录。

| 项目 | 状态 | 证据 / 限制 |
| --- | --- | --- |
| Fork 建立与远端配置 | 通过 | origin=ethan-blue，upstream=can1357 |
| 本地工作目录 | 通过 | `D:\Projects\GitProjects\oh-my-pi` |
| 基线与开发分支 | 通过 | `40e9368ef0458fd9073329cdff4174895f91bc6b`，`feat/gbk-text-io` |
| 源码入口审计 | 部分完成 | Rust 编辑/快照、TS 工具、native AST/grep、分发与更新已静态阅读；不是穷尽运行审计 |
| GBK 功能实现 | 未开始 | 无 GBK 产品代码变更 |
| 工具链准备 | 未验证完成 | 当前 PATH 未发现 Bun；Rustup 同步尝试被中止，没有记录完整构建成功 |
| 自动化行为测试 | 未运行 | 文档校验不等于产品测试 |
| 实际模型调用 | 未运行 | 不使用真实密钥证明文档正确 |
| E630 构建/运行 | 未验证 | 未提供、未检查实际工程与编译命令 |
| Windows 二进制 | 未构建 | 无 GBK 可执行产物 |
| GitHub Release | 未发布 | 接手执行阶段任务 |

## 2. 阶段进度

| 阶段 | 目标 | 前置 | 初始状态 |
| --- | --- | --- | --- |
| P00 | 现场与基线 | 无 | 通过（2026-10-08 复核） |
| P01 | 可运行工具链 | P00 | 通过（2026-10-08） |
| P02 | codec 与策略 | P01 | 通过（2026-10-08，Rust encoding.rs 20/20 单测） |
| P03 | read 与快照 | P02 | 通过（2026-10-08，E01/E10/E11 + 快照一致性 TS 测试） |
| P04 | Hashline 保存闭环 | P03 | 通过（2026-10-08，Rust 17/17 + TS E02/E05/E09） |
| P05 | write/create/move/delete | P04 | 通过（2026-10-08，write 覆盖/新建/移动 GBK 字节测试） |
| P06 | patch/repair/rollback | P05 | 进行中（引擎层已继承编码路径；修复路径待测） |
| P07 | grep/AST | P03、P06 | 未开始 |
| P08 | LSP/formatter/ACP | P07 | 未开始 |
| P09 | Shell/eval/child 边界 | P08 | 未开始 |
| P10 | 分发身份与数据隔离 | P09 | 未开始 |
| P11 | 安装更新兼容 | P10 | 未开始 |
| P12 | 功能与兼容验收 | P04—P11 | 未开始 |
| P13 | 性能对比 | P12 | 未开始 |
| P14 | 成品构建 | P10—P13 | 未开始 |
| P15 | 安装回退 | P14 | 未开始 |
| P16 | GitHub Release | P15 | 未开始 |
| P17 | 上游升级演练 | P16 | 未开始 |

### P00｜现场与基线 — 通过

```text
开始与结束时间：2026-10-08 上午 (+08:00)
开始 SHA / 结束 SHA：40e9368ef0458fd9073329cdff4174895f91bc6b / 同
工作区变更：无产品代码变更；未跟踪 docs/gbk-core-plan.md、docs/gbk-handoff/（交接文件，保留）
实现行为：只读复核
实际命令与目录：git status / git log --oneline -5 / git remote -v / git branch -a（D:\Projects\GitProjects\oh-my-pi）
退出码：全部 0
运行环境：Windows 10.0.26200 x64，Git Bash
通过：
  - 分支 feat/gbk-text-io，HEAD = 40e9368ef0，与交接基线一致
  - origin = https://github.com/ethan-blue/oh-my-pi.git，upstream = https://github.com/can1357/oh-my-pi.git
  - 工作树无已跟踪文件修改；仅有交接文档未跟踪
  - 原版 omp 安装基线：C:\Users\Ethan\AppData\Local\omp\omp.exe，版本 omp/18.2.11（where.exe omp 输出）；~/.omp 存在（agent/cache/logs/natives/run）
  - gh CLI 2.96.0 已登录 ethan-blue（auth status: Active account: true）
不通过：无
未验证：原版 omp 完整功能（仅记录命令路径与版本，按 P00 范围）
风险与恢复：无
下一阶段及未满足前置：P01（无阻塞）
```

### P01｜可运行开发环境 — 通过

```text
开始与结束时间：2026-10-08 上午—中午 (+08:00)
开始 SHA / 结束 SHA：40e9368ef0 / 40e9368ef0（无提交）
工作区变更：无已跟踪文件修改（bun install 后置脚本重新生成 tool-views.generated.js 但内容未变）
实现行为：工具链安装 + 源码 native 构建 + 基线测试
实际命令与目录（全部在仓库根）：
  1. Bun 安装：powershell -NoProfile -Command "irm bun.sh/install.ps1 | iex" → Bun 1.4.2 安装到 C:\Users\Ethan\.bun\bin\bun.exe
  2. bun install --frozen-lockfile → 391 packages installed，exit 0（345.66s）
  3. cargo install cargo-nextest --locked → exit 0（/tmp 下执行，避开 rustup 仓库内代理同步副作用）
  4. bun run build:native → Finished `local` profile in 4m 52s，exit 0；
     pi_natives.win32-x64-msvc.node 归一化为 pi_natives.win32-x64-modern.node，
     安装到 packages/natives/native/pi_natives.win32-x64-modern.node（本 Fork 源码构建）
  5. bun packages/coding-agent/src/cli.ts --version → "omp/18.8.4"，exit 0
  6. bun test packages/coding-agent/test/write-hashline-header.test.ts → 5 pass / 0 fail，exit 0
退出码 / 测试总数：见上
运行环境：Windows 10.0.26200 x64；Bun 1.4.2；rustc 1.99.0 stable（活动）+ pinned nightly-2026-10-06-x86_64-pc-windows-msvc（rustup toolchain list 确认已安装，组件齐全）；MSVC 14.44.35207（cl.exe Hostx64/x64 于 C:\Tools\clangdGBK\vs）+ Windows SDK 10.0.26100.0（vswhere 确认）；native 来源=本仓库源码构建
通过：addon 来自当前源码；CLI 从源码入口成功；基线编辑测试通过
不通过：无
未验证：全量测试套件（留待 P12；当前仅基线抽样）
与原版兼容结果：Bun 安装到 ~/.bun（标准位置），未触碰原版 omp 安装
风险与恢复：build:native 使用 local profile；.node 文件不在 git 跟踪范围
下一阶段及未满足前置：P02（无阻塞）
```

### P02–P05｜核心编码闭环 — 通过（2026-10-08 下午）

```text
开始 SHA / 结束 SHA：40e9368ef0 / 本阶段提交（见 git log，feat/gbk-text-io）
工作区变更（新增）：
  crates/pi-edit/src/encoding.rs — TextEncoding、严格 GBK decode/encode（错误定位到字节/字符）、
    EncodingSpec schema（deny_unknown_fields + camelCase）、CompiledEncodingPolicy（globset，Windows 大小写不敏感）、
    混合换行检测
  crates/pi-natives/src/encoding.rs — N-API：EncodingPolicy 类、encodingDecodeStrict/encodingEncodeStrict/encodingCanEncode
  crates/pi-edit/tests/gbk_encoding.rs — 引擎层端到端（EncodingWriter 模拟 TS host 编码写盘）
  packages/coding-agent/src/encoding/index.ts — 策略发现（向上查找 .omp/encoding.json，止于用户主目录）、
    mtime 缓存、readTextWithPolicy/encodeForWrite/resolveWriteEncoding
  packages/coding-agent/test/gbk-encoding.test.ts — 工具层端到端
工作区变更（修改）：
  pi-edit: files.rs（FileRead.encoding/endings_unrestorable + 严格解码 + persist GBK 守卫 + BOM 冲突拒绝 +
    persist_new 策略化）、store.rs（EditStore.setEncodingPolicy + record_file GBK 解码）、path_policy.rs
    （PathPolicy.encoding + resolve_encoding）、engine.rs（StagedFile.encoding）、session.rs
    （WriteRequest.encoding）、全部模式引擎（replace/patch/apply_patch/hashline/sloppy 传递 encoding）
  pi-natives: edit.rs（EditPolicy.encodingRoot/encodingJson、EditWriteRequest.encoding、
    EditStore.setEncodingPolicy）
  coding-agent TS: edit/index.ts（策略传递 + GBK move/写后校验按 GBK 字节 + ACP 活动时拒绝）、
    edit/store.ts（getEditStore 同步策略，变更时 clear 快照）、tools/write.ts（GBK 编码 + ACP 拒绝 +
    字节数按 GBK）、tools/read.ts（buffered/流式 GBK 解码 + BOM 冲突 + 受管文件跳过二进制 sniff）、
    tools/file-write-fallback.ts（writeFileWithFallback encoding 参数，fallback 请求带 encoding）、
    tools/acp-bridge.ts（新增 hasActiveWriteBridge）、lsp/writethrough.ts（写端编码 + 批次读回解码）
实现行为：
  解码：受管 GBK 文件严格解码，非法字节报 offset；UTF-8 BOM + GBK 规则 → 策略冲突错误；
  编码：写前严格校验（不可表示字符报 U+码点/行号），Rust 预检 + TS 落盘端编码同一算法；
  保持：原编码、CRLF/LF、末尾换行、未修改字节（Rust persist 恢复 BOM+换行后交 TS 编码）；
  拒绝：混合换行 GBK 写入拒绝；ACP bridge 活动时受管文件写入拒绝（hasActiveWriteBridge 判定）；
  默认路径：无策略文件时全部行为与上游一致（TS 回归测试覆盖未管理路径 UTF-8 世界）
实际命令与目录（仓库根）：
  cargo test -p pi-edit --test gbk_encoding → 17 pass / 0 fail
  cargo test -p pi-edit（全量）→ 364 pass / 0 fail（20 个新 encoding 单测 + 既有套件）
  bun test packages/coding-agent/test/gbk-encoding.test.ts → 10 pass / 0 fail
  bun test packages/coding-agent/test/edit-mode.test.ts edit-input-paths.test.ts edit-acp-bridge.test.ts
    write-hashline-header.test.ts → 27 pass / 0 fail
  bun check → 全部通过（oxlint 0 警告、oxfmt 干净、tsgo 全包、cargo clippy -D warnings、cargo fmt）
  bun run build:native → 成功（137 ESM 导出含 encoding 模块）
运行环境：Windows 10.0.26200 x64；Bun 1.4.2；rustc nightly-2026-10-06；addon=本 Fork 源码构建
通过：
  E01 中文注释读取、E02 read→edit→read 字节循环、E03 CRLF 保持（Rust 层）、E04 无末尾换行（Rust 层）、
  E05 no-op、E06 ASCII+规则→GBK 与新文件 GBK、E08 override 豁免、E09 emoji 写前拒绝、E10 非法字节
  offset、E11 BOM 冲突、E13 stale 保护（Rust 层）、E14 连续编辑、E29 策略变更清快照、
  未管理路径保持上游行为（含无效 UTF-8 拒绝消息不变）
不通过：无（见未验证）
未验证：
  - file-write-fallback.test.ts 2 例 symlink 内核权限测试在无开发者模式 Windows 上 EPERM（基线环境限制，
    与编码改动无关——失败点在 fs.symlink 调用）
  - >4MiB 流式 GBK 读取（代码路径已接入 streamLinesFromFile encoding，未写大文件测试——留 P12 E24）
  - LSP 服务器交互下的 GBK writethrough（P08）
  - grep/AST（P07）
与原版兼容结果：无 .omp/encoding.json 时字节级行为不变（专门回归测试）
风险与恢复：StagedFile.encoding=None 等价 UTF-8；策略解析失败在首次使用时报错，不静默退化
下一阶段及未满足前置：P06 修复路径审计 → P07 grep/AST → P08 LSP/edits
```


## 3. 每阶段记录模板

复制以下结构新增记录；必须填具体值，不保留“均通过”等无证据结论。

```text
阶段：Pxx / 标题
开始与结束时间：本地时区 +08:00
开始 SHA / 结束 SHA：
工作区变更：本阶段文件、保留的用户文件
实现行为：输入、执行路径、输出、错误处理
实际命令与目录：
退出码 / 测试总数 / skipped 数：
日志与公开证据路径：
运行环境：OS、架构、Bun、Rust、native 来源
通过：
不通过：
未验证：
与原版兼容结果：
风险与恢复：
下一阶段及未满足前置：
```

## 4. 源码覆盖记录模板

| 工具/入口 | 读取边界 | 写入边界 | snapshot/rollback | 默认 UTF-8 | GBK | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| read | 待填写 | 不适用 | 待填写 | 未验证 | 未验证 | 待填写 |
| edit/Hashline | 待填写 | 待填写 | 待填写 | 未验证 | 未验证 | 待填写 |
| write | 待填写 | 待填写 | 待填写 | 未验证 | 未验证 | 待填写 |
| patch | 待填写 | 待填写 | 待填写 | 未验证 | 未验证 | 待填写 |
| grep/AST | 待填写 | 待填写 | 待填写 | 未验证 | 未验证 | 待填写 |
| LSP/formatter | 待填写 | 待填写 | 待填写 | 未验证 | 未验证 | 待填写 |
| ACP | 待填写 | 待填写 | 待填写 | 未验证 | 未支持/未验证 | 待填写 |
| child/extension | 待填写 | 待填写 | 待填写 | 未验证 | 未验证 | 待填写 |

## 5. 发布证明模板

```text
Release URL：
Tag：
Tag 解引用完整 SHA：
分支与代码审查范围：
上游 baseVersion / Fork version：
构建 SHA / 构建时间 / 平台：
Bun / Rust / linker / native ABI：
资产清单：名称、大小、SHA-256
下载核验目录与命令：
成品 GBK 测试结果：
原版共存结果：
签名状态：
E630 验收状态：
已知限制：
安装、更新、回退命令：
isDraft / isPrerelease：
```

## 6. 阻塞与继续原则

- 缺少真实 E630 输入不阻塞 codec、工具和安装开发；它阻塞 E630 验收声明及正式稳定版承诺。
- 缺少付费模型连接时运行确定性工具测试，真实模型项保留未验证。
- 缺少 SDK/编译依赖时先解决开发环境，不用官方二进制代替 Fork 成品。
- 发布 gate 未满足时继续可独立的实现/修复；不能创建冒充完成版的 Release。
- GitHub 权限/服务不可用时保留本地验证产物和确切失败记录；恢复后查询远端状态再重试，避免重复创建。
- 只有必要输入或外部权限确实缺失才询问用户；已有明确发布授权不重复逐步确认。

## 7. 最终汇报结构

先给可用产物与 Release 链接，然后依次说明实现范围、与原版兼容、验证证据、性能、已知限制、安装回退。若没有发布，第一句明确“未发布”和具体原因，不把文档链接当程序下载链接。
