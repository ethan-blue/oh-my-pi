# ompg v18.11.0-gbk.1 验收记录

上游 v18.11.0，提交 c2cb79e4c227aa4b22c4ccb933ff72fd88bceba4；Windows x64 AVX2 / Bun 1.4.2 / Rust nightly-2026-10-06 / MSVC。
包内 build-info.json 固定实际源码、上游提交/检查时间、native 哈希和构建工具。

| 检查 | 实测 |
| --- | --- |
| native | 官方优化构建退出 0，146 exports；既有链接 warning 保留 |
| GBK + ptree | 最终 native 下 173 passed、0 failed、591 assertions，10 文件 |
| 记忆及生命周期 | 98 passed、0 failed、281 assertions，10 文件；含真实 SDK system prompt、ReadTool pending→生成、项目隔离、缓存签名边界和长路径 |
| 配置发现/协议扩展 | 269 passed、2 平台 skipped、9 symlink EPERM 环境阻塞；未修改权限、链接类型或删除断言 |
| 最终记忆+配置整合 | 325 passed、2 平台 skipped、9 symlink EPERM；37 文件，962 assertions |
| 最终 task/stats/审批/Gemini/KDL | 689 passed、2 skipped、1 symlink EPERM；64 文件，3065 assertions |
| bun check | 最终退出 0：lint/fmt、17 包类型、cargo fmt/clippy -D warnings |
| Rust 全仓 | 3221 passed、4 skipped；doctest 1 passed，退出 0 |
| EXE / 安装器 / 发布校验 | 最终交付记录补充真实执行结果，不用旧版本数字替代 |

native SHA256：6963b1cedbbc9aeb981160c249f6869863939017ff65af09322b8d1bd5b96e6c。

上述套件有重叠，不相加为独立测试总数。共 10 个不同 symlink 用例受环境阻塞，不计通过；本地协议注入与模拟后台固化不构成真实模型遵循证明。
Unix 实机、E630、ConPTY 性能、原机 herdr GUI、真实账号模型尚未验证。GB18030 不支持；保护模式不是 OS 沙箱。
桥接本轮没有修改；上轮真实 socket 证据保留在 38 号记录，不作为新版本重新执行的结果。
