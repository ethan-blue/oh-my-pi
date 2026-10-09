# 09 — 执行台账与证据模板

本文件必须由接手 AI 随实现更新。初始状态来自 2026-10-08 的文档制作现场，不代表后续代码状态。

> 2026-10-09 用户事故补充：用户报告原生 edit 解码失败后 Agent 经 bash/Python 改写测试文件。已添加 [R10 修复计划](11-native-tools-incident-plan.md)，状态为待实现/待验收；事故工程字节损坏情况未核实。历史阶段记录保留，P09 重新打开。R01—R09 的审查反例亦须修复后重新验收，不能沿用历史通过结论。

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
| P06 | patch/repair/rollback | P05 | 通过（2026-10-09；全部模式引擎共享 persist/编码路径；auto-repair 经策略读写；17 项 Rust 端到端含 patch/apply_patch/hashline/sloppy） |
| P07 | grep/AST | P03、P06 | 通过（2026-10-09；grep 转码匹配/渲染、AST 解码偏移+严格写回+批次预检、verbatim 路径修复） |
| P08 | LSP/formatter/ACP | P07 | 通过（2026-10-09；writethrough/批次读回/edits/rename/rollback 策略化；ACP 活动桥接对 GBK 拒绝） |
| P09 | Shell/eval/child 边界 | P08 | 重新打开（2026-10-09 用户报告绕过原生工具；R10 原生恢复/权限门禁待实现，原边界声明不构成防绕过验收） |
| P10 | 分发身份与数据隔离 | P09 | 通过（2026-10-09；ompg/18.8.4-gbk.1、~/.ompg、XDG/LOCALAPPDATA 隔离、loader fork 缓存根） |
| P11 | 安装更新兼容 | P10 | 通过（2026-10-09；install-ompg.ps1 版本目录+校验+PATH 幂等+卸载；CLI 层禁用自更新给手动步骤） |
| P12 | 功能与兼容验收 | P04—P11 | 基本完成（2026-10-09；全量 17077 测试 vs 基线 worktree 抽样对照，见下） |
| P13 | 性能对比 | P12 | 通过（2026-10-09；bench 三模式，策略未命中≈基线，无 >5% 回归） |
| P14 | 成品构建 | P10—P13 | 通过（2026-10-09；ompg/18.8.4-gbk.1 @ 5c3b67ef，release-profile addon，smoke ok，白名单 zip+SHA256SUMS） |
| P15 | 安装回退 | P14 | 通过（2026-10-09；隔离目录安装/运行/卸载/PATH 幂等/原版共启全程验证） |
| P16 | GitHub Release | P15 | 通过（2026-10-09；draft→下载核验→公开 prerelease） |
| P17 | 上游升级演练 | P16 | 通过（2026-10-09；integration/gbk-v18.8.5 merge v18.8.5，冲突解决+编码门禁通过，已推送） |

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

### P06–P13｜工具覆盖、ompg 身份、回归对照与性能 — 2026-10-09

