$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('wow-companion-launcher-' + [guid]::NewGuid())
$launcherRoot = Join-Path $fixtureRoot 'WOWAddons'
$sourceRoot = Join-Path $fixtureRoot 'airi'
$appRoot = Join-Path $sourceRoot 'apps\stage-tamagotchi'
$packagedExe = Join-Path $appRoot 'dist-portable-2.27.1\win-unpacked\wow-companion.exe'
$electronExe = Join-Path $appRoot 'node_modules\electron\dist\electron.exe'
$defaultProfile = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.airi-wow-companion'
$oldProfile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) '@proj-airi\stage-tamagotchi'
$explicitProfile = Join-Path $fixtureRoot 'explicit-profile'
$environmentProfile = Join-Path $fixtureRoot 'environment-profile'
foreach ($directory in @($launcherRoot, (Join-Path $launcherRoot 'WoWCompanionBridge'), (Join-Path $sourceRoot 'node_modules'), (Join-Path $appRoot 'out\main'), (Split-Path $electronExe -Parent))) {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$script = Join-Path $launcherRoot 'Start-WoWCompanion.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Start-WoWCompanion.ps1') -Destination $script
[IO.File]::WriteAllText((Join-Path $appRoot 'package.json'), '{}')
[IO.File]::WriteAllText((Join-Path $appRoot 'out\main\index.js'), '')
[IO.File]::WriteAllText($electronExe, '')
$fakePnpm = Join-Path $fixtureRoot 'pnpm.ps1'
[IO.File]::WriteAllText($fakePnpm, '$global:pnpmArguments = @($args); $global:pnpmProfile = $env:APP_USER_DATA_PATH; $global:LASTEXITCODE = $global:pnpmExit')
[IO.File]::WriteAllText((Join-Path $launcherRoot 'WoWCompanionBridge\start.ps1'), 'param($Game) $global:bridgeGame = $Game; $global:bridgeProfile = $env:APP_USER_DATA_PATH')

# Only native launch, command lookup and profile probes are replaced. No process is started.
function Get-Command {
    [CmdletBinding()] param([string]$Name)
    if ($Name -ne 'pnpm.cmd') { throw 'Unexpected command lookup' }
    $global:commandLookups++
    [pscustomobject]@{ Source = $fakePnpm }
}
function Test-Path {
    [CmdletBinding()] param([string]$LiteralPath, [string]$PathType = 'Any')
    if ($LiteralPath -eq $packagedExe) { return $global:packagedExists }
    if ($LiteralPath -eq (Join-Path $sourceRoot 'node_modules')) { return $global:dependenciesExist }
    if ($LiteralPath -eq (Join-Path $appRoot 'out\main\index.js')) { return $global:buildExists }
    if ($LiteralPath.StartsWith($defaultProfile + '\') -or $LiteralPath.StartsWith($oldProfile + '\')) {
        $global:profileProbes++
        return $LiteralPath.StartsWith($oldProfile + '\') -and $global:oldProfileExists
    }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType
}
function New-Item {
    [CmdletBinding()] param([string]$ItemType, [string]$Path, [switch]$Force)
    $global:directoryRequests += $Path
    $resolved = [IO.Path]::GetFullPath($Path)
    if ($resolved.StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Path $resolved -Force:$Force
    }
    elseif ($resolved -ne $defaultProfile) { throw 'A test attempted to write outside its fixture' }
}
function Start-Process {
    [CmdletBinding()] param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError, [switch]$PassThru)
    $global:launch = @{ FilePath = $FilePath; Arguments = $ArgumentList; WorkingDirectory = $WorkingDirectory; WindowStyle = $WindowStyle; Profile = $env:APP_USER_DATA_PATH; RunAsNode = $env:ELECTRON_RUN_AS_NODE; Stdout = $RedirectStandardOutput; Stderr = $RedirectStandardError }
    if ($global:launchFails) { throw 'Simulated native launch failure' }
    $process = [pscustomobject]@{ Id = 4242; Handle = 0; ExitCode = $global:processExit; MainWindowTitle = $global:processWindowTitle }
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($milliseconds) $global:exitsEarly }
    $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
    $process
}
function Assert-True($Value, [string]$Message) {
    if (-not $Value) { throw $Message }
}
function Reset-Fixture {
    $global:launch = $null
    $global:launchFails = $false
    $global:processExit = 0
    $global:processWindowTitle = ''
    $global:exitsEarly = $false
    $global:commandLookups = 0
    $global:profileProbes = 0
    $global:directoryRequests = @()
    $global:pnpmArguments = @()
    $global:pnpmProfile = $null
    $global:pnpmExit = 0
    $global:bridgeGame = $null
    $global:bridgeProfile = $null
    $global:packagedExists = $true
    $global:dependenciesExist = $true
    $global:buildExists = $true
    $global:oldProfileExists = $false
    $env:APP_USER_DATA_PATH = $environmentProfile
    $env:ELECTRON_RUN_AS_NODE = 'parent-node-value'
}

