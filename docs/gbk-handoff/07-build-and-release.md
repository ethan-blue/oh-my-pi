# 07 — P14—P16：构建、安装、GitHub Release 发布

本章是实现完成后的执行说明。当前没有 GBK 二进制，也没有可上传的功能版本。不得把上游原版程序改名后宣称 GBK 已支持。

发布目标固定为 `ethan-blue/oh-my-pi`。首版只交付实际验证过的 Windows x64 预发布版；稳定版需要通用验收和实际 E630 验收完成。

## P14｜可追溯的 Windows x64 构建（P0；依赖 P10—P13）

**目标：**从已验收的 Fork commit 构建真实 GBK native addon 和程序，不依赖开发机旧缓存。

**范围：**`scripts/bazel-natives.ts`、`packages/natives/scripts/build-bindings.ts`、`packages/natives/scripts/embed-native.ts`、`packages/coding-agent/scripts/compile-binary.ts`、`scripts/ci-release-build-binaries.ts`。

**步骤：**

1. 完成代码 review，逐文件暂存本任务变更，不用 `git add -A` 把用户其他工作、日志和私有 fixture 混入提交。
2. 在用户已授权发布的执行会话中，将经过验证的代码提交到 Fork 分支，记录完整 SHA；不发布脏工作区构建，不把未提交代码打包冒充 tag 对应产物。
3. 准备独立干净构建 checkout，固定 Bun、Rust、lockfile、native ABI/版本、Fork 版本；保持整个构建在同一源码 SHA。
4. 执行 frozen install，源码构建 native，运行强制 Rust gate、TS gate、GBK gate；检查所有命令退出码与实际测试输出。
5. 调用已有编译入口生成 Windows x64 二进制。若使用下方 release builder，它的默认行为会构建全部平台，必须显式限制 target。
6. 完成后复核生成器是否遗留受跟踪文件改动；不得使用全仓 `git restore` 随意抹除，逐个分析。
7. 将实际生成的 `omp-windows-x64.exe` 复制为分发目录里的 `ompg.exe`；Fork 身份必须已经在源码/构建元数据中实现，重命名不是身份实现。
8. 运行成品版本/帮助/功能测试，断开对开发树与旧 native 缓存的依赖后再验一次。

**验收：**编译产物加载同 SHA 构建的 GBK addon，read/edit/write 字节测试在成品上通过；构建元数据可追溯到唯一 commit。

**失败处理：**缺少 native 构建、只编译 TS、误嵌官方 addon、签名/打包/测试失败都不能上传为完成版本；保留构建日志和失败 stage。

### 已有构建命令（环境准备完成后）

以下均在仓库根目录运行。Shell 会话中的环境变量改动要在 finally 中恢复。锁文件变更必须独立审查，不以解除 frozen 模式掩盖依赖漂移。

```powershell
bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }

bun run build:native
if ($LASTEXITCODE -ne 0) { throw 'Native source build failed' }

# 在发布 checkout 强制 Rust 检查/测试，防止干净树被跳过。
$savedCi = $env:CI
try {
    $env:CI = '1'
    bun check
    if ($LASTEXITCODE -ne 0) { throw 'Repository checks failed' }
    bun run test:rs
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
} finally {
    if ($null -eq $savedCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue }
    else { $env:CI = $savedCi }
}

bun scripts/ci-release-build-binaries.ts --targets win32-x64
if ($LASTEXITCODE -ne 0) { throw 'Windows binary build failed' }

$binary = Join-Path (Get-Location) 'packages\coding-agent\binaries\omp-windows-x64.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw 'Binary missing' }
& $binary --version
if ($LASTEXITCODE -ne 0) { throw 'Binary version probe failed' }
& $binary --help
if ($LASTEXITCODE -ne 0) { throw 'Binary help probe failed' }
```

以上不是完整验收脚本：GBK 工具测试、隔离配置根、native 来源验证和 smoke 证据仍必须按 P12 执行。`--smoke-test` 涉及 worker/依赖，先确认下载和缓存行为，在隔离目录运行；不能把 `--version` 当作功能验收。

### 成品内容合同

