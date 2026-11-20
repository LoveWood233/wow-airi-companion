param(
    [string[]]$ExtraScript = @()
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) {
    throw 'Run this regression with powershell.exe, matching the CMD launcher.'
}

# CMD uses Windows PowerShell 5.1. A successful PowerShell 7 parse cannot prove this entry works.
$scripts = @((Join-Path $PSScriptRoot '..\Start-WoWCompanion.ps1')) + $ExtraScript
foreach ($script in $scripts) {
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) {
        $locations = ($parseErrors | ForEach-Object { $_.Extent.StartLineNumber }) -join ', '
        throw "Windows PowerShell cannot parse launcher at lines: $locations"
    }
    $expected = [IO.File]::ReadAllText($script, [Text.Encoding]::UTF8)
    if ($ast.Extent.Text -cne $expected) {
        throw 'Windows PowerShell did not decode the launcher as UTF-8.'
    }
}
Write-Output "PASS: Windows PowerShell $($PSVersionTable.PSVersion) decoded and parsed $($scripts.Count) launcher(s). No app or user profile was opened."
