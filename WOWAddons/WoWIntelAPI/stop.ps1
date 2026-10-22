$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot 'server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Output 'No managed background service PID file. Use Ctrl+C in its terminal.'
    exit 0
}
$serviceId = [int](Get-Content -LiteralPath $pidPath -Raw)
$serverPath = Join-Path $PSScriptRoot 'server.py'
$serviceInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceId"
if (-not $serviceInfo) {
    Write-Output 'Service is already stopped.'
    exit 0
}
if ($serviceInfo.Name -notmatch '^python(?:w|\d+(?:\.\d+)*)?\.exe$' -or -not $serviceInfo.CommandLine.Contains($serverPath)) {
    throw 'PID belongs to a different process. Refusing to stop it.'
}
Stop-Process -Id $serviceId
Write-Output 'WoWIntelAPI stopped.'
