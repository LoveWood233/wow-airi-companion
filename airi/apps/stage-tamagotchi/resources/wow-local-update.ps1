<#
Runs a prepared local update after the current app exits. Both app folders stay intact.

Call stack:
  Electron local update action
    -> wow-local-update.ps1
      -> new app readiness acknowledgment
      -> previous app with cold-restore journal on failure
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$JobPath,
  [ValidateRange(1, 300)][int]$ParentWaitSeconds = 60,
  [ValidateRange(1, 300)][int]$ReadyWaitSeconds = 90,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$job = $null
$resultPath = $null
$newProcess = $null
$newProcessStart = $null
$trustedJob = $false
$parentExited = $false

function Full-Path([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^([a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)') {
    throw 'update-invalid-path'
  }
  return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Same-Path([string]$Left, [string]$Right) {
  return [string]::Equals((Full-Path $Left), (Full-Path $Right), [StringComparison]::OrdinalIgnoreCase)
}

# Check every existing ancestor. A link must not redirect a prepared job or its rollback files.
function Assert-PlainPath([string]$Path, [bool]$Required = $true, [bool]$Directory = $false) {
  $absolute = Full-Path $Path
  $current = $absolute
  $first = $true
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'update-linked-path' }
      if ($first -and ($item.PSIsContainer -ne $Directory)) { throw 'update-invalid-file' }
      if (-not $first -and -not $item.PSIsContainer) { throw 'update-invalid-parent' }
    }
    elseif ($first -and $Required) { throw 'update-file-missing' }
    $first = $false
    $parent = [IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
  return $absolute
}

function Read-JsonFile([string]$Path, [long]$Limit = 65536) {
  $absolute = Assert-PlainPath $Path
  if ((Get-Item -LiteralPath $absolute).Length -gt $Limit) { throw 'update-file-too-large' }
  return ([IO.File]::ReadAllText($absolute, [Text.Encoding]::UTF8) | ConvertFrom-Json)
}

# The temporary file is synced before replacing a fixed result or restore-journal path.
function Write-AtomicText([string]$Path, [string]$Text, [bool]$CreateOnly = $false) {
  $absolute = Assert-PlainPath $Path $false
  $parent = Assert-PlainPath ([IO.Path]::GetDirectoryName($absolute)) $true $true
  $temporary = Join-Path $parent ('.update-' + [Guid]::NewGuid().ToString('D') + '.tmp')
  try {
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Text)
    $stream = New-Object IO.FileStream($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    }
    finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $absolute) {
      if ($CreateOnly) { throw 'update-restore-conflict' }
      [IO.File]::Replace($temporary, $absolute, $null)
    }
    else { [IO.File]::Move($temporary, $absolute) }
  }
  finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Write-Result([string]$Outcome) {
  $result = @{ id = $job.id; outcome = $Outcome; checkpoint = $job.checkpoint; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  Write-AtomicText $resultPath ($result | ConvertTo-Json -Compress)
}

function Stop-OwnedNewProcess {
  if (-not $newProcess) { return }
  $current = Get-Process -Id $newProcess.Id -ErrorAction SilentlyContinue
  if ($current) {
    if (-not $newProcessStart -or $current.StartTime.ToUniversalTime().Ticks -ne $newProcessStart) {
      $newProcess.Refresh()
      if (-not $newProcess.HasExited) { throw 'update-process-identity-lost' }
      return
    }
    Stop-Process -InputObject $current -Force
    if (-not $current.WaitForExit(10000)) { throw 'update-process-still-running' }
  }
}

try {
  $job = Read-JsonFile (Full-Path $JobPath)
  $fields = @($job.PSObject.Properties.Name)
  $required = @('id', 'parentPid', 'oldExecutable', 'newExecutable', 'userData', 'checkpoint', 'rollbackJournal')
  foreach ($field in $required) {
    if ($fields -notcontains $field) { throw 'update-invalid-job' }
  }
  foreach ($field in $fields) {
    if ($required -notcontains $field -and $field -ne 'targetVersion') { throw 'update-invalid-job' }
  }
  if ($job.id -isnot [string] -or $job.id -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'update-invalid-job' }
  if (($job.parentPid -isnot [int] -and $job.parentPid -isnot [long]) -or $job.parentPid -lt 1 -or $job.parentPid -gt [int]::MaxValue -or $job.parentPid -eq $PID) { throw 'update-invalid-job' }
  foreach ($field in @('oldExecutable', 'newExecutable', 'userData', 'checkpoint', 'rollbackJournal')) {
    if ($job.$field -isnot [string]) { throw 'update-invalid-job' }
  }
  $userData = Assert-PlainPath $job.userData $true $true
  $updates = Assert-PlainPath (Join-Path $userData 'companion-updates') $true $true
  $backups = Assert-PlainPath (Join-Path $userData 'companion-backups') $true $true
  if (-not (Same-Path (Full-Path $JobPath) (Join-Path $updates ('job-' + $job.id + '.json')))) { throw 'update-invalid-job-location' }
  foreach ($field in @('checkpoint', 'rollbackJournal')) {
    $absolute = Assert-PlainPath $job.$field
    if (-not (Same-Path ([IO.Path]::GetDirectoryName($absolute)) $backups)) { throw 'update-invalid-backup-location' }
  }
  $checkpointName = [IO.Path]::GetFileName($job.checkpoint)
  if ($checkpointName -cnotmatch '^before-restore-\d+-[a-f0-9-]{36}\.wowbackup\.json$') { throw 'update-invalid-checkpoint' }
  if ([IO.Path]::GetFileName($job.rollbackJournal) -cnotmatch '^update-rollback-[a-f0-9-]{36}\.json$') { throw 'update-invalid-journal' }
  foreach ($field in @('oldExecutable', 'newExecutable')) {
    $absolute = Assert-PlainPath $job.$field
    if ([IO.Path]::GetFileName($absolute) -ine 'wow-companion.exe') { throw 'update-invalid-executable' }
  }
  if (Same-Path $job.oldExecutable $job.newExecutable) { throw 'update-same-executable' }
  $journal = Read-JsonFile $job.rollbackJournal (768MB)
  if ($journal.phase -ne 'applying' -or $journal.checkpoint -cne $checkpointName -or -not $journal.selection.settings -or -not $journal.selection.history -or -not $journal.selection.chats) { throw 'update-invalid-journal' }
  if (-not $journal.previous -or $null -eq $journal.previous.files -or -not $journal.previous.browser) { throw 'update-invalid-journal' }
  $ackPath = Join-Path $updates ('ack-' + $job.id + '.json')
  $rollbackAckPath = Join-Path $updates ('rollback-ack-' + $job.id + '.json')
  $resultPath = Assert-PlainPath (Join-Path $updates 'result.json') $false
  $restorePath = Assert-PlainPath (Join-Path $backups 'restore-journal.json') $false
  $pendingPath = Assert-PlainPath (Join-Path $backups 'pending-restore.json') $false
  if ((Test-Path -LiteralPath $ackPath) -or (Test-Path -LiteralPath $rollbackAckPath)) { throw 'update-stale-ack' }
  if ($ValidateOnly) {
    if ((Test-Path -LiteralPath $restorePath) -or (Test-Path -LiteralPath $pendingPath)) { throw 'update-restore-conflict' }
    exit 0
  }
  $trustedJob = $true
  if ((Test-Path -LiteralPath $restorePath) -or (Test-Path -LiteralPath $pendingPath)) { throw 'update-restore-conflict' }

  # The original app owns its shutdown and flush. Never terminate it to make an update proceed.
  $parent = Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ($parent -and -not $parent.WaitForExit($ParentWaitSeconds * 1000)) { throw 'update-parent-still-running' }
  $parentExited = $true
  $env:APP_USER_DATA_PATH = $userData
  Remove-Item Env:APP_COMPANION_ROLLBACK_ID -ErrorAction SilentlyContinue
  $env:APP_COMPANION_UPDATE_ID = $job.id
  $newProcess = Start-Process -FilePath $job.newExecutable -WorkingDirectory ([IO.Path]::GetDirectoryName($job.newExecutable)) -WindowStyle Hidden -PassThru
  $newProcessStart = $newProcess.StartTime.ToUniversalTime().Ticks
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyWaitSeconds)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $ackPath) {
      $ack = Read-JsonFile $ackPath
      if ($ack.id -ceq $job.id) {
        $ready = $true
        break
      }
    }
    $newProcess.Refresh()
    if ($newProcess.HasExited) { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $ready) { throw 'update-not-ready' }
  Write-Result 'updated'
  exit 0
}
catch {
  if (-not $trustedJob) {
    [Console]::Error.WriteLine('update-invalid-job')
    exit 2
  }
  try {
    if (-not $parentExited) {
      Write-Result 'recovery-required'
      exit 3
    }
    Stop-OwnedNewProcess
    if ((Test-Path -LiteralPath $restorePath) -or (Test-Path -LiteralPath $pendingPath)) { throw 'update-restore-conflict' }
    $journalText = [IO.File]::ReadAllText((Assert-PlainPath $job.rollbackJournal), [Text.Encoding]::UTF8)
    Write-AtomicText $restorePath $journalText $true
    Remove-Item Env:APP_COMPANION_UPDATE_ID -ErrorAction SilentlyContinue
    $env:APP_COMPANION_ROLLBACK_ID = $job.id
    $env:APP_USER_DATA_PATH = $userData
    $oldProcess = Start-Process -FilePath $job.oldExecutable -WorkingDirectory ([IO.Path]::GetDirectoryName($job.oldExecutable)) -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($ReadyWaitSeconds)
    $recovered = $false
    while ([DateTime]::UtcNow -lt $deadline) {
      if (Test-Path -LiteralPath $rollbackAckPath) {
        $ack = Read-JsonFile $rollbackAckPath
        if ($ack.id -ceq $job.id) {
          if ((Test-Path -LiteralPath $restorePath) -or (Test-Path -LiteralPath $pendingPath)) { throw 'update-recovery-incomplete' }
          $recovered = $true
          break
        }
      }
      $oldProcess.Refresh()
      if ($oldProcess.HasExited) { break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $recovered) { throw 'update-recovery-not-ready' }
    Write-Result 'rolled-back'
    exit 0
  }
  catch {
    Write-Result 'recovery-required'
    exit 3
  }
}
