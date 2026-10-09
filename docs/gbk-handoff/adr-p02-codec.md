# ADR：GBK 编解码与项目编码策略（P02）

日期：2026-10-08/09 · 状态：已实施（v18.8.4-gbk.1）

## 决策

1. **codec 选型**：`encoding_rs`（workspace 直接依赖，GBK/CP936 语义）。严格性由我们自建：
   - 解码：`GBK.decode_without_bom_handling` 快路径 + `had_errors` 时按 GBK 结构（lead 0x81–0xFE、
     trail 0x40–0xFE 除 0x7F）逐序列定位首个非法字节偏移。
   - 编码：先整体编码并**回读校验**（decode(encode(t)) == t），再逐字符定位首个不可表示字符
     （U+码点+行号）。encoding_rs 对不可映射字符的 HTML 数字引用（`&#…;`）路径一律视为错误，
     永不落盘。
2. **单一实现、两层接入**：Rust（pi-edit::encoding）是唯一 codec；TS 通过 N-API
   （`EncodingPolicy` 类、`encodingDecodeStrict/EncodeStrict/CanEncode`）复用同一实现，
   两侧匹配语义由同一份 globset 代码保证（`*` 不跨 `/`、Windows 大小写不敏感、路径先做
   `\\?\` verbatim 归一）。
3. **策略 root**：`.omp/encoding.json` 位于项目根；TS 从 cwd 向上查找、**不越过用户主目录**；
   按 (root, mtime) 缓存，未命中负缓存 1s TTL。项目级 `.omp` 目录语义与上游共享（fork 不改名）。
4. **模块边界**：磁盘字节只在两个 sink 相遇——读（read.ts/Rust FileCache/store/grep/ast 各自
   的解码入口，全部指向同一 codec）与写（`writeFileWithFallback(encoding)`/`writeTextWithPolicy`/
   AST 字节写回）。编辑引擎内部一律 Unicode（上游模型不变）；`WriteRequest.encoding` 把落盘编码
   从 Rust 传递到 TS host。无每行 JS 回调（grep 逐文件转码在 Rust 线程池内完成）。
5. **错误模型**：非法输入→`路径 + 字节偏移`；不可表示输出→`U+码点 + 行号`，且发生在任何写
   盘动作之前（引擎 persist/AST 批次预检/TS 编码前置校验三道闸）。BOM 与 GBK 规则冲突、
   混合换行、GB18030/未知编码均显式拒绝，绝不静默降级。
6. **缓存键**：快照哈希仍基于规范化文本（编码无关）；策略版本经 (root,mtime) 失效并清空
   EditStore 快照，防止跨策略的 stale 恢复。native 缓存以 fork 根（~/.ompg）隔离，键仍为
   packageVersion。
7. **保存保证**：原编码/BOM/CRLF/末尾换行/未修改字节保留（Rust 层 persist 恢复后交 TS 编码）；
   no-op 不重写；写后读回校验字节级相等（测试断言逐字节对比手写 GBK 期望）。
