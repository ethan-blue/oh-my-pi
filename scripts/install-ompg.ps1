# ompg (GBK fork of OMP Coding Agent) installer for Windows.
#
# Installs a versioned copy of ompg.exe under %LOCALAPPDATA%\ompg and a stable
# launcher that points at the newest installed version. Never touches an
# existing `omp` installation, its PATH entries, or its data (~/.omp); this
# fork keeps its own data root (~/.ompg) and native cache.
#
# Usage:
#   .\install-ompg.ps1                       # install from the files next to this script
#   .\install-ompg.ps1 -Version 18.8.4-gbk.1 -Download   # fetch the release archive from GitHub
#   .\install-ompg.ps1 -Uninstall            # remove ompg only (data in ~\.ompg is kept)
#
# Requires: PowerShell 5.1+. The binary distribution needs neither Bun nor Rust.

param(
    [string]$Version,
    [switch]$Download,
    [switch]$Uninstall,
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion -lt [version]"5.1") {
    throw "Windows PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion))."
}

$Repo = "ethan-blue/oh-my-pi"

$Root = if ($InstallDir) { $InstallDir } elseif ($env:OMPG_INSTALL_DIR) { $env:OMPG_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "ompg" }
$VersionsDir = Join-Path $Root "versions"

function Write-Step { param([string]$Message) Write-Host "[ompg] $Message" }