```text
开始/结束 SHA：e1f2798（P02-P05 提交）… c1a068c0e9（含全部修复；详细见 git log feat/gbk-text-io）
实现行为与修改（增量提交，均在本分支）：
  P06：patch.rs preview/stage 双路径 GBK 预检；persist_new 按 new-file 规则；auto-repair 读经策略边界
  P07：grep.rs GrepOptions.encodingPolicy（walker/流式/单文件三路径 lossy 转码，只读）；ast.rs
       read_candidate_source 严格解码 + 写前全批次 GBK 预检 + 逐文件字节写回；verbatim(\\?\) 路径
       strip_verbatim 修复（Rust 单测覆盖；此前 GBK 字节流恰为合法 UTF-8 时静默错位）
  P08：writethrough 写端/批次读回、lsp/edits applyTextEdits/applyEditsThenRename/workspace-edit
       回滚全部经 readTextWithPolicy/writeTextWithPolicy；ACP：hasActiveWriteBridge 判定活动桥接后
       对 GBK 受管文件写前拒绝
  P10：dirs.ts APP_NAME=ompg、CONFIG_DIR_NAME=.ompg（用户根）、PROJECT_CONFIG_DIR_NAME=.omp（项目级
       发现不变）、DISTRIBUTION_VERSION=18.8.4-gbk.1、USER_AGENT；loader-state.js 缓存根/XDG/
       LOCALAPPDATA/下载提示全部 fork 化；resolveOmpCommand 编译态重入自身；storage-state 随新根
  P11：update-cli REPO=fork + FORK_DISTRIBUTION 在 CLI 命令层禁用自更新（内部函数保持上游语义，
       上游单测不改断言通过）；scripts/install-ompg.ps1（版本目录+SHA256 校验+稳定 ompg.cmd+
       PATH 幂等+-Uninstall 保数据）
  P12：新 gbk-validation.test.ts（E24 >4MiB 流式、E26 中文/空格路径、E29 策略变更清快照、E28 重入）
  P13：packages/coding-agent/bench/gbk-encoding-bench.ts（utf8-baseline/utf8-policy-unmatched/
       gbk-managed × read/edit/grep，5 预热+40 样本）
测试与证据：
  bun test gbk-*.test.ts → 19 pass / 0 fail（工具层 E01-E29 覆盖）
  cargo test -p pi-edit --test gbk_encoding → 18 pass（含 verbatim 修复回归）
  CI=1 bun run test:rs → 2988 run：2986 pass / 2 fail；2 个失败（pi-shell output_decode、
    pi-builtins sed::fast_io）在基线 worktree（40e9368，junction node_modules）复现一致——既有环境失败
  bun check → 0 lint 警告 / 0 类型错误 / clippy+fmt 干净
  全量 bun test packages/coding-agent：首次 16440 pass/158 fail；经基线对照逐类判定：
    - symlink EPERM 类（无开发者模式 Windows）：插件/marketplace/Settings 符号链接安全/update-cli
      安装目标/writeFileWithFallback 内核权限等 ~100 例——基线同样失败（抽样验证 8 个文件）
    - 网络/计时类：github pr_checkout、memories、approvalMode 超时、one-shot settlement——基线同样失败
    - POSIX 语义类：getOrCreateSnapshot umask——基线同样失败
    - 本分支引入且已修复：discovery 插件 fixture(.ompg)、system-prompt 项目 fixture(PROJECT_ 重命名)、
      update-cli 命令层测试、parseReportedVersion 前缀、--max-time 提示、日志文件名断言
  最终全量复跑进行中（结果记入发布 VALIDATION.md）
  性能（同机同工具链，fork 内三模式）：read p50 1.66/1.50/1.25 ms、edit p50 1.34/1.47/1.22 ms、
    grep p50 8.60/8.37/5.02 ms（baseline/policy-unmatched/gbk）——策略未命中与基线差异在噪声内，
    无 >5% UTF-8 回归；GBK 因字节更小反而更快
运行环境：Windows 10.0.26200 x64；Bun 1.4.2；rustc nightly-2026-10-06；MSVC 14.44
不通过：无新增
未验证：真实模型调用（不依赖）；E630 工程（未提供）；成品安装/共启（P15）
```

### P14–P16｜构建、安装与 GitHub Release — 通过（2026-10-09）

