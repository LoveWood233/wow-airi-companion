param()

$ErrorActionPreference = 'Stop'
$appDirectory = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resourceDirectory = Join-Path $appDirectory 'resources'
$destination = Join-Path $resourceDirectory 'wow-companion-python'
$cacheDirectory = Join-Path $appDirectory '.cache\companion-python'
$version = '3.14.10'
$archiveName = "python-$version-embed-amd64.zip"
$archiveUrl = "https://www.python.org/ftp/python/$version/$archiveName"
$archiveHash = '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159'
$archivePath = Join-Path $cacheDirectory $archiveName
$manifestPath = Join-Path $destination 'runtime-source.json'

New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveHash) {
    throw 'The embedded Python archive does not match the official SHA256 checksum.'
}
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $prepared = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($prepared.archiveSha256 -ne $archiveHash) { throw 'A different embedded Python version is already prepared.' }
    $existing = @(Get-ChildItem -LiteralPath $destination -Force)
    if ($existing.Count -ne $prepared.files.Count + 1 -or @($existing | Where-Object { $_.PSIsContainer }).Count -ne 0) {
        throw 'The prepared Python directory contains unexpected files.'
    }
    foreach ($entry in $prepared.files) {
        if ($entry.name -ne [IO.Path]::GetFileName($entry.name)) { throw 'Invalid Python manifest file name.' }
        $file = Join-Path $destination $entry.name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
            throw "Prepared Python file changed or is missing: $($entry.name)"
        }
    }
    Write-Output "Verified existing embedded Python $version at $destination"
    exit 0
}
$extract = $true
if ((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force).Count -ne 0) {
    # Resume only a complete extraction of this verified archive. Unknown files remain outside the release.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $existing = @(Get-ChildItem -LiteralPath $destination -Force)
        if ($existing.Count -ne $archive.Entries.Count -or @($existing | Where-Object { $_.PSIsContainer }).Count -ne 0) {
            throw 'The incomplete Python directory contains unexpected files.'
        }
        foreach ($entry in $archive.Entries) {
            $file = Join-Path $destination $entry.FullName
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Extracted Python file is missing: $($entry.FullName)" }
            if ($entry.FullName -eq 'python314._pth') { continue }
            $stream = $entry.Open()
            $hasher = [System.Security.Cryptography.SHA256]::Create()
            try { $expected = ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
            finally { $stream.Dispose(); $hasher.Dispose() }
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
                throw "Extracted Python file changed: $($entry.FullName)"
            }
        }
        $extract = $false
    }
    finally { $archive.Dispose() }
}
if ($extract) {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $destination
}

# The isolated interpreter loads only its standard library and the sibling bridge modules.
# It does not load site-packages, user Python settings, or the current working directory.
@('python314.zip', '.', '../wow-companion-bridge') | Set-Content -LiteralPath (Join-Path $destination 'python314._pth') -Encoding ascii
$probe = & (Join-Path $destination 'python.exe') -B -c "import ctypes,dataclasses,http.server,json,sqlite3,ssl,struct,threading,sys; print(json.dumps(dict(version=sys.version.split()[0],architecture=struct.calcsize('P')*8,isolated=sys.flags.isolated)))"
if ($LASTEXITCODE -ne 0) { throw 'Embedded Python cannot load the bridge standard-library modules.' }
$details = $probe | ConvertFrom-Json
if ($details.version -ne $version -or $details.architecture -ne 64 -or $details.isolated -ne 1) { throw 'Unexpected embedded Python runtime.' }
$files = @(Get-ChildItem -LiteralPath $destination -File | Sort-Object Name | ForEach-Object {
    [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
[ordered]@{
    format = 'wow-companion-python-runtime'
    version = 1
    pythonVersion = $version
    architecture = 'win32-x64'
    source = "https://www.python.org/downloads/release/python-$($version.Replace('.', ''))/"
    archive = $archiveUrl
    archiveSha256 = $archiveHash
    license = 'LICENSE.txt'
    modifications = @('python314._pth restricts imports to the standard library, runtime directory and sibling bridge directory')
    files = $files
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Prepared embedded Python $version ($($files.Count) files) at $destination"
