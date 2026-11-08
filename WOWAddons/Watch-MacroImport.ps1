param(
    [ValidateSet('retail', 'forever')][string]$Game = 'retail',
    [ValidateRange(1, 3600)][int]$DurationSeconds = 240,
    [ValidateRange(100, 5000)][int]$PollMilliseconds = 250
)

$ErrorActionPreference = 'Stop'
$gamePort = if ($Game -eq 'retail') { 18765 } else { 18766 }
$statusUrl = "http://127.0.0.1:$gamePort/api/status"
$logDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory "macro-import-observe-$Game-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').jsonl"
$writer = [System.IO.StreamWriter]::new($logPath, $false, [System.Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
$timer = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "Read-only observation: $statusUrl"
Write-Host "Log: $logPath"
Write-Host "Switch to Warcraft and reproduce the import. Ctrl+C stops observation."

try {
    while ($timer.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $sample = [ordered]@{ observedAt = [DateTimeOffset]::Now.ToString('o'); game = $Game }
        try {
            $status = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 2
            $sample.status = $status.status
            $sample.source = $status.source
            $sample.ageSeconds = $status.ageSeconds
            $sample.bridgeError = $status.error
            $sample.online = $status.snapshot.online
            $sample.combat = $status.snapshot.combat
            $sample.dead = $status.snapshot.dead
            $sample.receipt = $status.macroImport
        }
        catch {
            $sample.readError = $_.Exception.Message
        }
        # The receipt contains state and content hashes, not the macro body or character equipment.
        $writer.WriteLine(($sample | ConvertTo-Json -Depth 8 -Compress))
        Start-Sleep -Milliseconds $PollMilliseconds
    }
}
finally {
    $timer.Stop()
    $writer.Dispose()
    Write-Host "Observation finished: $logPath"
}
