param([string]$ReleaseExe, [string]$PreviousExe)
$ErrorActionPreference = 'Stop'
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('ompg-installer-test-' + [guid]::NewGuid().ToString('N'))
$installer = Join-Path $PSScriptRoot 'install-ompg.ps1'
$originalOmp = Join-Path $env:LOCALAPPDATA 'omp\omp.exe'
$originalHash = if (Test-Path -LiteralPath $originalOmp) { (Get-FileHash -LiteralPath $originalOmp).Hash } else { $null }
$originalPath = [Environment]::GetEnvironmentVariable('Path', 'User')
New-Item -ItemType Directory -Path $sandbox | Out-Null
function Assert-Equal($actual, $expected, $label) {
    if ($actual -ne $expected) { throw "${label}: expected [$expected], got [$actual]" }
}
function Invoke-Installer($source, $root, [string[]]$extra = @(), [bool]$expectFailure = $false) {
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $source 'install-ompg.ps1') -InstallDir $root -NoPath @extra 2>&1
    $ErrorActionPreference = 'Stop'
    if (($LASTEXITCODE -ne 0) -ne $expectFailure) { throw "Unexpected installer result: $output" }
}
try {
    $parseErrors = $null; $tokens = $null
    [void][Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$parseErrors)
    Assert-Equal $parseErrors.Count 0 'PowerShell parse'
    $packages = @()
    foreach ($version in @('0.0.1-test', '0.0.2-test', '0.0.1-test')) {
        $package = Join-Path $sandbox ($packages.Count.ToString() + '-' + $version)
        New-Item -ItemType Directory -Path $package | Out-Null
        Copy-Item -LiteralPath $installer -Destination $package
        $class = 'Probe' + [guid]::NewGuid().ToString('N')
        $source = 'public class ' + $class + ' { public static void Main() { System.Console.WriteLine("ompg/' + $version + '"); } }'
        Add-Type -TypeDefinition $source -OutputAssembly (Join-Path $package 'ompg.exe') -OutputType ConsoleApplication
        $hash = (Get-FileHash -LiteralPath (Join-Path $package 'ompg.exe')).Hash
        "$hash  ompg.exe" | Set-Content -LiteralPath (Join-Path $package 'SHA256SUMS.txt') -Encoding ASCII
        $packages += $package
    }
    $root = Join-Path $sandbox 'installation'
    Invoke-Installer $packages[0] $root
    Assert-Equal (& (Join-Path $root 'ompg.exe') --version) 'ompg/0.0.1-test' 'initial install'
    Invoke-Installer $packages[1] $root
    Assert-Equal (& (Join-Path $root 'ompg.exe') --version) 'ompg/0.0.2-test' 'upgrade'
    Assert-Equal (& (Join-Path $root 'versions\0.0.1-test\ompg.exe') --version) 'ompg/0.0.1-test' 'old version preserved'
    Invoke-Installer $packages[0] $root
    Assert-Equal (& (Join-Path $root 'ompg.exe') --version) 'ompg/0.0.1-test' 'rollback'
    Invoke-Installer $packages[2] $root @() $true
    Assert-Equal (Get-FileHash -LiteralPath (Join-Path $root 'ompg.exe')).Hash (Get-FileHash -LiteralPath (Join-Path $packages[0] 'ompg.exe')).Hash 'same-version different bytes rejected'
    ('0' * 64 + '  ompg.exe') | Set-Content -LiteralPath (Join-Path $packages[1] 'SHA256SUMS.txt') -Encoding ASCII
    Invoke-Installer $packages[1] $root @() $true
    Assert-Equal (& (Join-Path $root 'ompg.exe') --version) 'ompg/0.0.1-test' 'checksum failure preserves active version'
    'keep me' | Set-Content -LiteralPath (Join-Path $root 'versions\0.0.1-test\user.txt')
    $unknown = Join-Path $root 'versions\unmanaged'
    New-Item -ItemType Directory -Path $unknown | Out-Null
    'untouched' | Set-Content -LiteralPath (Join-Path $unknown 'data.txt')
    Invoke-Installer $packages[0] $root @('-Uninstall')
    Assert-Equal (Test-Path -LiteralPath (Join-Path $root 'ompg.exe')) $false 'uninstall launcher'
    Assert-Equal (Get-Content -LiteralPath (Join-Path $root 'versions\0.0.1-test\user.txt')) 'keep me' 'owned directory user file preserved'
    Assert-Equal (Get-Content -LiteralPath (Join-Path $unknown 'data.txt')) 'untouched' 'unmanaged version preserved'
    if ($ReleaseExe) {
        $package = Join-Path $sandbox 'real-release'
        New-Item -ItemType Directory -Path $package | Out-Null
        Copy-Item -LiteralPath $installer -Destination $package
        Copy-Item -LiteralPath $ReleaseExe -Destination (Join-Path $package 'ompg.exe')
        $releaseRoot = Join-Path $sandbox 'real-install'
        if ($PreviousExe) {
            $oldPackage = Join-Path $sandbox 'previous-release'
            New-Item -ItemType Directory -Path $oldPackage | Out-Null
            Copy-Item -LiteralPath $installer -Destination $oldPackage
            Copy-Item -LiteralPath $PreviousExe -Destination (Join-Path $oldPackage 'ompg.exe')
            Invoke-Installer $oldPackage $releaseRoot
            Assert-Equal (Get-FileHash -LiteralPath (Join-Path $releaseRoot 'ompg.exe')).Hash (Get-FileHash -LiteralPath $PreviousExe).Hash 'previous release bytes'
        }
        Invoke-Installer $package $releaseRoot
        Assert-Equal (Get-FileHash -LiteralPath (Join-Path $releaseRoot 'ompg.exe')).Hash (Get-FileHash -LiteralPath $ReleaseExe).Hash 'real release installed bytes'
        if ($PreviousExe) {
            Invoke-Installer $oldPackage $releaseRoot
            Assert-Equal (Get-FileHash -LiteralPath (Join-Path $releaseRoot 'ompg.exe')).Hash (Get-FileHash -LiteralPath $PreviousExe).Hash 'real release rollback bytes'
        }
        Invoke-Installer $package $releaseRoot @('-Uninstall')
    }
    Assert-Equal ([Environment]::GetEnvironmentVariable('Path', 'User')) $originalPath 'user PATH unchanged'
    if ($originalHash) { Assert-Equal (Get-FileHash -LiteralPath $originalOmp).Hash $originalHash 'original omp unchanged' }
    Write-Output 'PASS: parse, install, upgrade, rollback, checksum rejection, conservative uninstall, original omp/PATH preservation'
} finally {
    $resolvedSandbox = [IO.Path]::GetFullPath($sandbox)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedSandbox.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedSandbox) -notlike 'ompg-installer-test-*') { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolvedSandbox -Recurse -Force
}
