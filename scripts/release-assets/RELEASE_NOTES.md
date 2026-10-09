# ompg v18.8.4-gbk.1（预发布）

OMP（上游 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) v18.8.4）的 GBK
原生支持分支，首个 Windows x64 预发布版。

> ⚠️ **Prerelease**：通用 GBK 行为已完成自动化验收（见 VALIDATION.md）；E630 实际
> 工程编译验收未提供、未执行。请勿当作稳定版使用。

## 功能范围

- 项目级编码策略 `.omp/encoding.json`（include/overrides/default/newFile；未知编码与
  GB18030 明确拒绝）。
- 严格 GBK 编解码贯穿核心：read（整文件/范围/流式）、全部 edit 模式（replace/patch/
  apply_patch/hashline/sloppy）、write/新建/移动、grep、ast_grep/ast_edit、LSP 编辑。
- 原编码/BOM/CRLF/末尾换行/未修改字节保留；非法字节与不可表示字符写前报错（带位置）。
- 与原版 `omp` 完全共存：`ompg` 命令、`~/.ompg` 数据根、独立 native 缓存；自更新禁用，
  只指向 ethan-blue/oh-my-pi releases。
- 不启用策略的项目行为与上游 v18.8.4 一致（UTF-8 路径字节级回归通过）。

## 安装 / 升级 / 回退

```powershell
# 安装（解压后）
powershell -ExecutionPolicy Bypass -File .\install-ompg.ps1

# 从 GitHub 安装指定版本
powershell -ExecutionPolicy Bypass -File .\install-ompg.ps1 -Version 18.8.4-gbk.1 -Download

# 回退到上一个版本：安装旧版本号即可，versions\ 目录保留历史
# 卸载（保留 ~/.ompg 数据与原版 omp）
powershell -ExecutionPolicy Bypass -File .\install-ompg.ps1 -Uninstall
```

下载后请核对 `SHA256SUMS.txt`。

## 已知限制

- 仅 Windows x64；其他平台未验证。
- 混合换行（CRLF+LF 混用/孤立 CR）的 GBK 文件拒绝写入。
- ACP 桥接活动时对受保护 GBK 文件的写入明确拒绝（协议无编码合同）。
- 外部进程（python/PowerShell、外部 formatter --write、ACP 客户端直接保存）写入不提供
  编码保证。
- E630 工程编译验收：未验证（未提供工程与工具链）。
- 内置提示词中的 `omp` 命令示例在 ompg 中指 `ompg`。

## 校验

`SHA256SUMS.txt` 覆盖本 Release 全部资产；`build-info.json`（包内）记录 fork/上游版本、
commit SHA、Bun/Rust 工具链与内嵌 native addon 的 SHA-256。
