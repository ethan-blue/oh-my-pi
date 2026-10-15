# Issue #7/#8：记忆注入、缺失摘要与 v18.11.0 合并

## 1. 本轮范围与基线

起点为 feat/gbk-text-io 的 413b6aada7，工作树干净。GitHub 当前开放问题为 #7、#8；桥接仓库没有开放 issue。#6 已关闭，报告针对 18.8.4/18.8.7 的旧审计，本轮按现有消费路径复核，不以 issue 状态证明修复。

官方正式版 v18.11.0，发布时间 2026-10-14T22:01:49Z，准确提交 c2cb79e4c227aa4b22c4ccb933ff72fd88bceba4。相较上一 v18.10.4 基线有 309 个提交。合并保留 GBK、Hashline、.ompg/.omp、保护模式、输出来源和 runtime overrides。

## 2. 复现与根因

先补持久回归再修改生产实现，首次运行 27 pass / 3 fail：摘要占满预算会挤掉 learned marker；只有 learned.md 时仍要求读取不存在的摘要；summaryInjectionTokenLimit=0 时所有规则消失。

#8 并非完全没有自动注入。现有 local backend 已将记忆放入 SDK 的系统提示词，但 learned 与摘要共用一个预算，且文字将规则降格为可选历史线索。应修复现有管线，避免另建重复读取和注入路径。

#7 是正常生命周期状态被当作错误：learn 可以先产生 learned.md，后台固化尚未产生 memory_summary.md，说明却无条件要求先读摘要，协议也只会报 missing file。

## 3. 实施顺序与文件

1. memories/index.ts：继续复用 readLearnedLessons 的清洗与秘密脱敏。完整 learned 内容独立注入，summaryInjectionTokenLimit 仅截断摘要。0 表示关闭摘要注入，不删除规则。
2. prompts/memories/read-path.md：依据真实摘要可用状态选择说明。规则已经内联，不需要模型先自愿调用 read；事实仍须依当前仓库核验，当前用户和更高优先级指令保持优先。
3. internal-urls/memory-protocol.ts 与独立静态 pending 模板：显式 local backend 的默认摘要缺失时返回正常说明，没有 sourcePath、不创建文件。后续生成后下一次读取立即看到真实内容。任意其他缺失文件、越界、权限错误、禁用/非本地 backend 仍保持原边界。
4. memories/index.ts 与 memory protocol：实测 Windows 301 字符路径下 Bun.write 返回 ENOENT，node:fs.writeFile 成功。复用已有 node:fs 读写记忆产物和 learned 文件，显式建立必要父目录；不修改用户源码编码策略，不迁移已有记忆目录。
5. discovery/builtin.ts、helpers.ts：合并新版 home/temp/foreign-user 边界，双命名空间均检查；逐文件首选 .ompg、兼容 .omp、子项目优先和损坏配置 fail closed 保留。Git 根新注册表默认 .ompg，已有 .omp 项目继续识别。
6. catalog 与 RPC 冲突通过官方 gen:compat/gen:rpc 生成。eval/write 同时保留 fork 保护入口与上游当前审批接口，不整文件覆盖 ours/theirs。
7. 扩展 task 回归发现两个 agent 配置问题：config.ts 的原生 user base 重建默认路径，忽略 getAgentDir 的显式目录；task/discovery.ts 仅过滤 .omp，丢掉 .ompg。改为复用 getAgentDir 和双命名空间；项目 agent 按祖先距离优先、同根 .ompg 优先。新增真实发现的父 .ompg→子 .omp→同根 .ompg 状态转换；既有真实 mock-provider 的 structured 两分支从失败恢复通过（54/54，166 assertions，2 文件）。

## 4. 消费者回归与缓存边界

- 实际 createAgentSession：共享 Settings 指向其他 host 目录，系统提示词仍只含当前项目规则；摘要预算 8 时，长 learned 的开头和最后规则均存在。没有发真实模型请求。
- 实际 ReadTool：裸 root 和显式 summary 文件返回 pending；磁盘仍无摘要；生成后再次读取取得真实内容。
- 协议读取：超过 260 字符的真实摘要仍可读取，不误判 pending。后台固化用例同时覆盖 Windows 长路径写入。
- 既有缓存回归保留：会话首个请求后冻结提示词前缀，防止签名 thinking 重放失配；新 learn 在当前工具结果中可见，文件注入在下一会话采用；显式 memory clear 继续清理缓存。
- memories.enabled=false、memory.backend=off、工具限制会话和 SDK 显式 systemPrompt override 保持原有授权范围。完整 learned 注入会占用实际上下文，文件很大时需要用户维护规则规模，不静默截掉末尾规则。

## 5. #6 六类历史问题复核

| 问题 | 当前契约与现有回归 |
| --- | --- |
| 新 .py coding 声明冲突 | WriteTool 写前检查目标编码与源码声明，冲突拒绝，不写坏文件 |
| 项目外 GBK | 外部目标使用目标自身策略；无策略严格只读回退，不继承会话的写资格 |
| grep/read 不一致 | 同一编码解析与显式诊断；非法字节文件报告未搜索范围，不能伪报零结果 |
| blanket GBK 包含 UTF-8 | 保留双合法歧义提示和 auto 写前明确 override 要求；不凭猜测自动转换 |
| 子进程解码 | 输出来源、混合流、unknown reader 和替换数贯通；用户代码已经损失的 bytes 不可恢复 |
| 无 encoding.json | 默认可严格只读回退；encoding init 创建 .ompg 配置、doctor 查看实际来源，写入仍须明确策略 |

GB18030 不支持；旧报告中外部 Python 可解码不构成本产品支持证明。保护模式不是操作系统沙箱。

## 6. 验证记录与交付约束

当前已完成：native 官方优化构建（146 exports，既有链接 warning）；首轮完整 bun check 退出 0；最终 native 下 GBK+ptree 173 pass、591 assertions；记忆相关 98 pass、281 assertions；配置发现/协议扩展套件 269 pass、2 平台 skip、9 symlink EPERM 阻塞。后者不记通过，不改权限、不换链接类型、不删用例。

Rust 最终结果 3221 passed / 4 skipped、doctest 1 passed，退出 0。native SHA256 为 6963b1cedbbc9aeb981160c249f6869863939017ff65af09322b8d1bd5b96e6c。扩大 task/stats/审批/Gemini/KDL 回归的首轮结果为 686 pass / 2 skip / 3 fail，其中 2 个是真实 agent 目录缺口（已修），1 个是 symlink EPERM。记录首次失败，不用后续结果覆盖历史。

源码定稿最终检查：bun check 退出 0；记忆+配置发现整合为 325 pass / 2 平台 skip / 9 symlink EPERM、962 assertions、37 文件；task/stats/审批/Gemini/KDL 为 689 pass / 2 skip / 1 symlink EPERM、3065 assertions、64 文件。最后一项 symlink 位于 task/worktree，和前九项不同，共十项阻塞，均不能记通过。套件存在重叠，不相加为唯一总数。

编译 EXE、源码提交、发布和下载校验结果追加本记录或独立交付记录。未完成前不称已经发布或关闭 issue。Unix 实机、真实模型遵循度、herdr GUI、E630 和性能比较仍未验证。
