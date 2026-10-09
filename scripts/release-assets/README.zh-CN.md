# ompg — OMP 的 GBK 原生支持分支（Windows x64）

`ompg` 是 [oh-my-pi](https://github.com/can1357/oh-my-pi)（上游 v18.8.4）的个人分支，
在核心编辑引擎中原生加入**项目级 GBK 编码读写**。它与原版 `omp` 完全共存：独立命令、
独立数据目录（`~/.ompg`）、独立 native 缓存，互不覆盖。

## 安装

```powershell
# 解压 ompg-<版本>-windows-x64.zip 后，在解压目录执行：
powershell -ExecutionPolicy Bypass -File .\install-ompg.ps1

# 或直接从 GitHub 下载安装指定版本：
powershell -ExecutionPolicy Bypass -File .\install-ompg.ps1 -Version 18.8.4-gbk.1 -Download
```

安装器会把 `ompg.exe` 放入 `%LOCALAPPDATA%\ompg\versions\<版本>\`，在
`%LOCALAPPDATA%\ompg\` 生成稳定启动器 `ompg.cmd`（和可用的硬链接 `ompg.exe`），并把
该目录加入用户 PATH。**不会**修改任何已有的 `omp` 安装、`omp` 的 PATH 项或 `~/.omp`
数据。

验证：

```powershell
ompg --version        # 期望输出：ompg/18.8.4-gbk.1
```

## 启用 GBK（按项目）

在项目根目录创建 `.omp\encoding.json`（模板见压缩包内 `encoding.example.json`，
示例路径必须按你的工程调整）：

```json
{
	"schemaVersion": 1,
	"enabled": true,
	"include": ["src/**/*.c", "src/**/*.h"],
	"defaultEncoding": "gbk",
	"newFileEncoding": "gbk",
	"overrides": [{ "glob": "src/vendor-utf8/**", "encoding": "utf8" }]
}
```

语义：

- 只有命中 `include` 通配符的**已存在文件**才按 GBK 处理；其余文件行为与原版完全一致（UTF-8）。
- 新建文件按 `overrides` 命中的规则，否则 `newFileEncoding`。
- 多条 `overrides` 命中时第一条生效。
- 解码/编码全部**严格**：非法字节或 GBK 无法表示的字符会在写盘前报错（带字节偏移/码点位置），
  绝不替换为 `?`、`U+FFFD` 或 HTML 实体。
- 保留原编码、UTF-8 BOM（UTF-8 文件）、CRLF/LF、末尾换行与未修改字节；
  **混合换行**（CRLF 与 LF 混用或孤立 CR）的 GBK 文件会拒绝写入并说明原因。
- UTF-8 BOM + GBK 规则 = 策略冲突，会明确报错，要求加 override。
- 不支持的编码（gb18030、big5 等）在加载策略时明确拒绝；GBK 不会被隐式升级为 GB18030。

## 支持范围（v18.8.4-gbk.1）

| 入口 | GBK 行为 |
| --- | --- |
| read（整文件/范围/尾部/流式） | 严格解码显示；快照与编辑一致 |
| edit / Hashline（全部模式）/ apply_patch | 原编码保存；stale 保护、权限、plan mode 语义不变 |
| write / 新建 / 移动 / 删除 | 原编码/新文件规则编码；移动保留源编码 |
| search (grep) | 中文关键词在 GBK 文件可匹配，结果行正确显示 |
| ast_grep / ast_edit | 解码后解析（偏移针对解码文本），写出严格 GBK |
| LSP 编辑 / rename / code action | 经编码层读写，不改变文件编码 |
| ACP 桥接写入受保护 GBK 文件 | **明确拒绝**（ACP 协议无编码保持合同） |

**不经过本程序核心的外部写入**（直接运行 python/PowerShell 脚本改文件、外部
formatter `--write`、ACP 客户端自带的保存等）**不提供编码保证**——这是边界而非拦截承诺；
请用内置工具完成 GBK 文件的修改。

## 与原版共存 / 卸载

- `ompg` 数据根是 `~/.ompg`（原版 `omp` 继续用 `~/.omp`）；项目级 `.omp` 配置（含
  `encoding.json`）两者按各自实现读取。
- native 缓存：`~/.ompg/natives`，与原版隔离。
- 子代理/子进程重入 `ompg` 自身，不会误启动 PATH 上的原版 `omp.cmd`（可用
  `PI_SUBPROCESS_CMD` 显式覆盖）。
- `ompg update` 已禁用自动更新（避免把分支替换成官方版本），按提示从
  https://github.com/ethan-blue/oh-my-pi/releases 手动升级。
- 卸载：`powershell -File .\install-ompg.ps1 -Uninstall`（只删除 ompg 文件与 PATH 项，
  保留 `~/.ompg` 数据和原版 `omp`）。

## 已知限制

- 首版仅验证 Windows x64。
- 混合换行的 GBK 文件拒绝写入（见上）。
- E630 实际工程编译验收未提供，未执行；本版本是**预发布版**（prerelease）。
- 提示词等内置文档中以 `omp` 命令示例的地方，在 ompg 中对应 `ompg` 命令。
