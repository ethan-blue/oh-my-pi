# ompg v18.10.4-gbk.1 验收记录

上游正式版 v18.10.4，提交 687892d1046ecaf18829b45f5b86928a308258f4；Bun 1.4.2 / Windows x64 AVX2 / Rust nightly-2026-10-06 / MSVC。
本版结果均在合并后执行，旧 gbk.2 结果不代替新门禁。包内 build-info.json 记录实际源码、上游提交/检查时间、native 哈希和构建工具。

| 检查 | 实测 |
| --- | --- |
| native | 官方优化构建退出 0，146 exports；既有 LNK4217 warning 保留 |
| Rust 全仓 | 3210 passed / 4 skipped，退出 0；doctest 1 passed |
| bun check | 退出 0：lint/fmt/workspace types/cargo fmt/clippy -D warnings |
| 最终 native 下 GBK + ptree | 173 passed / 0 failed，591 assertions，10 文件 |
| task/stats/Gemini/KDL 定向 | 251 passed / 0 failed，1139 assertions，36 文件 |
| 审批/AST/ACP write/设置重载/bash renderer | 114 passed / 1 skipped / 0 failed，450 assertions，5 文件 |
| bridge 真 socket 回归 | 6 passed / 0 failed，11 assertions |
| bridge 本机安装/发现 | 安装字节匹配源码，实际 native extension discovery 只找到一个 ~/.ompg bridge |
| git diff --check | 退出 0，无未解决冲突 |

native SHA256：8213931d68082632237a5de6afb28c57c72124607261d128025fb46e2e7800d5。
bridge 提交：1a5a3ff723ac545f6d3ee637894ea6559f3b0084；安装文件 SHA256：ac7822bfb2334dfe599e92370b4e5a5e6838b6d90c4423fbabb1d78d4f1d067a。

发行流程另执行实际 EXE version/smoke/doctor、fork updater 阻断、隔离真 EXE 升级/回退、下载内外 SHA 清单与公开安装探针，最终证据写入 38 号交付记录。源代码结果不能冒充远程下载证明。

未验证：用户当前 herdr pane 的重载与 GUI、原机日志症状、非默认 profile、Unix/E630/ConPTY A/B。原有 Windows symlink EPERM 保持环境阻塞，本轮未更改权限、链接类型或断言；表中 1 skipped 不计通过。保护模式不是 OS 沙箱，GB18030 不支持。