```text
P14 构建：
  构建 SHA：5c3b67efbba58ddf8568ca7f7cba1d1ca32e3ea6（feat/gbk-text-io，干净树）
  命令：bun run build:native（OMP_NATIVE_CARGO_PROFILE=release）→
        bun scripts/ci-release-build-binaries.ts --targets win32-x64
  产物：packages/coding-agent/binaries/omp-windows-x64.exe（234,312,192 B）
  验证：--version → ompg/18.8.4-gbk.1；--smoke-test → ok；
        addon 嵌入（encodingDecodeStrict 符号在 exe 内）并暂存至 ~/.ompg/natives/18.8.4/（fork 缓存根）
  打包：bun scripts/package-ompg-release.ts --version 18.8.4-gbk.1
        → release-staging/ompg-18.8.4-gbk.1-windows-x64.zip（白名单：ompg.exe/install-ompg.ps1/
          README.zh-CN.md/encoding.example.json/build-info.json/LICENSE/THIRD-PARTY-NOTICES.txt）
          + SHA256SUMS.txt + RELEASE_NOTES.md + VALIDATION.md
  注：tag 后有一个仅改 Rust 测试文件的修复提交（57c7a7e99f，lib 代码与构建 SHA 一致，
      不影响已发布二进制）；另有一个 .gitignore 提交（0faeb6873b）。

P15 安装/回退（隔离目录演练，全部通过）：
  安装：install-ompg.ps1 -InstallDir <temp> → versions/18.8.4-gbk.1/ompg.exe + 根 ompg.cmd(+硬链)
        + 用户 PATH 幂等追加；版本取自二进制 --version 输出（ompg/18.8.4-gbk.1）
  运行：<install>/ompg.cmd --version → ompg/18.8.4-gbk.1
  共启：原版 C:\Users\Ethan\AppData\Local\omp\omp.exe --version → omp/18.2.11，全程未被写入
  卸载：-Uninstall → install 目录删除、PATH 条目移除（复查 [Environment]::GetEnvironmentVariable
        ('Path','User') 无 ompg-p15）、~/.ompg 数据保留、原版仍可用

P16 发布（全流程通过）：
  冲突检查：git ls-remote 无 v18.8.4-gbk.1；gh repo ethan-blue/oh-my-pi
  tag：git tag -a v18.8.4-gbk.1 5c3b67ef…（指向构建 commit）→ push origin refs/tags/…
  创建：gh release create … --verify-tag --draft --prerelease --notes-file RELEASE_NOTES.md
  下载核验（独立目录 /tmp/ompg-verify）：gh release download →
        sha256sum zip=d937980f…b8aac38 与 SHA256SUMS.txt 逐字节一致；
        VALIDATION.md=81c52b02… 一致；解压后 ompg.exe --version / --smoke-test 通过；
        build-info.json commitSha=5c3b67ef…（=tag 解引用）
  公开：gh release edit --draft=false --prerelease（--latest 未设）
  终态读回：isDraft=false、isPrerelease=true、publishedAt=2026-10-09T02:16:22Z、
        3 资产（zip 116,284,801 B / SHA256SUMS.txt 263 B / VALIDATION.md 6,299 B）
  签名：未签名（无证书）；如实记录
```

### P17｜上游升级演练 — 通过（2026-10-09）

```text
分支：integration/gbk-v18.8.5（自 feat/gbk-text-io 57c7a7e99f），已推送 origin
目标：v18.8.5（上游 v18.8.4 之后的第一档）
冲突：1 个（modify/delete）——上游删除 task/omp-command.ts（PI_SUBPROCESS_CMD 移除，
      resolveOmpCommand 为死代码）。处置：接受删除；移除 fork 的 E28 重入测试（该风险面
      已不存在）；lib 其余自动合并（Cargo.toml/catalog/sdk 等）。
门禁（integration 分支）：bun check 通过；gbk-*.test.ts 18 pass / 0 fail；
      pi-edit --test gbk_encoding 18 pass / 0 fail
未做：integration 分支的完整构建/发布（按 08 规范留待正式升级批次）
```

### R01—R10 复审修复（2026-10-09 下午）— 完成

```text
输入：docs/gbk-handoff/11-native-tools-incident-plan.md + 独立审查报告（R01-R10）。
修复（全部带回归测试）：
  R01 enabled=false：CompiledEncodingPolicy 增加 enabled 字段，resolve 恒 None；
     禁用 stub 可缺省必填字段；Rust 3 项回归（含 UTF-8 文件不受 include 影响）。
  R02 新文件编码：writethroughNoop 按实际存在性探测（不再恒 exists=true）；
     TS 回归（newFileEncoding=utf8 落盘 UTF-8 字节）。
  R03 move 编码：edit #write 的 move 分支改用 request.encoding（源编码）；
     TS 回归（GBK 源移到 newFileEncoding=utf8 目标仍 GBK）。
  R04 原字节：FileCache 读入时做 encode(decode(bytes))==bytes 稳定性检查，
     不稳定（如欧元 A2E3↔80）在 persist 前拒绝；Rust 回归（未编辑字节不变）。
  R05 LSP 文本：client.ts 四处 Bun.file().text() → readTextFileWithPolicy；
     协议帧回归（didOpen 文本为解码后中文，无 U+FFFD）。
  R06 批次预检：applyWorkspaceEdit 文档先 precheckTextOpEncodings（全部严格
     编码后再写）；回归（第二文件不可编码→整批拒绝、两文件字节均不变）。
  R07 -Download 路径：适配 zip 顶层版本目录（查找 $work/ompg.exe 或
     $work/ompg-*/ompg.exe）。
  R08 卸载归属：先验证 install.json 标记（repository==fork）；拒绝危险根/
     原版目录；只删除 ompg 已知文件，未知文件保留并报告。
  R10-A 恢复闭环：read 二进制拒绝与 Rust InvalidUtf8 均给出策略缺口指引
     （相对路径 + "补规则后重读" + 禁止 shell 重写提示）。
  R10-B 受保护模式：.omp/protected-mode.json（schemaVersion/enabled/
     buildTasks[{id,exe,args}]）；bash.ts/eval.ts 执行前门控；简单调用可匹配
     结构化构建任务（尾 * 模式），其余一律拒绝；子目录/子会话经 cwd 发现继承。
     A01-A10 全过（37 项 gbk 套件内 10 项）。
  R09 bench：唯一标记行消歧（编辑不再失败）；read/edit/grep 全部断言成功与
     命中数；grep 显式传 encodingPolicy 且三模式同 pattern 同 fixture；峰值
     RSS + 原始样本照旧。真实数字：GBK edit +33%，read/grep 噪声内；此前
     "无回归/更快" 结论作废（见 VALIDATION.md R09 修正块）。
测试：bun test gbk-*.test.ts → 37 pass / 0 fail；cargo test -p pi-edit
  --test gbk_encoding → 21 pass；CI=1 test:rs → 2986/2988（2 个基线复现的
  环境失败）；bun check 通过。
未验证：上游构建的 A/B 性能对照（列为后续项）；真实 LSP 服务器/模型/E630。
```

