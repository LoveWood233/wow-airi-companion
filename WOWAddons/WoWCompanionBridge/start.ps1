param([int]$Port = 18765, [switch]$Demo)
$ErrorActionPreference = 'Stop'
$bridgeRoot = $PSScriptRoot
$bridgeScript = Join-Path $bridgeRoot 'server.py'
$bridgePidFile = Join-Path $bridgeRoot 'bridge.pid'
if (Test-Path -LiteralPath $bridgePidFile) {
    $existingPid = [int](Get-Content -LiteralPath $bridgePidFile -Raw)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$existingPid" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -and $existing.CommandLine.Contains($bridgeScript)) {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
        if ($health.service -ne 'wow-companion-bridge' -or $health.protocol -ne 'WCP1') { throw 'Port is not serving this bridge protocol.' }
        Write-Output "Bridge already running (PID $existingPid). http://127.0.0.1:$Port/"
        exit 0
    }
}
$python = (Get-Command python -ErrorAction Stop).Source
$bridgeArguments = @('"' + $bridgeScript + '"', '--port', "$Port")
if ($Demo) { $bridgeArguments += '--demo' }
$bridgeProcess = Start-Process -FilePath $python -ArgumentList $bridgeArguments -WorkingDirectory $bridgeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $bridgeRoot 'bridge.stdout.log') -RedirectStandardError (Join-Path $bridgeRoot 'bridge.stderr.log')
Set-Content -LiteralPath $bridgePidFile -Value $bridgeProcess.Id -Encoding ascii
Start-Sleep -Milliseconds 700
$bridgeProcess.Refresh()
if ($bridgeProcess.HasExited) { throw 'Bridge exited during startup. Inspect bridge.stderr.log.' }
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
if ($health.service -ne 'wow-companion-bridge' -or $health.protocol -ne 'WCP1') { throw 'Health check did not identify this bridge.' }
Write-Output "Bridge started (PID $($bridgeProcess.Id)). http://127.0.0.1:$Port/"
