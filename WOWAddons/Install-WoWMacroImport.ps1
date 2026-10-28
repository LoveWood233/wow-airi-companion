param(
    [string]$AddOnsPath = 'I:\Game\World of Warcraft\_retail_\Interface\AddOns',
    [ValidateSet('retail', 'forever')][string]$Game = 'retail',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$targetRoot = (Resolve-Path -LiteralPath $AddOnsPath).Path
if ((Split-Path $targetRoot -Leaf) -ne 'AddOns') { throw 'Choose an Interface\AddOns directory.' }
$telemetryFolder = if ($Game -eq 'retail') { 'WoWMapCompanion' } else { 'WoWForeverCompanion' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
foreach ($folder in @('WoWMacroImport', $telemetryFolder)) {
    $sourceFolder = Join-Path $PSScriptRoot $folder
    $targetFolder = Join-Path $targetRoot $folder
    if (-not (Test-Path -LiteralPath (Join-Path $sourceFolder "$folder.toc"))) { throw "Missing addon source: $folder" }
    Write-Output "Install $sourceFolder -> $targetFolder"
    if ($CheckOnly) { continue }
    if (Test-Path -LiteralPath $targetFolder) {
        $backupFolder = Join-Path $PSScriptRoot "backups\macro-import-$stamp"
        New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
        Copy-Item -LiteralPath $targetFolder -Destination (Join-Path $backupFolder $folder) -Recurse
        Write-Output "Backup: $backupFolder"
    }
    New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
    Get-ChildItem -LiteralPath $sourceFolder -File | Where-Object { $_.Extension -in '.lua', '.toc', '.md' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetFolder $_.Name) -Force
    }
}
Write-Output 'Restart WoW and the companion. Use /import-marco to open the importer.'