### 补充验收（2026-10-09，发布后资产更新）— 通过

```text
触发：完成度核查提出 4 项缺口（峰值内存/原始样本、E21 确定性、E16 注入、旧数据副本）。
E21：gbk-lsp-recovery.test.ts（新增）——applyWorkspaceEdit rename 式（text edit+rename）
     与 code-action 式（多文件、UTF-16 位置含中文→中文替换）后磁盘 GBK 字节与手写期望
     逐字节相等；不需要 LSP 服务器（该函数即 lsp 工具驱动的确定性面）。
E16：同文件——目标父路径被普通文件占据注入 ENOTDIR 写失败；move 报 isError、源文件
     GBK 字节逐字节不变、blocker 不动。
bench：gbk-encoding-bench.ts 增加 process.memoryUsage().rss 采样（峰值）与原始样本输出；
     重跑（同机）：read p50 1.53/1.54/1.36 ms、edit p50 1.33/1.44/1.37、grep p50
     8.63/8.38/5.57；峰值 RSS 233.1/214.7/212.6 MiB；原始样本（3×3×40）存档
     scripts/release-assets/bench-samples-v18.8.4-gbk.1.json 并随 Release 发布。
旧数据副本：~/.omp/agent/config.yml（18.2.11）经 grep 确认无密钥后复制到隔离副本根；
     PI_CONFIG_DIR 指向副本 → ompg config list 正确解析（原版主题等设置显示）。
     会话 *.jsonl 副本 → listSessionsReadOnly 列出 21 个（状态推导正确）、
     loadSessionMessagesReadOnly 解析消息成功。全程只读副本，未迁移、未上传。
Release 资产更新：VALIDATION.md（E16/E21/性能/兼容新证据）+ SHA256SUMS.txt --clobber
     重传，新增 bench-samples 资产；zip 未动（哈希不变 d937980f…）；重新下载核验
     3 资产哈希与 SHA256SUMS 逐字节一致；终态 isDraft=false/isPrerelease=true、4 资产。
源码提交：0f29e0e998（feat/gbk-text-io，已推送）；tag 不变（exe 未变）。
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
| read | readTextWithPolicy/decodeStrict（buffered+streaming+tail） | 不适用 | recordSnapshot/recordSnapshotFile（store 策略化） | 通过 | 通过（E01/E12/E24） | gbk-encoding/gbk-validation.test.ts |
| edit/Hashline | Rust FileCache 严格解码（含 verbatim 修正） | WriteRequest.encoding→TS 端编码；persist 写前校验 | 上游 stale/plan/symlink 语义不变 | 通过 | 通过（E02-E14） | pi-edit gbk_encoding.rs 18 例 |
| write | readCurrentWriteSource 策略化 | writethrough→writeFileWithFallback(encoding) | 快照 header 不变 | 通过 | 通过（E06/E15） | gbk-encoding.test.ts |
| patch/apply_patch | 同 edit（全模式共享） | 同 edit + persist_new 新文件规则 | 多文件 staging 原子性（上游） | 通过 | 通过 | 同上 |
| grep/AST | grep lossy 转码（只读）；AST 严格解码 | AST 全批次预检+字节写回 | 不适用/预检拒绝 | 通过 | 通过（E19/E20） | gbk-search-ast.test.ts |
| LSP/formatter | edits/writethrough 策略化读写 | writeTextWithPolicy | rename 回滚策略化 | 通过 | 写路径通过；真实服务器交互未验证 | 回归+代码审查 |
| ACP | bridge 读不受影响 | 活动桥接对 GBK 写前拒绝 | — | 通过 | 拒绝路径通过（E22） | edit-acp-bridge 回归 |
| child/extension | 子进程重入自身（v18.8.5 起上游移除该路径） | 外部进程不在 Core 内 | — | 通过 | 边界声明于 README/Notes | P15 演练/P17 审计 |

## 5. 发布证明模板

```text
Release URL：https://github.com/ethan-blue/oh-my-pi/releases/tag/v18.8.4-gbk.1
Tag：v18.8.4-gbk.1（annotated）
Tag 解引用完整 SHA：5c3b67efbba58ddf8568ca7f7cba1d1ca32e3ea6
分支与代码审查范围：feat/gbk-text-io（10 个任务提交，见 git log 40e9368..57c7a7e99f）
上游 baseVersion / Fork version：18.8.4 / 18.8.4-gbk.1
构建 SHA / 构建时间 / 平台：5c3b67ef… / 2026-10-09 / windows-x64
Bun / Rust / linker / native ABI：Bun 1.4.2 / nightly-2026-10-06 / MSVC 14.44 / win32-x64-modern（release profile）
资产清单：
  ompg-18.8.4-gbk.1-windows-x64.zip  116,284,801 B  SHA-256 d937980ff9d11490f168078d3d0d50f7b216256b219d2ad7594efefe0b8aac38
  SHA256SUMS.txt                      279 B
  VALIDATION.md                       7,508 B         SHA-256 af26759625afb344ed5566bdd615786cd16a3bcfdc0dc230cbc88f0dfe152ed1
  bench-samples-v18.8.4-gbk.1.json    7,562 B         SHA-256 3ecc452d0ea6495bb54cd63ab7301fb308d2b8648c418b0b5be580fd5257a465
