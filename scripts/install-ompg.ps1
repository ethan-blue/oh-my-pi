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
    # Ownership validation BEFORE anything is deleted: the root must look
    # like an ompg install (a versions\<ver>\install.json marker naming this
    # fork), must not be a dangerous location, and only files this installer
    # created are removed — never a blind recursive delete of the root.
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root)
    $dangerous = @(
        $env:USERPROFILE,
        $env:LOCALAPPDATA,
        $env:TEMP,
        $env:SystemRoot,
        $env:ProgramFiles
    ) | Where-Object { $_ }
    foreach ($danger in $dangerous) {
        if ($normalizedRoot -ieq [System.IO.Path]::GetFullPath($danger)) {
            throw "Refusing to uninstall from $Root: it is a system/user root, not an ompg install directory."
        }
    }
    if ($normalizedRoot -ieq [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "omp"))) {
        throw "Refusing to uninstall: $Root is the ORIGINAL omp install directory; ompg never touches it."
    }
    $markers = @()
    if (Test-Path -LiteralPath (Join-Path $Root "versions"))) {
        $markers = Get-ChildItem -LiteralPath (Join-Path $Root "versions") -Filter "install.json" -Recurse -ErrorAction SilentlyContinue
    }
    $owned = @($markers | Where-Object {
        try {
            (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).repository -eq $Repo
        } catch { $false }
    })
    if ($owned.Count -eq 0) {
        throw "Refusing to uninstall $Root: no ompg install marker found (versions\<version>\install.json naming $Repo). Not an ompg-managed directory; nothing was deleted."
    }
    Write-Step "Uninstall verified: $($owned.Count) ompg install marker(s) in $Root"

    $removed = @()
    foreach ($entry in @("ompg.cmd", "ompg.exe")) {
        $target = Join-Path $Root $entry
        if (Test-Path -LiteralPath $Target) {
            Remove-Item -LiteralPath $Target -Force -ErrorAction Stop
            $removed += $entry
        }
    }
    try {
            Remove-Item -LiteralPath (Join-Path $Root "versions") -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Step "Could not fully remove versions\ (is ompg still running?); re-run the uninstaller after closing ompg."
        }
    # Report anything else the installer never created instead of deleting it.
    $known = @("ompg.cmd", "ompg.exe", "versions")
    $leftovers = @(Get-ChildItem -LiteralPath $Root -Force -ErrorAction SilentlyContinue | Where-Object { $known -notcontains $_.Name })
    if ($Leftovers.Count -gt 0) {
            Write-Step "Kept $($Leftovers.Count) file(s) this installer did not create: $($Leftovers.Name -join ', ')"
        }
    Remove-PathEntry -Entry $Root
    Write-Step "Uninstalled (removed: $($removed -join ', ')). User data (~\.ompg) and the original omp installation were left untouched; delete ~\.ompg manually to remove sessions and caches."
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
    # Release archives carry a top-level version directory
    # (ompg-<version>-windows-x64\ompg.exe); fall back to a flat layout so
    # both shapes install. Point the file source at whichever holds ompg.exe.
    if (Test-Path -LiteralPath (Join-Path $work "ompg.exe")) {
        $PSScriptRootForFiles = $work
    } else {
        $nested = Get-ChildItem -LiteralPath $work -Directory |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "ompg.exe") } |
            Select-Object -First 1
        if ($nested) { $PSScriptRootForFiles = $nested.FullName }
        else { throw "Extracted archive has no ompg.exe under $work." }
    }
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
