param([string]$LauncherPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Start-WoWCompanion.ps1'))

$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('wow-launcher-test-' + [guid]::NewGuid())
$launcher = Join-Path $fixture 'launcher'
$airi = Join-Path $fixture 'airi source'
$appPath = Join-Path $airi 'apps\stage-tamagotchi'
foreach ($directory in @($launcher, (Join-Path $launcher 'logs'), (Join-Path $launcher 'WoWCompanionBridge'), (Join-Path $airi 'node_modules'), (Join-Path $appPath 'out\main'), (Join-Path $appPath 'node_modules\electron\dist'))) {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$script = Join-Path $launcher 'Start-WoWCompanion.ps1'
Copy-Item -LiteralPath $LauncherPath -Destination $script
[IO.File]::WriteAllText((Join-Path $appPath 'package.json'), '{}')
[IO.File]::WriteAllText((Join-Path $appPath 'out\main\index.js'), '')
[IO.File]::WriteAllText((Join-Path $appPath 'node_modules\electron\dist\electron.exe'), '')
$fakePnpm = Join-Path $fixture 'pnpm.ps1'
[IO.File]::WriteAllText($fakePnpm, '$global:pnpmProfile = $env:APP_USER_DATA_PATH; $global:LASTEXITCODE = $global:pnpmExit')
[IO.File]::WriteAllText((Join-Path $launcher 'WoWCompanionBridge\start.ps1'), 'param($Game) $global:bridgeGame = $Game; $global:bridgeProfile = $env:APP_USER_DATA_PATH')

# Only fixture files reach real IO. Profile checks and all process operations stay inside these mocks.
function Get-Command {
    [CmdletBinding()] param([string]$Name)
    if ($Name -ne 'pnpm.cmd') { throw 'Unexpected command lookup' }
    [pscustomobject]@{ Source = $fakePnpm }
}
function Get-Process {
    [CmdletBinding()] param([string]$Name)
    throw 'Process names cannot establish that the companion window is running'
}
function New-Item {
    [CmdletBinding()] param([string]$ItemType, [string]$Path, [switch]$Force)
    $global:directoryRequests += $Path
}
function Test-Path {
    [CmdletBinding()] param([string]$LiteralPath, [string]$PathType = 'Any')
    $default = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.airi-wow-companion'
    $old = Join-Path ([Environment]::GetFolderPath('ApplicationData')) '@proj-airi\stage-tamagotchi'
    foreach ($entry in @(
        @{ Path = (Join-Path $default 'Local Storage'); Value = $global:stableData },
        @{ Path = (Join-Path $default 'app-config.json'); Value = $global:stableData },
        @{ Path = (Join-Path $old 'Local Storage'); Value = $global:oldData },
        @{ Path = (Join-Path $old 'app-config.json'); Value = $global:oldData }
    )) {
        if ($LiteralPath -eq $entry.Path) {
            $global:profileLookups++
            return $entry.Value
        }
    }
    if (-not [IO.Path]::GetFullPath($LiteralPath).StartsWith($fixture + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The test attempted IO outside its fixture'
    }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType
}
function Start-Process {
    [CmdletBinding()] param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError, [switch]$PassThru)
    $global:launches += [pscustomobject]@{
        Profile = $env:APP_USER_DATA_PATH
        RunAsNode = $env:ELECTRON_RUN_AS_NODE
        Executable = $FilePath
        Arguments = $ArgumentList
        Directory = $WorkingDirectory
        WindowStyle = $WindowStyle
    }
    if ($global:launchFailure) { throw 'Simulated process creation failure' }
    $fatal = ''
    if ($global:fatalLoad) { $fatal = "App threw an error during load`nSimulated load error" }
    [IO.File]::WriteAllText($RedirectStandardError, $fatal)
    [IO.File]::WriteAllText($RedirectStandardOutput, '')
    $process = [pscustomobject]@{ Id = 4242 }
    $process | Add-Member -MemberType ScriptProperty -Name Handle -Value {
        $global:handleAcquired = $true
        return [IntPtr]4242
    }
    $process | Add-Member -MemberType ScriptProperty -Name ExitCode -Value {
        if ($global:handleAcquired) { return $global:processExitCode }
        return $null
    }
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
        param([int]$Milliseconds)
        if (-not $global:handleAcquired) { throw 'Capture the process handle before waiting for a fast-exit child' }
        $global:waitMilliseconds = $Milliseconds
        return $global:processExited
    }
    $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { $global:refreshes++ }
    return $process
}
function Assert-True($Value, [string]$Message) {
    if (-not $Value) { throw $Message }
}
function Reset-Mocks {
    $global:launches = @()
    $global:directoryRequests = @()
    $global:pnpmProfile = $null
    $global:bridgeProfile = $null
    $global:bridgeGame = $null
    $global:pnpmExit = 0
    $global:launchFailure = $false
    $global:stableData = $false
    $global:oldData = $false
    $global:profileLookups = 0
    $global:processExited = $false
    $global:processExitCode = 0
    $global:fatalLoad = $false
    $global:waitMilliseconds = 0
    $global:handleAcquired = $false
    $global:refreshes = 0
    $global:LASTEXITCODE = 0
}
function Assert-Restored {
    Assert-True ($env:APP_USER_DATA_PATH -eq $environment) 'The launcher must restore the parent profile override'
    Assert-True ($env:ELECTRON_RUN_AS_NODE -eq 'test-parent-value') 'The launcher must restore the parent Node flag'
    Assert-True ((Get-Location).Path -eq $initialDirectory) 'The launcher must restore the working directory'
}

$initialProfile = $env:APP_USER_DATA_PATH
$initialRunAsNode = $env:ELECTRON_RUN_AS_NODE
$initialDirectory = (Get-Location).Path
$default = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.airi-wow-companion'
$explicit = Join-Path $fixture 'explicit profile'
$environment = Join-Path $fixture 'environment profile'
$count = 0
try {
    Reset-Mocks
    $env:APP_USER_DATA_PATH = $null
    $env:ELECTRON_RUN_AS_NODE = 'test-parent-value'
    $output = & $script -AiriPath $airi
    Assert-True ($global:launches.Count -eq 1 -and $global:launches[0].Profile -eq $default) 'Normal launch must use the stable default profile'
    Assert-True ([string]::IsNullOrEmpty($env:APP_USER_DATA_PATH)) 'Default launch must restore an absent override'
    Assert-True ($global:waitMilliseconds -eq 2000) 'Startup detection must use a bounded wait'
    Assert-True (($output -join "`n") -match '4242') 'A running child must report its process identity'
    $count++

    Reset-Mocks
    $env:APP_USER_DATA_PATH = $environment
    & $script -AiriPath $airi | Out-Null
    Assert-True ($global:launches[0].Profile -eq $environment) 'Normal launch must honor an environment profile override'
    Assert-Restored
    $count++

    Reset-Mocks
    $global:oldData = $true
    & $script -AiriPath $airi -UserDataPath " $explicit " | Out-Null
    $launch = $global:launches[0]
    Assert-True ($launch.Profile -eq $explicit) 'An explicit profile must override the environment and trim outer spaces'
    Assert-True ($launch.WindowStyle -eq 'Hidden' -and [string]::IsNullOrEmpty($launch.RunAsNode)) 'A GUI child must launch hidden without the Node flag'
    Assert-True ($launch.Arguments -eq ('"' + $appPath + '"') -and $launch.Directory -eq $airi) 'A source path with spaces must remain one quoted application argument'
    Assert-Restored
    $count++

    Reset-Mocks
    & $script -AiriPath $airi -UserDataPath $explicit -Dev | Out-Null
    Assert-True ($global:pnpmProfile -eq $explicit -and $global:launches.Count -eq 0) 'Development mode must pass the selected profile to pnpm'
    Assert-Restored
    $count++

    Reset-Mocks
    & $script -BridgeOnly -Game forever -UserDataPath $explicit | Out-Null
    Assert-True ($global:bridgeGame -eq 'forever' -and $global:bridgeProfile -eq $environment) 'Bridge-only mode must preserve the parent environment'
    Assert-True ($global:profileLookups -eq 0 -and $global:directoryRequests.Count -eq 0 -and $global:launches.Count -eq 0) 'Bridge-only mode cannot inspect or create an app profile'
    Assert-Restored
    $count++

    Reset-Mocks
    $global:processExited = $true
    $output = & $script -AiriPath $airi -UserDataPath $explicit
    Assert-True ($global:launches.Count -eq 1 -and $global:refreshes -eq 1) 'A second launch must reach Electron even when another Electron process exists'
    Assert-True (($output -join "`n") -notmatch '4242') 'An exited child cannot report itself as a running UI'
    Assert-Restored
    $count++

    Reset-Mocks
    $global:processExited = $true
    $global:processExitCode = 23
    try { & $script -AiriPath $airi -UserDataPath $explicit | Out-Null; throw 'Expected startup failure' }
    catch { Assert-True ($_.Exception.Message -match '23.*airi-.*-error\.log') 'A startup failure must include the exit code and error log path' }
    Assert-Restored
    $count++

    Reset-Mocks
    $global:fatalLoad = $true
    try { & $script -AiriPath $airi -UserDataPath $explicit | Out-Null; throw 'Expected load failure' }
    catch { Assert-True ($_.Exception.Message -match 'airi-.*-error\.log') 'A fatal load message must fail before reporting success' }
    Assert-Restored
    $count++

    Reset-Mocks
    $global:launchFailure = $true
    try { & $script -AiriPath $airi -UserDataPath $explicit | Out-Null; throw 'Expected process creation failure' }
    catch { Assert-True ($_.Exception.Message -eq 'Simulated process creation failure') 'Process creation errors must propagate' }
    Assert-Restored
    $count++

    Reset-Mocks
    $global:pnpmExit = 19
    try { & $script -AiriPath $airi -UserDataPath $explicit -Dev | Out-Null; throw 'Expected development failure' }
    catch { Assert-True ($_.Exception.Message -match 'exited with code 19\.') 'Development errors must propagate' }
    Assert-Restored
    $count++

    Reset-Mocks
    $env:APP_USER_DATA_PATH = $null
    $global:oldData = $true
    try { & $script -AiriPath $airi | Out-Null; throw 'Expected migration protection' }
    catch { Assert-True ($_.Exception.Message -like 'Existing * data was found at *-UserDataPath*') 'Old data must trigger the migration explanation' }
    Assert-True ($global:launches.Count -eq 0 -and $global:directoryRequests.Count -eq 0) 'Migration protection must precede writes and launch'
    Assert-True ([string]::IsNullOrEmpty($env:APP_USER_DATA_PATH)) 'Migration protection must preserve the parent environment'
    $count++

    Reset-Mocks
    $global:oldData = $true
    $global:stableData = $true
    & $script -AiriPath $airi | Out-Null
    Assert-True ($global:launches.Count -eq 1 -and $global:launches[0].Profile -eq $default) 'An existing stable profile must start without migration'
    $count++

    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors) | Out-Null
    Assert-True ($errors.Count -eq 0) 'The production launcher must parse'
    Write-Output "PASS: $count isolated launcher scenarios and syntax parsing. No real app process or user profile was changed."
}
finally {
    $env:APP_USER_DATA_PATH = $initialProfile
    $env:ELECTRON_RUN_AS_NODE = $initialRunAsNode
    if ((Get-Location).Path -ne $initialDirectory) { Set-Location -LiteralPath $initialDirectory }
}
