# 08 — P17：上游更新、冲突处理与回退

## 1. 更新原则

后续更新可行，但不能承诺所有版本零冲突。维护成本由改动边界和验证覆盖决定，不由 Fork 本身决定。

- `main` 保持上游同步用途；GBK 长期开发在功能分支或后续明确的维护分支。
- 上游版本、Fork 修订和构建 SHA 分开记录。
- 每次选择一个明确上游 release，不让安装器自动拉取未验收 main。
- 优先复用上游接口，把 codec、路径策略、分发身份各自集中，不在几十个工具里复制转码逻辑。
- 上游重构时允许迁移必要接入点；不要为了保留旧补丁形状而恢复已删除架构。

## P17｜完成一次可复现的更新演练（P1；依赖 P16）

**目标：**证明升级流程可执行，并且升级失败不会替换当前可用版本。

**范围：**Git integration 分支、01 源码地图、专项测试、基准、分发与安装策略。

**步骤：**

1. 检查原分支工作区，记录当前已验收 SHA/tag/安装版本；存在未提交工作先保留，不能用重置制造干净状态。
2. fetch 上游分支和 tags，选择目标 release，阅读其工具、native ABI、配置、更新器和构建变化。
3. 从当前 GBK 实现建立独立 `integration/gbk-<目标版本>` 分支/工作树，保留原分支。
4. 合并目标上游 tag。对冲突逐文件理解，禁止整批采用 ours/theirs 覆盖。
5. 对照路径矩阵审计新增 read/write/edit/formatter/ACP/子 Agent 入口，尤其重新引入的 UTF-8 假设。
6. 重新构建 native，运行基础回归、E01—E30、兼容矩阵、Windows 成品 smoke 和性能比较。
7. 先给出候选包，在隔离安装目录做升级/回退验证；全部满足后才发布新 Fork 修订。
8. 若没有合适的新上游版本可演练，可验证准备/拒绝/回退流程，但不得写“跨版本合并已验证”。

**验收：**记录目标 tag、冲突清单、解决说明、测试证据和安装回退结果；不依赖人工记忆。

**失败处理：**保持现有 release 和安装不动，在 integration 分支修复；不 force-push 已共享历史，不重写旧 release tag。

## 2. 每次升级必须审计的边界

| 边界 | 必看变化 |
| --- | --- |
| native 文件访问 | 新 FileSource、缓存、内存映射、读取上限、严格 UTF-8 假设 |
| Hashline | 快照、seen lines、stale checks、协议、规范化与恢复 |
| 写入 | 新 write callback、move/create、permission fallback、批量 rollback |
| 搜索/AST/LSP | decoder、字节偏移、formatter、workspace edits |
| ACP/插件/子 Agent | buffer 写入、工具覆盖、policy/config 传播、child executable |
| 构建 | Bun/Rust 版本、N-API 绑定生成、addon identity、嵌入资源 |
| 分发 | installer/update 源、版本解析、资产名、签名和 checksum |
| 配置与会话 | root/profile/cache、schema migration、旧会话读取 |

源码搜索可以辅助审计新增 `.text()` / `read_to_string` / `Bun.write` 调用，但不能用“grep 没搜到”证明完整覆盖，也不能把这种搜索写成代替行为测试的单元测试。

## 3. 更新命令框架

以下仅为安全顺序，目标 tag 应由接手者真实选定，不复制不存在的占位符：

```powershell
git status --short --branch
git fetch --filter=blob:none upstream --tags
if ($LASTEXITCODE -ne 0) { throw 'Upstream fetch failed' }
git tag --list 'v*' --sort=-version:refname
```

随后在干净、独立 integration 分支执行 merge。操作前核对选定 ref 实际指向 commit。对已发布分支默认使用 merge 保留历史，不自动 rebase/force-push。

## 4. 维护补丁的划分

建议保持四类可审查变更：编码策略/codec、工具与 native 接入、兼容分发、测试文档。它们可作为数个清晰 commit，但不能为了 commit 好看让中间版本静默损坏 GBK。

性能优化只针对已测量热点；不混入 UI 重做、provider 变更、模型策略改动或无关格式化，减少升级冲突和行为回归。

## 5. 故障回退表

| 情况 | 处理 |
| --- | --- |
| 上游 merge 冲突 | 留在 integration 分支解决，现有可用分支不变 |
| 编码/Hashline 回归 | 阻止新 release，保留失败 fixture |
| UTF-8 明显变慢 | 比较样本定位，未解释不升级默认安装 |
| 新版 binary 无法加载 native | 校验源码 SHA/ABI/stamp/cache，不退回官方旧 addon |
| 安装更新中断 | 保持旧入口和旧版本目录 |
| 发布后发现问题 | 停止推荐该版本，说明受影响范围，发布新修订；不悄悄替换同名资产 |

## 6. 上游贡献

个人 Fork 可以先交付。向上游贡献时，阅读当前 `CONTRIBUTING.md`：涉及跨包大改需先讨论，PR 要有人类本人写的说明并完成真实使用验证。不要让接手 AI 伪造这句说明或擅自联系上游。
