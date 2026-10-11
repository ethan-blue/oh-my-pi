# 发布后问题最终验收

日期：2026-10-11。仓库：`ethan-blue/oh-my-pi`；工作分支：`feat/gbk-text-io`。

设计及另一 AI 的完整执行 Prompt：[14-issue-remediation-design.md](14-issue-remediation-design.md)。编码入口、兼容性变化和后续任务：[15-issue3-encoding-verification.md](15-issue3-encoding-verification.md)。

## 问题验收和关闭条件

| Issue | 结论 | 证据和边界 |
| --- | --- | --- |
| [#1](https://github.com/ethan-blue/oh-my-pi/issues/1) | PASS，已关闭 | 静态提示模板由实际运行时目录 helper 填充，SDK agentDir 贯穿提示构建；不硬编码用户目录，不暴露配置或密钥。默认、自定义模板及子 Agent 路径有回归。SDK 完全替换 systemPrompt 的字符串/数组/回调仍由调用方控制，可主动省略身份模板；不能保证模型永不误报。 |
| [#2](https://github.com/ethan-blue/oh-my-pi/issues/2) | PASS，已关闭 | setModel 接受 Model 或字符串，复用现有角色/模型解析器；无凭证和非法选择失败且不改变模型。命令上下文避免对象展开造成 getter 快照；事件、注册命令和无 runner 的 custom-command 在 await 后读取即时模型均有行为回归。 |
| [#3](https://github.com/ethan-blue/oh-my-pi/issues/3) | PARTIAL，保持 OPEN | G1/G2/G3 和 G6 的写前保护、严格解码及诊断通过；G4 的双重合法编码歧义诊断、G5 的子进程输出编码协议仍未实现。不能用部分修复关闭六项集合。 |

本轮不发表评论，不改用户 E630 文件，不修改用户安装。关闭源码缺陷不意味着已经发布新的二进制。

## 最终实际门禁

| 门禁 | 结果 |
| --- | --- |
| 全仓 `bun check` | PASS，退出 0；格式、lint、TypeScript 与 Rust fmt/clippy。 |
| 最后 TS 快退及测试变更后的 `bun run check:tools` | PASS，退出 0。 |
| 身份/模型 API 五文件回归 | 111 passed、0 failed、422 assertions。 |
| 最终源码 `bun run build:native` | PASS；Windows x64 modern，140 exports，local optimized profile。 |
| 最终源码 `bun run test:rs` | 3016 passed、4 skipped；doctest 1 passed、18 ignored，退出 0。 |
| 最终 native 的五文件 GBK 回归 | 55 passed、0 failed、200 assertions。 |
| 最终 native 的九文件通用工具回归 | 149 passed、8 skipped、0 failed、539 assertions；跳过项为 Windows 不支持的 FIFO 测试。 |
| `git diff --check` | PASS。 |
| 真实模型、E630/Keil、非 Windows 主机 | UNVERIFIED。 |
| 含本轮修复的新独立二进制发布 | 未进行。 |

九文件覆盖 read、raw range、special files、tail seek race、grep pagination/snapshot、LSP 与 AST edit；旧非法 UTF-8 替换输出预期改为严格拒绝，合法长中文行仍验证磁盘字节计量。没有为获得通过而删除失败场景。

最终 native SHA256：`4725c75842dc9dcf2f5cccb5cd2e46b189ba689ae116b0ed236263cced2eb00c`。原生二进制是本地构建输出，不提交到 Git；下次发包必须重建、验包并下载验证。

## 已有发布资产复核

公开预发布仍是 [v18.8.7-gbk.1](https://github.com/ethan-blue/oh-my-pi/releases/tag/v18.8.7-gbk.1)，源码为 `b68f4c9ce864762b509a4b924d39df65cd71f17a`。本轮补上传该版本原有、已匹配校验清单的 `RELEASE_NOTES.md`；没有替换 ZIP 或把新源码冒充旧版本。

从公开 Release 下载 ZIP，核验外层和包内校验清单、build-info 源码 SHA，执行包内程序 `--version` 与 `--smoke-test`，均通过。ZIP SHA256：`d7a8968d34836e13ed96777898472174ff61d9293be9f76a56d0e021686b3d8b`。

现有用户须等待使用新版本号发布的修复包，或自行从本分支构建；旧版安装程序不会凭源码提交自动更新。下一轮不得覆盖 `.1` 资产，应使用新后缀。

## 后续执行

修复已提交并推送：[b65a86c806](https://github.com/ethan-blue/oh-my-pi/commit/b65a86c806c81fc04801855a354bf601af978406)。远端分支 SHA 已读取核对一致。

按用户授权在源码推送成功后关闭 #1/#2，不附评论。GitHub 读取确认 #1 于 `2026-10-11T00:10:09Z`、#2 于 `2026-10-11T00:10:10Z` 关闭；#3 仍为 OPEN。G4/G5 的下一 AI 任务与禁止项以设计文档及编码验收文档为准。
