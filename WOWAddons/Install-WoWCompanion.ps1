param(
    [string]$AddOnsPath = 'I:\Game\World of Warcraft\_retail_\Interface\AddOns',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'WoWMapCompanion'
if (-not (Test-Path -LiteralPath (Join-Path $source 'WoWMapCompanion.toc'))) {
    throw 'The addon source is missing.'
}
if (-not (Test-Path -LiteralPath $AddOnsPath -PathType Container)) {
    throw "AddOns directory does not exist: $AddOnsPath"
}
$resolvedAddOns = (Resolve-Path -LiteralPath $AddOnsPath).Path
if ((Split-Path $resolvedAddOns -Leaf) -ne 'AddOns') {
    throw 'Choose the retail Interface\AddOns directory.'
}
$destination = Join-Path $resolvedAddOns 'WoWMapCompanion'
$files = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Extension -in '.lua', '.toc' -or $_.Name -eq 'README.md' })
Write-Output "Source: $source"
Write-Output "Destination: $destination"
Write-Output "Files: $($files.Count)"
if ($CheckOnly) { return }
if (Test-Path -LiteralPath $destination) {
    $backup = Join-Path $PSScriptRoot ('backups\WoWMapCompanion-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $destination -Destination $backup -Recurse
    Write-Output "Backup: $backup"
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $files) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name) -Force
}
Write-Output 'Installed. In WoW, enable WoW Map Companion and run /reload.'