function Remove-PathEntry {
    param([string]$Entry)
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { return }
    $parts = $userPath.Split(";") | Where-Object { $_ -and ($_.TrimEnd("\") -ine $Entry.TrimEnd("\")) }
    [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
}

if ($Uninstall) {
    Write-Step "Removing ompg from $Root"
    if (Test-Path -LiteralPath $Root) {
        # A running ompg.exe cannot be deleted; report and let the user retry.
        try {
            Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction Stop
        } catch {
            throw "Could not remove $Root (is ompg still running?). Close ompg windows and re-run. Original `omp` and ~\.ompg data were not touched."
        }
    }
    Remove-PathEntry -Entry $Root
    Write-Step "Uninstalled. User data (~\.ompg) and the original omp installation were left untouched; delete ~\.ompg manually to remove sessions and caches."
    exit 0
}

if ($Download) {
    if (-not $Version) { throw "-Download requires -Version (e.g. 18.8.4-gbk.1)." }
    $RawArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $NativeArchitecture = switch ($RawArchitecture.ToUpperInvariant()) {
        "AMD64" { "x64" }
        default { throw "Unsupported Windows architecture for the ompg release: $RawArchitecture (x64 only)." }
    }
    $tag = "v$Version"
    $archiveName = "ompg-$Version-windows-$NativeArchitecture.zip"
    $sumsName = "SHA256SUMS.txt"
    $work = Join-Path ([System.IO.Path]::GetTempPath()) "ompg-install-$Version"
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    foreach ($name in @($archiveName, $sumsName)) {
        $url = "https://github.com/$Repo/releases/download/$tag/$name"
        Write-Step "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile (Join-Path $work $name) -UseBasicParsing
    }
    $sumsPath = Join-Path $work $sumsName
    $expected = (Get-Content $sumsPath | Where-Object { $_ -match [regex]::Escape($archiveName) }) -replace '^\s*([0-9A-Fa-f]+).*$', '$1'
    if (-not $expected) { throw "SHA256SUMS.txt has no entry for $archiveName." }
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $work $archiveName)).Hash
    if ($actual -ine $expected) { throw "Checksum mismatch for ${archiveName}: expected $expected, got $actual." }
    Write-Step "Checksum verified"
    Expand-Archive -Path (Join-Path $work $archiveName) -DestinationPath $work -Force
    $PSScriptRootForFiles = $work
} else {
    # Install from the files sitting next to this script (the release archive layout).
    $PSScriptRootForFiles = $PSScriptRoot
    if (-not $PSScriptRoot) { $PSScriptRootForFiles = Split-Path -Parent $MyInvocation.MyCommand.Path }
}

$exeSource = Join-Path $PSScriptRootForFiles "ompg.exe"
if (-not (Test-Path -LiteralPath $exeSource)) { throw "ompg.exe not found next to install-ompg.ps1 (looked in $PSScriptRootForFiles). Use -Download to fetch a release." }

# Version: prefer the binary's own report — the installer must never guess.
$detected = & $exeSource --version 2>$null
if ($LASTEXITCODE -ne 0 -or -not $detected) { throw "Could not read the version from the shipped ompg.exe." }
$binaryVersion = ($detected | Select-Object -First 1).Trim()
if ($binaryVersion -notmatch '^ompg/[\w.\-]+$') { throw "Unexpected version output: $binaryVersion" }
$shortVersion = $binaryVersion.Substring("ompg/".Length)
if ($Version -and $Version -ne $shortVersion) {
    throw "Version mismatch: -Version said $Version but the binary reports $shortVersion."
}

# Optional checksum verification when SHA256SUMS.txt ships alongside.
$sumsLocal = Join-Path $PSScriptRootForFiles "SHA256SUMS.txt"
if (Test-Path -LiteralPath $sumsLocal) {
    $row = Get-Content $sumsLocal | Where-Object { $_ -match '(^|[/\\])ompg\.exe$' } | Select-Object -First 1
    if ($row) {
        $expectedExe = $row -replace '^\s*([0-9A-Fa-f]+).*$', '$1'
        $actualExe = (Get-FileHash -Algorithm SHA256 $exeSource).Hash
        if ($actualExe -ine $expectedExe) { throw "Checksum mismatch for ompg.exe: expected $expectedExe, got $actualExe." }
        Write-Step "ompg.exe checksum verified"
    }
}

$versionDir = Join-Path $VersionsDir $shortVersion
New-Item -ItemType Directory -Force -Path $versionDir | Out-Null
Copy-Item -LiteralPath $exeSource -Destination (Join-Path $versionDir "ompg.exe") -Force
Write-Step "Installed ompg $shortVersion to $versionDir"

# Stable launchers at the root: a .cmd shim plus a hardlink when the volume
# allows one. Both are replaced atomically-ish (write temp, move into place).
$targetExe = Join-Path $versionDir "ompg.exe"
$cmdPath = Join-Path $Root "ompg.cmd"
$tmpCmd = "$cmdPath.tmp"
@"
@echo off
setlocal
set "OMPG_HOME=$Root"
"%~dp0versions\$shortVersion\ompg.exe" %*
"@ | Set-Content -LiteralPath $tmpCmd -Encoding ASCII
Move-Item -LiteralPath $tmpCmd -Destination $cmdPath -Force
$rootExe = Join-Path $Root "ompg.exe"
if (Test-Path -LiteralPath $rootExe) { Remove-Item -LiteralPath $rootExe -Force -ErrorAction SilentlyContinue }
try {
    New-Item -ItemType HardLink -Path $rootExe -Target $targetExe -ErrorAction Stop | Out-Null
} catch {
    # Hardlinks can fail across volumes or on some filesystems; the .cmd shim
    # above remains the supported entry point either way.
    Write-Step "Hardlink unavailable; ompg.cmd is the launcher"
}

# PATH (user scope, idempotent, never touching other entries).
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
$already = $userPath.Split(";") | Where-Object { $_ -and ($_.TrimEnd("\") -ieq $Root.TrimEnd("\")) }
if (-not $already) {
    [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $Root).TrimStart(";"), "User")
    Write-Step "Added $Root to the user PATH"
} else {
    Write-Step "$Root already on PATH"
}

# Completion marker, written only after every file landed.
@{ version = $shortVersion; repo = $Repo; installedAt = (Get-Date).ToString("o") } | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $versionDir "install.json") -Encoding UTF8

Write-Step "Done. Start a new terminal and run: ompg --version"
Write-Step "To enable GBK for a project, create .omp\encoding.json there (see encoding.example.json in the release archive)."
