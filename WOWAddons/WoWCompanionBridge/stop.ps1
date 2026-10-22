$ErrorActionPreference = 'Stop'
$bridgePidFile = Join-Path $PSScriptRoot 'bridge.pid'
$bridgeScript = Join-Path $PSScriptRoot 'server.py'
if (-not (Test-Path -LiteralPath $bridgePidFile)) { Write-Output 'No bridge PID file.'; exit 0 }
$bridgeProcessId = [int](Get-Content -LiteralPath $bridgePidFile -Raw)
$bridgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgeProcessId" -ErrorAction SilentlyContinue
if ($bridgeProcess) {
    if (-not $bridgeProcess.CommandLine -or -not $bridgeProcess.CommandLine.Contains($bridgeScript)) { throw 'PID no longer belongs to this bridge. Refusing to stop another process.' }
    Stop-Process -Id $bridgeProcessId
}
Remove-Item -LiteralPath $bridgePidFile
Write-Output 'Bridge stopped.'
