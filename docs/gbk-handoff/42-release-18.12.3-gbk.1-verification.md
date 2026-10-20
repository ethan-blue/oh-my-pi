# 42 · v18.12.3-gbk.1 发布验证

发布时间 2026-10-20T01:47:19Z；本文件为发布后补记，随发布后文档提交入库。

## 交付与基线

- 交付提交 `498efbebb17f463672fbadb4689a995a67956cd5`（`fix(ompg): close three fork regressions surfaced by the merged upstream suite`），其第一父链包含合并提交 `6da8efd9b27e90b54d2f0fe943ea43063abdfdf7`（Merge OMP v18.12.3 and preserve ompg GBK behavior）。
- 官方稳定基线 `v18.12.3`，标签提交 `53a0377db6845e0dae606146130766ec92d407fd`（2026-10-19T18:41:25Z 发布）。合并前（08:27/08:29/08:41 +08:00）、打包器内置检查（01:43:19Z，记录于 build-info.json 的 upstreamCheckedAt）与发布后（01:50 前后）三次查询结果一致；`git merge-base --is-ancestor` 确认上游提交为交付提交祖先。
- 个人 fork 远端 `origin/feat/gbk-text-io` 由 `a0d839d6019b3adaeb1df087519e1f5f266fcd10`（v18.11.1-gbk.1 阶段）推进到交付提交；标签 `v18.12.3-gbk.1` 为新附注标签，指向交付提交，远端 `refs/tags/v18.12.3-gbk.1^{}` 复核一致。旧资产未触碰。

## 合并保真评审（远端 fork 既有改动是否丢失）

- 16 个 fork 核心文件（encoding 引擎、protected-mode、encoding CLI、OutputDecoder、hashline、taps/pipetap、安装器、打包器、dirs、审批目标、GBK bench 等）合并后全部在索引与工作树中。
- 合并删除的 7 个文件（rs-parking-lot.md、eval/py/display.ts、priority.json、对应测试与 fixture）经 `git log --diff-filter` 归属核实，均由上游提交引入、又被上游 v18.12.x 自己删除，不属于 fork 资产。
- 28 处含 fork 特征词的删除行逐条核对：上游重构（Hashline 增加 max_columns、grep.rs 常量提升）、上游 CHANGELOG 已发布段落迁移、以及本轮有意的措辞与版本更新；未发现 fork 行为丢失。
- 三处签名文件测试（`gbk-search-ast`、`hashline_parity` 等）改动为本轮增强或新签名适配，fork 语义保留。

## 全量套件归因（最终轮 216 分块 163 过 53 败）

环境阻塞（不计为通过，也不计为回归）：

- 符号链接需管理员/开发者模式（EPERM -4048）：settings-manager、plugin-config、marketplace、sdk-skills、extensions-discovery、autolearn-managed-skills、update-cli、file-write-fallback、browser-upload-contents 等，逐类以隔离复跑取证。
- 本机继承本地代理 `ANTHROPIC_BASE_URL`（127.0.0.1:15721，`ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED`）：compaction/snapcompact/provider-image/speculative 系以 `invalid x-api-key` 失败。
- 负载下 30 秒超时与并行 stdout 污染：fetch-binary-dispatch、logger/stderr 系。
- 需网络或 gh/浏览器真实环境：gh、browsers、collab registry、vercel-gateway 等（本 shell 下 0 用例执行）。
- terminal-appearance 9 例：测试文件与其全部依赖（keys/terminal-capabilities 同上游逐字节；terminal.ts 仅差 fork 的 pump 三行且测试态关闭）与上游一致，判定为本机对上游 v18.12.3 的既有失败。

真实回归三处（均已修复并隔离复测通过）：