下载核验目录与命令：/tmp/ompg-verify{,2}；gh release download v18.8.4-gbk.1 --repo ethan-blue/oh-my-pi；sha256sum
成品 GBK 测试结果：--version=ompg/18.8.4-gbk.1、--smoke-test ok、build-info SHA=tag SHA、
  addon 嵌入且暂存至 fork 缓存根（源码级 GBK 字节证据见 VALIDATION.md E 矩阵）
原版共存结果：omp/18.2.11 安装与数据全程未动（P15 安装/卸载/共启演练）
签名状态：未签名
E630 验收状态：未验证（工程/编译器未提供）
已知限制：见 RELEASE_NOTES.md「已知限制」
安装、更新、回退命令：install-ompg.ps1（-Download -Version / -Uninstall）；ompg update 禁用给手动步骤
isDraft / isPrerelease：false / true（publishedAt 2026-10-09T02:16:22Z）
```

## 6. 阻塞与继续原则

- 缺少真实 E630 输入不阻塞 codec、工具和安装开发；它阻塞 E630 验收声明及正式稳定版承诺。
- 缺少付费模型连接时运行确定性工具测试，真实模型项保留未验证。
- 缺少 SDK/编译依赖时先解决开发环境，不用官方二进制代替 Fork 成品。
- 发布 gate 未满足时继续可独立的实现/修复；不能创建冒充完成版的 Release。
- GitHub 权限/服务不可用时保留本地验证产物和确切失败记录；恢复后查询远端状态再重试，避免重复创建。
- 只有必要输入或外部权限确实缺失才询问用户；已有明确发布授权不重复逐步确认。

## 7. 最终汇报结构

2026-10-09 本地修复复验已补充至 [12-repair-verification-2026-10-09.md](12-repair-verification-2026-10-09.md)：200 通过、18 平台跳过、0 失败；本地构建及隔离安装/更新/回退通过。此记录不更新上面的历史 Release 状态，本轮修复尚未发布。

先给可用产物与 Release 链接，然后依次说明实现范围、与原版兼容、验证证据、性能、已知限制、安装回退。若没有发布，第一句明确“未发布”和具体原因，不把文档链接当程序下载链接。
