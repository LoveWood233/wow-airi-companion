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
    throw "魔兽陪伴精灵 source was not found: $AiriPath. Pass -AiriPath with the source directory."
}
Write-Output '正在启动魔兽陪伴精灵。开启陪伴连接后，程序会自动管理桥接。'
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
            throw "Existing 魔兽陪伴精灵 data was found at $oldProfile. Back up and migrate a consistent profile to $resolvedUserDataPath before starting. AppData can show a merged MSIX view, so this launcher will not copy it automatically. To deliberately keep the old directory, pass -UserDataPath '$oldProfile'."
        }
    }
    New-Item -ItemType Directory -Path $resolvedUserDataPath -Force | Out-Null
    # Keep the profile outside AppData, which packaged launchers can redirect.
    $env:APP_USER_DATA_PATH = $resolvedUserDataPath
    Write-Output "魔兽陪伴精灵数据目录： $resolvedUserDataPath"
    Write-Output "魔兽陪伴精灵程序目录： $AiriPath"
    $appPath = Join-Path $AiriPath 'apps\stage-tamagotchi'
    $packaged = Join-Path $appPath 'dist-portable-2.27.1\win-unpacked\wow-companion.exe'
    $usePackaged = -not $Dev -and (Test-Path -LiteralPath $packaged -PathType Leaf)
    if (-not $usePackaged) {
        if (-not (Test-Path -LiteralPath (Join-Path $AiriPath 'node_modules'))) {
            throw '魔兽陪伴精灵 dependencies are missing. Read the setup section in wow-companion-implementation.html.'
        }
        $pnpm = Get-Command pnpm.cmd -ErrorAction Stop
    }
    if ($Dev) {
        & $pnpm.Source -F '@proj-airi/stage-tamagotchi' dev
        if ($LASTEXITCODE -ne 0) { throw "魔兽陪伴精灵 exited with code $LASTEXITCODE." }
        return
    }
    if ($usePackaged) {
        $executable = $packaged
        $workingDirectory = Split-Path $packaged -Parent
        Write-Output '使用已构建的魔兽陪伴精灵 2.27.1。'
    }
    else {
        $executable = Join-Path $appPath 'node_modules\electron\dist\electron.exe'
        $workingDirectory = $AiriPath
        if (-not (Test-Path -LiteralPath $executable)) { throw 'Electron runtime is missing. Complete the 魔兽陪伴精灵 installation first.' }
        if (-not (Test-Path -LiteralPath (Join-Path $appPath 'out\main\index.js'))) {
            & $pnpm.Source -F '@proj-airi/stage-tamagotchi' build
            if ($LASTEXITCODE -ne 0) { throw '魔兽陪伴精灵 build failed. See the build output above.' }
        }
        Write-Output '发行目录尚未构建，使用当前源码的桌面构建。'
    }
    # Electron owns the profile lock and restores the main window on a second launch.
    # A shared runtime executable or a failed process cannot establish that the companion UI is running.
    $logDir = Join-Path $PSScriptRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $logDir "companion-$stamp.log"
    $stderr = Join-Path $logDir "companion-$stamp-error.log"
    # Give the GUI process durable output handles, even after this launcher closes.
    $oldRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        $env:ELECTRON_RUN_AS_NODE = $null
        # The helper is hidden by CMD. The interactive app must show its main window and native startup errors.
        $launch = @{ FilePath = $executable; WorkingDirectory = $workingDirectory; WindowStyle = 'Normal'; RedirectStandardOutput = $stdout; RedirectStandardError = $stderr; PassThru = $true }
        if (-not $usePackaged) { $launch.ArgumentList = ('"' + $appPath + '"') }
        $process = Start-Process @launch
        # Retain the handle before waiting so Windows PowerShell can read the exit code of a fast secondary process.
        $null = $process.Handle
        $exited = $process.WaitForExit(2000)
        if ((Test-Path -LiteralPath $stderr -PathType Leaf) -and (Select-String -LiteralPath $stderr -Pattern '^App threw an error during load' -Quiet)) {
            throw "魔兽陪伴精灵加载失败。请检查构建版本，错误日志：$stderr"
        }
        $process.Refresh()
        if ($process.MainWindowTitle -in @('Error', 'JavaScript Error', '错误')) {
            throw "魔兽陪伴精灵发生启动错误，请查看已显示的错误窗口。诊断日志：$stderr"
        }
        if ($exited) {
            $process.Refresh()
            if ($process.ExitCode -ne 0) {
                throw "魔兽陪伴精灵启动失败，退出码 $($process.ExitCode)。错误日志：$stderr"
            }
            Write-Output '启动进程已退出；若已有实例，已向它发送显示窗口请求。'
        }
        else {
            Write-Output "魔兽陪伴精灵启动进程已创建 (PID $($process.Id))。日志目录：$logDir"
        }
    }
    finally { $env:ELECTRON_RUN_AS_NODE = $oldRunAsNode }
}
finally {
    $env:APP_USER_DATA_PATH = $oldUserDataPath
    Pop-Location
}
