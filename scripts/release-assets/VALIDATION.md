# ompg v18.9.0-gbk.1 验收记录

日期：2026-10-11。Windows x64 AVX2，Bun 1.4.2，Rust nightly-2026-10-06 / MSVC。未签名预发布版。

## 来源与构建

- 合并核实的最新官方正式版 OMP v18.9.0，提交 `eec114a9226da698ebc015fd8996a8ca3bc4625c`；不发布后续未验收 main。
- frozen lockfile 安装与 RPC 四语言代码生成成功。
- `bun run build:native` 成功：Windows modern 优化构建，143 exports。原生 SHA256：`f05f765e6c605f3d5e4aefc571df0f0e1c80340fe598d3bb7f3b42200ea5080b`。
- native 链接仍有上游 LNK4217 / wasmtime 警告；加载和回归通过。不宣称构建日志零警告。
- 独立 EXE 构建、`--version` (`ompg/18.9.0-gbk.1`)、`--smoke-test` (`smoke-test: ok`) 通过；`update --check` 保持 fork 自更新阻断与手动升级指引。
- 正式发布包要求工作树干净、打包 SHA 与 HEAD 一致；最终源码身份见包内 build-info.json，外层和内层 SHA256SUMS.txt 分别校验资产与文件。

## 本轮门禁

| 检查 | 实测结果 |
| --- | --- |
| `bun check` | 通过，退出 0：5986 文件格式、lint、17 包类型检查、Rust fmt / clippy |
| `bun run test:rs` | 3061 passed、4 skipped，退出 0；doctest 另 1 passed、18 ignored |
| GBK / PTY / eval / stderr / 消费方 15 文件 | 154 passed、3 skipped、0 failed、584 assertions，退出 0 |
| Python integration / dispatch / shell 3 文件 | 32 passed、4 skipped、0 failed、149 assertions，退出 0 |
| read / grep / write / AST / LSP 相邻 10 文件 | 154 passed、11 skipped、0 failed、624 assertions，退出 0 |
| 身份 / extension / eval / 更新器 11 文件 | 118 passed、6 skipped、7 failed、451 assertions，退出 1；七项失败均为 fs.symlink EPERM 环境阻塞 |
| 空白检查 | fork 未暂存差异通过；合并暂存差异仅保留上游 SCSS.sublime-syntax 的 EOF 空行提示，排除此已知项后通过 |
| 安装器隔离回归 | 安装、升级、回退、同版本不同内容拒绝、校验损坏拒绝、保守卸载通过 |
| 真实 EXE 升级回退 | 18.8.7-gbk.1 → 18.9.0-gbk.1 → 18.8.7-gbk.1，通过字节摘要核对 |
| 原版共存 | 安装测试前后原版 omp.exe（存在时）的 SHA256 与用户 PATH 不变；更新器 ompg shim 测试保留同目录 omp.cmd |

本轮新增搜索回归验证 NUL 二进制优先跳过，覆盖目录、显式文件、files-with-matches 与 >4 MiB prefix，策略开关两种路径。真实 advisor grep 消费方恢复通过；无 NUL 的非法文本仍严格拒绝，未更换 codec 或绕过断言。

更新器七项环境阻塞是 npm/Bun/Homebrew 的符号链接目标检测用例，未改系统权限、删除或跳过失败用例。这不作为全部 TypeScript 通过的证据；本 fork 正常自更新被禁用，发布使用另行验证的 Windows install-ompg.ps1。

## 未验证与边界

- 全仓 TypeScript 测试未执行；上表只记录列明套件。Rust 测试保留上游 test-only dead-code 警告。
- Unix 实机与 symlink containment 权限依赖路径未通过验证；不以 Windows 编译冒充 Unix 证明。
- GBK 显式策略，不猜全部编码，不支持 GB18030；大文件诊断覆盖实际读取窗口。
- PTY / Python PIPE / JS Buffer 捕获复用 native decoder；ConPTY 已转换字节无法恢复。Python fd-1 无单请求归属，JS 持久 writer 无 EOF 证据时保持 unknown；用户代码内部错误解码的字符串不可逆，继承子进程 raw stdio 不保证经过 JS write hook。
- 保护模式是工具入口限制，不是 OS 沙箱。外部程序、第三方扩展及可信构建钩子需单独约束。
- E630 / Keil、真实模型、真实 LSP 服务器端到端、无 AVX2 CPU、其他平台、NumPy / matplotlib 缺依赖分支、同机性能 A/B：未验证。
- 本文件是上传前本地验收；GitHub 下载回读与公开状态另记 `docs/gbk-handoff/30-release-18.9.0-gbk.1.md`。