拟定 ZIP：`ompg-18.8.4-gbk.1-windows-x64.zip`。只打包白名单文件：

| 文件 | 要求 |
| --- | --- |
| `ompg.exe` | 当前 commit 编译的可执行程序，内嵌正确 native |
| `install-ompg.ps1` | Fork 专用安装器，P15 实现，不覆盖原版 |
| `README.zh-CN.md` | 安装、首次配置、GBK 范围、已知限制、卸载与回滚 |
| `encoding.example.json` | 与实际 schema 一致，明确示例路径须调整 |
| `build-info.json` | Fork/baseVersion、完整 SHA、平台、Bun/Rust/native 身份 |
| `LICENSE`、`THIRD-PARTY-NOTICES.txt` | 保留许可与所需声明 |

ZIP 外提供 `SHA256SUMS.txt`、`RELEASE_NOTES.md`、脱敏 `VALIDATION.md` 和兼容性说明。校验和不要包含它自身的哈希；写入纯文件名而非开发机绝对路径。

不要上传 node_modules、源码缓存、.git、真实配置/凭据、用户工程、私有 fixture 或包含源码片段的原始日志。选用公开合成测试结果。

Windows 签名若未配置，明确记录未签名，不伪造签名/SmartScreen 验证通过。首版是否签名与编码正确性分开记录。

## P15｜安装、干净运行与回滚（P0；依赖 P14）

**目标：**用户拿到 ZIP 后可实际使用，并可撤回，不依赖开发机工具链。

**范围：**Fork 安装器/卸载器（拟新增），P10/P11 的命令、配置、native 和更新策略。

**步骤：**

1. 安装到版本目录，例如 `%LOCALAPPDATA%\ompg\versions\18.8.4-gbk.1`，稳定启动入口指向当前版本。
2. 校验 ZIP 和 exe hash、架构、版本、Fork 身份；将完成标记写在所有文件准备完成之后。
3. 默认只增加 `ompg` 命令入口；PATH 修改应幂等且可恢复，不覆盖既有 `omp.cmd`/`omp.exe`。
4. 首次启动展示如何启用工程编码策略；无配置时保持原行为，不自动遍历并转换用户目录。
5. 在不安装 Bun/Rust、不依赖开发仓库的 Windows 测试环境运行成品，验证 native 解压/加载、中文读写和 child。
6. 同时运行原版，检查它的命令路径、配置摘要和正常启动未改变。
7. 模拟更新中断、目标文件占用、坏 hash、权限不足；失败保持旧版本入口。
8. 验证回退到上一 Fork 版本；卸载只清理安装清单里的 Fork 文件，配置默认保留，不递归删除用户目录。

**验收：**干净安装→配置→GBK 编辑→重启→升级→回退→卸载全流程有日志；旧版 OMP 不受影响。

**失败处理：**不自动终止运行中的用户进程；需要退出程序的情况给出明确可恢复状态，不能静默替换另一目录的程序。

## P16｜GitHub Release 上传与发布后核验（P0；依赖 P15）

**目标：**用户能下载到与验收一致的版本，而不只是看到一个 Release 标题。

**范围：**个人 Fork tags/releases；Fork 专用 CI（拟新增）或已经通过本地验收的产物。

**步骤：**

1. 再次核对 `gh repo view ethan-blue/oh-my-pi`、分支和完整 SHA，确认不存在同名 tag/release。
2. 检查全部发布 blocker：字节损坏、陈旧编辑绕过、旧 native 混入、官方安装污染、错误 update 源、缺少 hash，任一个存在即不发布。
3. 生成 Release Notes：功能范围、原版兼容、安装说明、限制、完整 SHA、校验步骤、E630 实测状态。
4. 创建唯一 annotated tag，推送到个人 Fork。tag 指向的 commit 必须就是构建 commit；不复用官方 `v18.8.4`。
5. 先创建 draft prerelease 并上传确切白名单资产；对远端资产重新下载，逐项验证 hash、版本和基础运行。
6. 下载核验通过后才将 draft 设为公开 prerelease；首版不设为默认 latest stable。
7. 读取最终 Release 元数据，确认 draft=false、prerelease=true、tag、资产名/大小/下载链接正确。
8. 将 Release URL、tag→SHA、每个资产 hash 和安装/回滚说明交给用户。

