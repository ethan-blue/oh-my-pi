# 03 — P00—P04：环境与核心闭环

每阶段按“目标 / 前置 / 修改范围 / 步骤 / 验收 / 失败处理”推进，并更新 09 台账。

## P00｜确认现场并建立基线（P0）

**目标：**在不丢失现有工作的前提下，知道接手的是哪份代码、哪些结论已验证。

**前置：**读取 00、01 和仓库规则。

**范围：**Git 元数据、工具链清单、已有交接文档；暂不改产品代码。

**步骤：**

1. 检查分支、HEAD、origin/upstream、未提交和未跟踪文件。
2. 将开始 SHA、用户已有 diff、命令路径记录到 09；不把认证文件内容写入记录。
3. 用 `Get-Command omp -All` 和 `where.exe omp` 记录原版命令解析，存在才继续检查其版本；不要把命令不存在视为故障。
4. 阅读原计划；确认“代码尚未实现”和“文档已存在”没有被历史 DONE 标签混淆。
5. 后续脚本暂存使用仓库 `work/`，发布 staging 与源码测试 fixture 分开；先检查 ignore 规则。

**验收：**台账列出真实 SHA、脏工作内容和原版安装基线；仓库无意外删除/覆盖。

**失败处理：**目录不是预期 Fork 或分支明显被他人接续时，先读取变化；不得重置到旧 SHA。缺少真实 E630 项目不阻塞合成 fixture 开发。

## P01｜建立可运行开发环境（P0；依赖 P00）

**目标：**能够构建当前源码的 native 模块和启动 OMP，形成未改动基线。

**范围：**`package.json`、`bun.lock`、`rust-toolchain.toml`、`scripts/bazel-natives.ts`、`packages/natives/scripts/build-bindings.ts`。

**步骤：**

1. 根 packageManager 要求 Bun >=1.4，部分子包/安装脚本仍写 >=1.3.14；选择满足根要求的固定版本并记录，不用旧最低值糊弄构建。
2. 在仓库外查询已安装 Rust toolchain，避免 rustup 代理在查询时隐式触发本目录 pinned toolchain 同步；需要安装时明确执行并记录。
3. 准备仓库固定的 nightly、Windows MSVC Build Tools/SDK、nextest 等实际构建需求；不自动降级 nightly 或删除 native 功能。
4. 执行 `bun install --frozen-lockfile`，逐项记录失败。安装脚本和生成器可能产生文件，之后复核 diff。
5. 执行根目录 `bun run build:native`。Windows host 使用现有 Cargo/N-API 路径；不要套用上游 Linux Bazel 交叉构建命令。
6. 用源码入口执行 `--version`、`--help`；运行与编辑相关的已有测试，记录基线结果与环境问题。

**验收：**加载的 addon 来自当前源码本机构建；基本 CLI 成功；已有失败可复现且没有被归因成 GBK 改动。

**失败处理：**缺 SDK/依赖等属于环境阻塞，记录具体命令和错误，不上传半成品。不要直接运行 `bun setup`，它还会全局 link `omp`，可能覆盖原版命令。

## P02｜确定共享 codec 与策略边界（P0；依赖 P01）

**目标：**确定能被 Rust 与 TS 一致使用的编码能力，先用严格测试证明它可靠。

**范围：**`crates/pi-edit/src/files.rs`、`crates/pi-edit/src/text.rs`、`crates/pi-natives/src/edit.rs`、配置注册/发现入口；共享 codec 模块拟新增。

**步骤：**

1. 阅读 02 契约，为项目策略定义有版本的 schema 和错误类型。
2. 对 codec 做独立 byte fixture 验证：GBK 中文、ASCII、非法尾字节、欧元等 CP936 差异字符、不可表示字符、UTF-8 BOM。
3. 评估把 codec 放入已有共享 crate 或小型独立模块；选择最少依赖且可被搜索/AST/edit 共用的边界，记录 ADR。
4. 定义 decode/encode、policy resolve、文件版本元数据之间的职责；不要把权限 fallback 的字符串接口直接改成字节而漏改调用方。
5. 策略加载按项目/session 缓存；对子 Agent 传递不可变快照与版本；策略变更使相关缓存失效。
6. 初版只实现 utf8/gbk，GB18030 未实现时显式拒绝。保留缺省路径的上游行为。

**验收：**相同 fixture 在 Rust 与 TS 公开边界得到相同文本/错误和目标字节；非法输入没有替换输出；schema precedence 有行为测试。

**失败处理：**codec 不能满足字节保留时更换实现或缩小并显式声明支持范围，不能放松严格性让测试通过。

## P03｜read 与快照一致（P0；依赖 P02）

**目标：**GBK 文件可正确阅读，并生成编辑引擎能接受的真实快照。

**范围：**`tools/read.ts`、`tools/read-format.ts`、`edit/store.ts`、Rust `files.rs` / `store.rs`，均按 01 的完整前缀定位。

**步骤：**

1. 先接入小文件整文件路径，复用读取的 bytes；显示、摘要和快照使用同一解码结果。
2. 接入范围读取、尾部读取、多范围和长行截断；流式 decoder 保留跨 chunk 状态。
3. 修改 `record_file` 的 UTF-8 假设，避免 read 成功但 edit 查不到有效快照。
4. 确认文件大小、输出限额、快照上限分别基于哪种字节长度，不把 GBK bytes 和 UTF-8 展示 bytes 混用。
5. 明确二进制 sniff 与已配置文本的优先级，错误文件不得产生可编辑的乱码快照。
6. 验证默认 UTF-8、UTF-8 BOM、未命中策略和内部 URL 行为未被改变。

**验收：**中文注释/字符串正确显示；读取后 Hashline 能准确定位；分块中文和截断长行无乱码；错误输入不给可写快照。

**失败处理：**快照与展示不一致即停止进入写入实现；不要通过关闭 Hashline 校验绕过。

## P04｜Hashline 编辑与原编码保存（P0；依赖 P03）

**目标：**完成最小真实闭环：读 GBK → 获取当前锚点 → 编辑 → 文件仍为 GBK。

**范围：**Rust `files.rs` / `session.rs` / `modes/hashline/`，native `edit.rs`，TS `edit/index.ts` / `lsp/writethrough.ts` / `file-write-fallback.ts`。

**步骤：**

1. 把编码和原始文件状态贯穿 preview、apply、host callback；不要在保存时重新猜编码。
2. 对输出先严格 encode、检查 round trip，再调用受保护保存；返回快照使用实际成功保存的文本。
3. 保持现有 Hashline 算法、可见行限制、plan mode 和 stale-tag 检查。
4. 用外部字节修改触发陈旧编辑，证明 GBK 路径也拒绝覆盖。
5. 测试 CRLF、末尾无换行、no-op、不可编码字符、取消、文件占用和失败恢复。
6. 同一 session 内连续两次 read/edit，验证第二次锚点不受首次转码污染。

**验收：**逐字节对比目标 GBK bytes；无关内容不变；负例原文件摘要不变；read→edit→read 闭环通过。

**失败处理：**出现错误成功提示、部分覆盖或快照污染，阶段判为不通过；保留失败 fixture，修复后重跑同一消费者路径，不能只加 helper 单测。
