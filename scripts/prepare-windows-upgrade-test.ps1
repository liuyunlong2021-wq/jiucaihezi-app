param([Parameter(Mandatory=$true)][string]$TestExe, [Parameter(Mandatory=$true)][string]$InstalledExe)
$ErrorActionPreference = 'Stop'
# Tauri 只给正式 bin 链接清单，lib 单元测试缺少 Common Controls v6。
# 复用真实旧 App 的清单；只修改隔离测试宿主，不修改安装目录或发布包。
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$mt = Get-ChildItem $sdk -Directory | Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\mt.exe' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $mt) { throw 'Windows SDK mt.exe is required for the native test host' }
$manifest = [System.IO.Path]::GetTempFileName()
try {
    & $mt -nologo "-inputresource:$InstalledExe;#1" "-out:$manifest"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the baseline App manifest' }
    $xml = Get-Content $manifest -Raw
    if ($xml -notmatch 'Microsoft.Windows.Common-Controls' -or $xml -notmatch '6.0.0.0') {
        throw 'Baseline App manifest does not activate Common Controls v6'
    }
    & $mt -nologo -manifest $manifest "-outputresource:$TestExe;#1"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot embed the manifest into the isolated test host' }
    Write-Host 'Embedded baseline Common Controls v6 manifest into isolated test host'
} finally {
    Remove-Item $manifest -ErrorAction SilentlyContinue
}
