param(
    [string]$AiriPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'airi'),
    [string]$UserDataPath = $env:APP_USER_DATA_PATH,
    [switch]$BridgeOnly,
    [ValidateSet('retail', 'forever')][string]$Game = 'retail',
    [switch]$Dev
)
$ErrorActionPreference = 'Stop'
if ($BridgeOnly) {
    $bridgeStart = Join-Path $PSScriptRoot 'WoWCompanionBridge\start.ps1'
    if (-not (Test-Path -LiteralPath $bridgeStart)) { throw 'The companion bridge is missing.' }
    & $bridgeStart -Game $Game
    return
}
if (-not (Test-Path -LiteralPath (Join-Path $AiriPath 'apps\stage-tamagotchi\package.json'))) {
    throw "AIRI source was not found: $AiriPath. Pass -AiriPath with the source directory."
}
if (-not (Test-Path -LiteralPath (Join-Path $AiriPath 'node_modules'))) {
    throw 'AIRI dependencies are missing. Read the setup section in wow-companion-implementation.html.'
}
$pnpm = Get-Command pnpm.cmd -ErrorAction Stop
Write-Output 'Starting AIRI. It manages the bridge when the WoW Companion connection is enabled.'
$oldUserDataPath = $env:APP_USER_DATA_PATH
Push-Location -LiteralPath $AiriPath
try {
    $usingDefaultUserDataPath = [string]::IsNullOrWhiteSpace($UserDataPath)
    if ($usingDefaultUserDataPath) {
        $UserDataPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.airi-wow-companion'
    }
    $resolvedUserDataPath = [System.IO.Path]::GetFullPath($UserDataPath.Trim())
    if ($usingDefaultUserDataPath) {
        $oldProfile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) '@proj-airi\stage-tamagotchi'
        $hasNewData = (Test-Path -LiteralPath (Join-Path $resolvedUserDataPath 'Local Storage') -PathType Container) -or (Test-Path -LiteralPath (Join-Path $resolvedUserDataPath 'app-config.json') -PathType Leaf)
        $hasOldData = (Test-Path -LiteralPath (Join-Path $oldProfile 'Local Storage') -PathType Container) -or (Test-Path -LiteralPath (Join-Path $oldProfile 'app-config.json') -PathType Leaf)
        if (-not $hasNewData -and $hasOldData) {
            throw "Existing AIRI data was found at $oldProfile. Back up and migrate a consistent profile to $resolvedUserDataPath before starting. AppData can show a merged MSIX view, so this launcher will not copy it automatically. To deliberately keep the old directory, pass -UserDataPath '$oldProfile'."
        }
    }
    New-Item -ItemType Directory -Path $resolvedUserDataPath -Force | Out-Null
    # Keep the profile outside AppData, which packaged launchers can redirect.
    $env:APP_USER_DATA_PATH = $resolvedUserDataPath
    Write-Output "AIRI user data: $resolvedUserDataPath"
    if ($Dev) {
        & $pnpm.Source -F '@proj-airi/stage-tamagotchi' dev
        if ($LASTEXITCODE -ne 0) { throw "AIRI exited with code $LASTEXITCODE." }
        return
    }
    $appPath = Join-Path $AiriPath 'apps\stage-tamagotchi'
    $electron = Join-Path $appPath 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $electron)) { throw 'Electron runtime is missing. Complete the AIRI installation first.' }
    if (-not (Test-Path -LiteralPath (Join-Path $appPath 'out\main\index.js'))) {
        & $pnpm.Source -F '@proj-airi/stage-tamagotchi' build
        if ($LASTEXITCODE -ne 0) { throw 'AIRI build failed. See the build output above.' }
    }
    $running = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron }
    if ($running) { Write-Output 'AIRI is already running.'; return }
    $logDir = Join-Path $PSScriptRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $logDir "airi-$stamp.log"
    $stderr = Join-Path $logDir "airi-$stamp-error.log"
    # Give the GUI process durable output handles, even after this launcher closes.
    $oldRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        $env:ELECTRON_RUN_AS_NODE = $null
        $process = Start-Process -FilePath $electron -ArgumentList ('"' + $appPath + '"') -WorkingDirectory $AiriPath -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
        Write-Output "AIRI started (PID $($process.Id)). Logs: $logDir"
    }
    finally { $env:ELECTRON_RUN_AS_NODE = $oldRunAsNode }
}
finally {
    $env:APP_USER_DATA_PATH = $oldUserDataPath
    Pop-Location
}