$initialProfile = $env:APP_USER_DATA_PATH
$initialNode = $env:ELECTRON_RUN_AS_NODE
$initialDirectory = (Get-Location).Path
try {
    $cmd = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\Start-WoWCompanion.cmd') -Raw
    Assert-True ($cmd.Contains('%~dp0Start-WoWCompanion.ps1') -and -not $cmd.Contains('wow-airi-companion')) 'CMD must use the adjacent launcher'
    Assert-True ($cmd.Contains('-WindowStyle Hidden') -and $cmd.Contains('latest-launcher-log.txt')) 'CMD must hide its helper and index the latest diagnostics'
    Assert-True ($cmd.Contains('launcher-%RANDOM%-%RANDOM%.log') -and -not $cmd.Contains('>>"%~dp0logs\launcher.log"')) 'Each launch must own a distinct log, including while the primary process holds an old log open'

    Reset-Fixture
    $global:dependenciesExist = $false
    & $script -AiriPath $sourceRoot -UserDataPath $explicitProfile | Out-Null
    Assert-True ($global:launch.FilePath -eq $packagedExe -and $global:commandLookups -eq 0) 'Packaged release must run without source dependencies'
    Assert-True ($null -eq $global:launch.Arguments -and $global:launch.WorkingDirectory -eq (Split-Path $packagedExe -Parent)) 'Packaged release must use its own executable directory'
    Assert-True ($global:launch.Profile -eq $explicitProfile -and $global:launch.WindowStyle -eq 'Normal') 'The interactive app and startup error dialogs must remain visible'
    Assert-True ([string]::IsNullOrEmpty($global:launch.RunAsNode)) 'GUI child must not run as Node'
    Assert-True ($env:APP_USER_DATA_PATH -eq $environmentProfile -and $env:ELECTRON_RUN_AS_NODE -eq 'parent-node-value') 'Launcher must restore parent environment'
    Assert-True ($global:launch.Stdout.StartsWith((Join-Path $launcherRoot 'logs')) -and $global:launch.Stderr.EndsWith('-error.log')) 'GUI diagnostics must be separate readable files'

    Reset-Fixture
    $global:packagedExists = $false
    & $script -AiriPath $sourceRoot | Out-Null
    Assert-True ($global:launch.FilePath -eq $electronExe -and $global:launch.Arguments -eq ('"' + $appRoot + '"')) 'Source fallback must launch the selected checkout'
    Assert-True ($global:launch.Profile -eq $environmentProfile -and $global:pnpmArguments.Count -eq 0) 'Source fallback must retain environment profile without rebuilding existing output'

    Reset-Fixture
    $env:APP_USER_DATA_PATH = $null
    & $script -AiriPath $sourceRoot | Out-Null
    Assert-True ($global:launch.Profile -eq $defaultProfile -and [string]::IsNullOrEmpty($env:APP_USER_DATA_PATH)) 'Default profile must be stable and restore the absent override'

    Reset-Fixture
    & $script -AiriPath $sourceRoot -Dev -UserDataPath $explicitProfile | Out-Null
    Assert-True ($null -eq $global:launch -and $global:pnpmArguments[-1] -eq 'dev' -and $global:pnpmProfile -eq $explicitProfile) 'Dev must retain the source development path'

    Reset-Fixture
    & $script -BridgeOnly -Game forever | Out-Null
    Assert-True ($global:bridgeGame -eq 'forever' -and $global:bridgeProfile -eq $environmentProfile) 'Bridge-only must pass the selected game'
    Assert-True ($global:profileProbes -eq 0 -and $global:directoryRequests.Count -eq 0 -and $null -eq $global:launch) 'Bridge-only must not inspect a profile or launch the desktop'

    Reset-Fixture
    $env:APP_USER_DATA_PATH = $null
    $global:oldProfileExists = $true
    try { & $script -AiriPath $sourceRoot | Out-Null; throw 'Expected migration protection' }
    catch { Assert-True ($_.Exception.Message -like 'Existing * data was found at *') 'An unmigrated profile must produce migration guidance'
    }
    Assert-True ($null -eq $global:launch -and $global:directoryRequests.Count -eq 0) 'Migration protection must run before creating a profile'

    Reset-Fixture
    $global:launchFails = $true
    try { & $script -AiriPath $sourceRoot | Out-Null; throw 'Expected native failure' }
    catch { Assert-True ($_.Exception.Message -eq 'Simulated native launch failure') 'Native failure must propagate' }
    Assert-True ($env:APP_USER_DATA_PATH -eq $environmentProfile -and $env:ELECTRON_RUN_AS_NODE -eq 'parent-node-value') 'Native failure must restore the environment'

    Reset-Fixture
    $global:exitsEarly = $true
    & $script -AiriPath $sourceRoot | Out-Null
    Assert-True ($global:launch.FilePath -eq $packagedExe) 'A successful secondary process must remain a valid launch'

    Reset-Fixture
    $global:processWindowTitle = 'Error'
    try { & $script -AiriPath $sourceRoot | Out-Null; throw 'Expected visible startup error' }
    catch { Assert-True ($_.Exception.Message.Contains('error.log')) 'A startup error dialog must produce launcher diagnostics'
    }

    Reset-Fixture
    $global:exitsEarly = $true
    $global:processExit = 7
    try { & $script -AiriPath $sourceRoot | Out-Null; throw 'Expected exit failure' }
    catch { Assert-True ($_.Exception.Message.Contains('7') -and $_.Exception.Message.Contains('-error.log')) 'Early failure must include its exit code and log path' }

    Reset-Fixture
    $global:packagedExists = $false
    $global:buildExists = $false
    & $script -AiriPath $sourceRoot | Out-Null
    Assert-True ($global:pnpmArguments[-1] -eq 'build' -and $global:launch.FilePath -eq $electronExe) 'Missing source output must build before launch'

    Reset-Fixture
    $global:packagedExists = $false
    $global:dependenciesExist = $false
    try { & $script -AiriPath $sourceRoot | Out-Null; throw 'Expected missing dependencies' }
    catch { Assert-True ($_.Exception.Message.Contains('dependencies are missing')) 'Missing source dependencies must explain setup' }
    Assert-True ($null -eq $global:launch) 'Missing dependencies must not launch a process'

    $tokens = $null
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors) | Out-Null
    Assert-True ($parseErrors.Count -eq 0) 'PowerShell launcher must parse'
    Assert-True ((Get-Location).Path -eq $initialDirectory) 'Launcher must restore the working directory'
    Write-Output 'PASS: 14 isolated launcher scenarios. No desktop, bridge, private profile or model was opened.'
}
finally {
    $env:APP_USER_DATA_PATH = $initialProfile
    $env:ELECTRON_RUN_AS_NODE = $initialNode
    if ((Get-Location).Path -ne $initialDirectory) { Set-Location -LiteralPath $initialDirectory }
}