1. MCP 配置写入未失效项目配置负缓存：`findProjectConfigUpward` 的 1 秒负缓存在 `/mcp enable` 先解析路径后写入的场景里让 `loadAllMCPConfigs` 看不到刚创建的 `mcp.json`，静默不连接。修复：`writeMCPConfigFile` 写入后调用 `invalidateProjectConfigCaches()`。
2. 子代理派发预固定 `maxRuntimeMs`：`buildExecutorOptions` 提前用 `resolveTaskMaxRuntimeMs` 求值，破坏上游"未固定时不传值、由 executor 继承"契约。修复：仅在该 agent 配置了 `task.agentRuntimeOverrides` 或有显式请求值时传数（新增 `taskAgentRuntimeOverride` 助手），解析仍留在 `runSubprocess`，override 功能不变。
3. 文件提及跳过文案丢失上游 "binary file" 词汇：双严格解码失败分支前缀恢复该词，fork 诊断信息保留。

`bun check` 修复后退出 0；Rust 全仓（PATH 含 Git usr/bin）3357 过 4 跳、doctest 1 过 18 忽略；14 个定向文件 214 过 0 败；`mcp-command-toggle`、`mcp-incremental-connect`、`agent-bridge-policy`、`structured-subagent`、`workpool`、`file-mentions`、`gbk-issue4-config` 隔离复测全过。

## 构建与资产

- 干净提交 `498efbebb1` 上 `bun --cwd=packages/coding-agent run build` 产出 `dist/omp.exe`（224,327,680 字节，SHA-256 `dc045a3e9cd5d4de98fb8e7603810cd224674fdd5f36a33ec28ee4b3b5c8f2d5`）。`--version` 为 `ompg/18.12.3-gbk.1`，`--help`、stats help、`--smoke-test: ok`；隔离 `PI_CODING_AGENT_DIR`/`PI_NATIVES_DIR` 下 GBK 探针按 `.ompg/encoding.json` 正确解码 `// 中文`，提取的 `pi_natives.win32-x64-modern.node` SHA-256 `5a89193ba43531a9c530cb9596a282f61de25a0518ad0a87e2d9019da973fb42` 与新构建插件一致。
- `package-ompg-release.ts --version 18.12.3-gbk.1 --sha 498efbebb1…`：外清单 3/3、内清单 7/7、ZIP 条目白名单 8 项、build-info 字段（distribution/repository/version/upstreamBaseVersion/upstreamCommitSha/commitSha/platform/nativeAddon.embedded+sha256/gbkSupport）全部核对通过。
- `test-install-ompg.ps1`（新 EXE + 已独立校验的 18.11.1-gbk.1 PreviousExe）：parse/install/upgrade/rollback/checksum 拒绝/保守卸载/原 omp 与 PATH 保全 PASS。

## 发布与远端复核

- Draft prerelease 创建后用认证通道（gh）逐资产下载：4/4 与 staging 哈希一致、外清单 3/3、解压后内清单 7/7、EXE 哈希与版本/smoke 一致、build-info 指向交付与上游提交。
- `--draft=false --prerelease` 公开后回读元数据：`isDraft=false`、`isPrerelease=true`、4 资产 digest 与本地一致（含 SHA256SUMS.txt 自身 `3d9aaae4…`）。
- 公开（未认证）下载通道复测：安装器内置校验通过、安装后 `ompg/18.12.3-gbk.1`、EXE 哈希与构建产物一致、smoke ok；`-Download -Version 18.11.1-gbk.1` 回退成功；`-Uninstall` 保守移除两个版本标记，用户数据未动。

## 未验证边界（如实记录）

Windows symlink 权限阻塞不等于测试通过。Unix、E630/Keil、ConPTY 性能、真实模型遵循度未验证；GB18030 不支持；保护模式不是操作系统沙箱。Bridge 为独立部署（本阶段沿用已验证的 `1a5a3ff7…` / SHA `ac7822bf…`，未随本版重验，真实 herdr GUI 仍未验收）。发布为未签名 Windows x64 AVX2 预发布。