**验收：**从 GitHub 下载的包完成验证，发布状态与说明相符；只创建 Release 对象不算完成。

**失败处理：**上传部分失败保留 draft；不要覆盖已有正式 tag 或 `--clobber` 已发布资产。核验失败不公开；已公开后发现问题按撤回/新版本处理并如实告知。

### 发布命令模板（全部 gate 通过后才执行）

以下使用 PowerShell 参数数组的普通调用方式，不拼接执行任意 shell 文本。`release-staging`、说明文件和 ZIP 均是 P14/P15 生成的目标，当前不存在。

```powershell
$releaseRepo = 'ethan-blue/oh-my-pi'
$releaseTag = 'v18.8.4-gbk.1'
$releaseSha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve release SHA' }
$releaseStatus = git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect release checkout' }
if ($releaseStatus) { throw 'Release checkout must be clean' }

# 先用 gh release view 和 git ls-remote 检查冲突；不可把网络失败当作不存在。
# 只有确认标签与 Release 均不存在后，才进入下面的创建步骤。
git tag -a $releaseTag $releaseSha -m "ompg $releaseTag"
if ($LASTEXITCODE -ne 0) { throw 'Tag creation failed' }
git push origin "refs/tags/$releaseTag"
if ($LASTEXITCODE -ne 0) { throw 'Tag push failed' }

$stage = Join-Path (Get-Location) 'release-staging'
$zip = Join-Path $stage 'ompg-18.8.4-gbk.1-windows-x64.zip'
$sums = Join-Path $stage 'SHA256SUMS.txt'
$notes = Join-Path $stage 'RELEASE_NOTES.md'
$validation = Join-Path $stage 'VALIDATION.md'
foreach ($file in @($zip, $sums, $notes, $validation)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing release file: $file" }
}

gh release create $releaseTag $zip $sums $validation --repo $releaseRepo --verify-tag --draft --prerelease --title "ompg $releaseTag (Windows x64)" --notes-file $notes
if ($LASTEXITCODE -ne 0) { throw 'Draft release upload failed' }

# 在独立空目录重新下载并核验所有资产；通过后才执行公开发布命令。
# gh release download $releaseTag --repo $releaseRepo --dir <独立核验目录>
# gh release edit $releaseTag --repo $releaseRepo --draft=false --prerelease --latest=false
# gh release view $releaseTag --repo $releaseRepo --json url,tagName,isDraft,isPrerelease,assets
```

执行时将注释中的核验目录替换为明确、实际存在的路径；不把尖括号占位符直接复制执行。GitHub CLI 版本不同可能影响参数，先查本机 help。

用户指令若仅要求编写交接材料，不在文档制作阶段执行本节 mutations。若接手会话明确要求实施并发布，必要的本任务 commit/tag/push 属于发布流程，不应在每一步重复索取相同授权；仍须遵守运行环境的审批策略。

## 1. Fork CI 设计要求

上游 `.github/workflows/ci.yml` 依赖 `omp-kata` runner、上游缓存和 npm 发布凭据，不能直接假定个人 Fork 能运行完整流水线。

拟新增 `.github/workflows/gbk-windows-release.yml`，实现时要求：

- 只在本 Fork 的手动 dispatch 或明确的 GBK tag 上触发，普通 PR 不发布。
- build/test 使用可用 Windows runner，固定工具链并实际构建 native，不拿官方最新 npm addon 代替。
- 缓存键含系统、架构、工具链、lockfile、Rust 源码/ABI 输入；缓存命中后仍验证身份。
- read-only 默认权限；只有 publish job 获得 `contents: write`，且依赖全部验证任务。
- 禁止将 `pull_request_target` 与不可信 PR 代码和发布凭据混用。
- 不发布 `@oh-my-pi/*` npm 包，不访问上游签名秘密，不依赖别人的 self-hosted runner。
- 产物 manifest、checksum、测试记录与同一 commit 绑定；复跑不得覆盖已公开的不同 bytes。

本章没有创建 workflow。接手 AI 必须实现并实际运行，才能把 CI 状态记为通过。
