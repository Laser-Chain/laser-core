[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [switch]$AllowDirty,
  [switch]$RequireCodeSigning
)

$ErrorActionPreference = 'Stop'
$directory = (Resolve-Path -LiteralPath $ReleaseDir).Path
$files = @(Get-ChildItem -LiteralPath $directory -Force -File)
$directories = @(Get-ChildItem -LiteralPath $directory -Force -Directory)
if ($directories.Count -ne 0) {
  throw 'Release directory must not contain subdirectories.'
}
if ($files.Count -ne 6) {
  throw 'Release directory must contain exactly the executable, BUILDINFO.txt, NOTICE.txt, RELEASE_NOTES.md, SBOM.spdx.json, and SHA256SUMS.'
}
foreach ($file in $files) {
  if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Release entries must not be links: $($file.Name)"
  }
}

$executables = @($files | Where-Object Name -match '^Laser-Core-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?-portable-x64\.exe$')
if ($executables.Count -ne 1) { throw 'Release directory must contain exactly one canonical portable executable.' }
$expectedNames = @($executables[0].Name, 'BUILDINFO.txt', 'NOTICE.txt', 'RELEASE_NOTES.md', 'SBOM.spdx.json', 'SHA256SUMS')
$actualNames = @($files.Name | Sort-Object)
$expectedNameList = ($expectedNames | Sort-Object) -join "`n"
$actualNameList = $actualNames -join "`n"
if ($expectedNameList -ne $actualNameList) {
  throw 'Release directory contains unexpected files.'
}

$manifestPath = Join-Path $directory 'SHA256SUMS'
$manifestLines = @(Get-Content -LiteralPath $manifestPath -Encoding ascii)
if ($manifestLines.Count -ne 5) { throw 'SHA256SUMS must contain exactly five entries.' }
$seen = @{}
foreach ($line in $manifestLines) {
  if ($line -notmatch '^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$') {
    throw "Non-canonical checksum line: $line"
  }
  $digest = $Matches[1]
  $name = $Matches[2]
  if ($seen.ContainsKey($name)) { throw "Duplicate checksum entry: $name" }
  if ($name -eq 'SHA256SUMS' -or $name -notin $expectedNames) {
    throw "Unexpected checksum entry: $name"
  }
  $path = Join-Path $directory $name
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $digest) { throw "Checksum mismatch: $name" }
  $seen[$name] = $true
}
foreach ($name in @($executables[0].Name, 'BUILDINFO.txt', 'NOTICE.txt', 'RELEASE_NOTES.md', 'SBOM.spdx.json')) {
  if (-not $seen.ContainsKey($name)) { throw "Missing checksum entry: $name" }
}

$sbomPath = Join-Path $directory 'SBOM.spdx.json'
& node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(d.spdxVersion!=='SPDX-2.3'||!Array.isArray(d.packages)||d.packages.length===0)process.exit(1)" $sbomPath
if ($LASTEXITCODE -ne 0) { throw 'SBOM.spdx.json is not a non-empty SPDX 2.3 document.' }

$buildInfo = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $directory 'BUILDINFO.txt') -Encoding utf8) {
  $separator = $line.IndexOf('=')
  if ($separator -gt 0) {
    $buildInfo[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
  }
}
$requiredKeys = @(
  'format', 'app_version', 'source_commit', 'source_dirty', 'platform',
  'package_target', 'laser_version', 'laserd_version', 'project_license',
  'authenticode_status', 'cuda_miner_sha256', 'explorer_helper_sha256'
)
foreach ($key in $requiredKeys) {
  if (-not $buildInfo.ContainsKey($key) -or -not $buildInfo[$key]) {
    throw "Missing build identity field: $key"
  }
}
if ($buildInfo.format -ne 'laser-core-release-v1' -or
    $buildInfo.platform -ne 'windows-x64' -or
    $buildInfo.package_target -ne 'portable' -or
    $buildInfo.project_license -ne 'UNLICENSED') {
  throw 'BUILDINFO.txt contains an unsupported release identity.'
}
if ($executables[0].Name -ne "Laser-Core-$($buildInfo.app_version)-portable-x64.exe") {
  throw 'Executable filename does not match BUILDINFO.txt.'
}
if ($buildInfo.cuda_miner_sha256 -ne 'absent' -and
    $buildInfo.cuda_miner_sha256 -notmatch '^[0-9a-f]{64}$') {
  throw 'Invalid CUDA miner identity.'
}
if ($buildInfo.explorer_helper_sha256 -notmatch '^[0-9a-f]{64}$') {
  throw 'Invalid or missing explorer publisher helper identity.'
}
if ($buildInfo.source_dirty -eq 'true' -and -not $AllowDirty) {
  throw 'Dirty-worktree candidates are not publishable.'
}
if ($buildInfo.source_dirty -notin @('true', 'false')) {
  throw 'Invalid source_dirty value.'
}

$signature = Get-AuthenticodeSignature -LiteralPath $executables[0].FullName
if ([string]$signature.Status -ne $buildInfo.authenticode_status) {
  throw 'Authenticode status does not match BUILDINFO.txt.'
}
if ($signature.Status -notin @('Valid', 'NotSigned')) {
  throw "Invalid Authenticode status: $($signature.Status)"
}
if ($RequireCodeSigning -and $signature.Status -ne 'Valid') {
  throw 'A publishable Windows release must have a valid Authenticode signature.'
}

Write-Host "Verified Laser Core release candidate: $directory"
Write-Host "Source: $($buildInfo.source_commit)"
Write-Host "Authenticode: $($signature.Status)"
