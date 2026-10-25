param(
  [string]$SourceRoot = $env:LASER_SOURCE_DIR,
  [string]$ExplorerSourceRoot = $env:LASER_EXPLORER_SOURCE_DIR
)

$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path (Join-Path $AppDir '..')).Path
} else {
  $SourceRoot = (Resolve-Path $SourceRoot).Path
}

$sourceBuild = Join-Path $SourceRoot 'build'
$output = Join-Path $AppDir '.runtime\v3'
$required = @('laser.exe', 'laserd.exe', 'laser-shadow.exe')
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceBuild $name) -PathType Leaf)) {
    throw "Missing $name in $sourceBuild. Build the Laser node first or set LASER_SOURCE_DIR."
  }
}

New-Item -ItemType Directory -Path $output -Force | Out-Null
foreach ($name in $required) {
  Copy-Item -LiteralPath (Join-Path $sourceBuild $name) -Destination $output -Force
}
$explorerCandidates = @()
if ($ExplorerSourceRoot) {
  $explorerCandidates += (Resolve-Path $ExplorerSourceRoot).Path
}
$explorerCandidates += @(
  (Join-Path $SourceRoot 'laser-explorer'),
  (Join-Path (Split-Path $SourceRoot -Parent) 'laser-explorer'),
  (Join-Path (Split-Path $AppDir -Parent) 'laser-explorer')
)
$explorerSource = $explorerCandidates |
  ForEach-Object { Join-Path $_ 'build\lxe.exe' } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (-not $explorerSource) {
  throw 'Missing optimized explorer helper. Build laser-explorer first or set LASER_EXPLORER_SOURCE_DIR.'
}
$explorerOutput = Join-Path $AppDir '.runtime\explorer'
New-Item -ItemType Directory -Path $explorerOutput -Force | Out-Null
Copy-Item -LiteralPath $explorerSource -Destination (Join-Path $explorerOutput 'lxe.exe') -Force
$explorerHash = (Get-FileHash -LiteralPath (Join-Path $explorerOutput 'lxe.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
@('format=laser-explorer-runtime-v1', "lxe_sha256=$explorerHash") |
  Set-Content -LiteralPath (Join-Path $explorerOutput 'BUILDINFO.txt') -Encoding ascii
$cudaSource = Join-Path $sourceBuild 'laser-cuda-miner.exe'
$cudaOutput = Join-Path $output 'laser-cuda-miner.exe'
if (Test-Path -LiteralPath $cudaSource -PathType Leaf) {
  Copy-Item -LiteralPath $cudaSource -Destination $cudaOutput -Force
} elseif (Test-Path -LiteralPath $cudaOutput) {
  Remove-Item -LiteralPath $cudaOutput -Force
}

$sourceCommit = (& git -C $SourceRoot rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
  throw 'Unable to resolve the Laser node source commit.'
}
$sourceStatus = @(& git -C $SourceRoot status --porcelain --untracked-files=no -- src include apps vendor components Makefile)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Laser node source worktree.' }
$sourceDirty = $sourceStatus.Count -gt 0

$laser = Join-Path $output 'laser.exe'
$laserd = Join-Path $output 'laserd.exe'
$shadow = Join-Path $output 'laser-shadow.exe'
$laserVersion = (& $laser --version | Out-String).Trim()
$laserdVersion = (& $laserd --version | Out-String).Trim()
if ($laserVersion -notmatch '^Laser (.+)$' -or $laserdVersion -ne "laserd $($Matches[1])") {
  throw "Staged node runtime versions do not match: $laserVersion / $laserdVersion"
}

$buildInfo = @(
  'channel=v3'
  "source_commit=$sourceCommit"
  "source_dirty=$($sourceDirty.ToString().ToLowerInvariant())"
  "laser_version=$laserVersion"
  "laserd_version=$laserdVersion"
  'network=shadow'
  'wire_protocol=3'
  'store_format=3'
  "laser_sha256=$((Get-FileHash -LiteralPath $laser -Algorithm SHA256).Hash.ToLowerInvariant())"
  "laserd_sha256=$((Get-FileHash -LiteralPath $laserd -Algorithm SHA256).Hash.ToLowerInvariant())"
  "laser_shadow_sha256=$((Get-FileHash -LiteralPath $shadow -Algorithm SHA256).Hash.ToLowerInvariant())"
)
if (Test-Path -LiteralPath $cudaOutput -PathType Leaf) {
  $buildInfo += "laser_cuda_miner_sha256=$((Get-FileHash -LiteralPath $cudaOutput -Algorithm SHA256).Hash.ToLowerInvariant())"
} else {
  $buildInfo += 'laser_cuda_miner_sha256=absent'
}
$buildInfo | Set-Content -LiteralPath (Join-Path $output 'BUILDINFO.txt') -Encoding ascii

Write-Output "Staged Laser v3 runtime in $output"
