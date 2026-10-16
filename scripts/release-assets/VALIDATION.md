# ompg v18.11.1-gbk.1 验收记录

上游 v18.11.1，提交 7cc912940b107eb2d771b0d106c640a8eddc9edf；Windows x64 AVX2 / Bun 1.4.2 / Rust nightly-2026-10-06 / MSVC。
包内 build-info.json 固定实际源码、上游提交/检查时间、native 哈希和构建工具。

| 检查 | 实测 |
| --- | --- |
| native | 官方 local 优化构建退出 0，146 exports；既有 LNK4217 warning 保留 |
| GBK + ptree + read/eval | 最终 native 下 221 passed、2 平台 skipped、0 failed，773 assertions，15 文件 |
| 记忆及生命周期 | 115 passed、0 failed、360 assertions，10 文件 |
| task/stats/审批/Gemini/KDL | 695 passed、2 skipped、1 symlink EPERM 环境阻塞，64 文件；未修改权限或删除断言 |
| bun check | CI=1，退出 0：lint/fmt、17 包类型、cargo fmt/clippy -D warnings |
| Rust 全仓 | 3233 passed、4 skipped；doctest 1 passed，18 ignored，退出 0 |
| 桥接 | 6 passed；安装文件与独立仓库 1a5a3ff 相同，本版不替换扩展 |
| EXE / 安装器 / 下载包 | 发布后交付记录补充实际版本、smoke、升级/回退及远端下载哈希验证 |

native SHA256：8194d443d3eb5cb796ad10d6c1e111fc6c412a0f2fe5a0f3a5c1af7a6f6bcdd9。

新增 GBK CRLF 回归覆盖 <=4 MiB 缓冲和 >4 MiB 流式读取的闭合/开放原文行范围，验证中文、末尾换行和实际行数。Rust 合并补齐上游新增 AST 测试的可选编码策略参数。

首次 Rust 测试因新增测试漏传参数而编译失败，补齐后重跑通过。首次 native 安装因并发测试占用模块返回 EPERM；等待测试结束后重建安装成功。旧 native 预跑目录读取缺新字段，最终 native 下对应套件通过。新增 GBK 测试最初缺必填 newFileEncoding，补齐真实配置后通过。保留初轮失败日志，不计入通过。

上述套件有重叠，不相加为独立测试总数。symlink 环境阻塞不算通过；本地提示词验证不构成真实模型遵循证明。
Unix 实机、E630、ConPTY 性能、原机 herdr GUI、真实账号模型尚未验证。GB18030 不支持；保护模式不是 OS 沙箱。
