param(
  [string]$RepoRoot,
  [string]$BashPath = $env:LASER_BASH
)

$ErrorActionPreference = 'Stop'
$Commit = 'c651572d5061e2e382a036ed538b305b70d6cb42'

if (-not $RepoRoot) {
  $RepoRoot = if ($env:LASER_SOURCE_DIR) {
    (Resolve-Path $env:LASER_SOURCE_DIR).Path
  } else {
    (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  }
}
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
  throw "Laser source repository not found at $RepoRoot. Set LASER_SOURCE_DIR to its absolute path."
}
if (-not $BashPath) {
  $candidate = 'C:\msys64\usr\bin\bash.exe'
  if (Test-Path $candidate) { $BashPath = $candidate }
}
if (-not $BashPath -or -not (Test-Path $BashPath)) {
  throw 'MSYS2 bash was not found. Set LASER_BASH to its absolute path.'
}

$work = Join-Path $env:TEMP ("laser-sandbox-v2-" + [Guid]::NewGuid().ToString('N'))
$archive = "$work.tar"
$output = Join-Path $PSScriptRoot '..\.runtime\sandbox-v2'
$compatPatches = @(
  (Resolve-Path (Join-Path $PSScriptRoot '..\compat\sandbox-v2-sync.patch')).Path
  (Resolve-Path (Join-Path $PSScriptRoot '..\compat\sandbox-v2-miner-metrics.patch')).Path
  (Resolve-Path (Join-Path $PSScriptRoot '..\compat\sandbox-v2-live-state-lock.patch')).Path
)
New-Item -ItemType Directory -Path $work -Force | Out-Null
New-Item -ItemType Directory -Path $output -Force | Out-Null

& git -C $RepoRoot archive --format=tar --output=$archive $Commit
if ($LASTEXITCODE -ne 0) { throw 'Unable to archive the pinned sandbox source.' }
& tar -xf $archive -C $work
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the pinned sandbox source.' }

function Convert-ToMsysPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path).Replace('\', '/')
  if ($resolved -match '^([A-Za-z]):/(.*)$') {
    return '/' + $Matches[1].ToLower() + '/' + $Matches[2]
  }
  return $resolved
}

$workMsys = Convert-ToMsysPath $work
foreach ($compatPatch in $compatPatches) {
  & git -C $work apply --check $compatPatch
  if ($LASTEXITCODE -ne 0) { throw "Sandbox patch check failed: $compatPatch" }
  & git -C $work apply $compatPatch
  if ($LASTEXITCODE -ne 0) { throw "Sandbox patch failed: $compatPatch" }
}
& $BashPath -lc "set -e; export PATH=/ucrt64/bin:/usr/bin:`$PATH; export CC=gcc; cd '$workMsys'; make REPRODUCIBLE=1 build/tests/test_block_store build/tests/test_control build/laser build/laserd; ./build/tests/test_block_store; ./build/tests/test_control; make REPRODUCIBLE=1 alpha7-test"
if ($LASTEXITCODE -ne 0) { throw 'Pinned sandbox runtime build failed.' }

foreach ($name in @('laser.exe', 'laserd.exe')) {
  $destination = Join-Path $output $name
  if (Test-Path $destination) {
    try {
      $handle = [IO.File]::Open($destination, 'Open', 'ReadWrite', 'None')
      $handle.Dispose()
    } catch {
      throw "Close Laser Core before replacing the sandbox runtime: $destination"
    }
  }
}
Copy-Item -LiteralPath (Join-Path $work 'build\laser.exe') -Destination $output -Force
Copy-Item -LiteralPath (Join-Path $work 'build\laserd.exe') -Destination $output -Force

$laserHash = (Get-FileHash -Algorithm SHA256 (Join-Path $output 'laser.exe')).Hash.ToLower()
$laserdHash = (Get-FileHash -Algorithm SHA256 (Join-Path $output 'laserd.exe')).Hash.ToLower()
$syncPatchHash = (Get-FileHash -Algorithm SHA256 $compatPatches[0]).Hash.ToLower()
$metricsPatchHash = (Get-FileHash -Algorithm SHA256 $compatPatches[1]).Hash.ToLower()
$stateLockPatchHash = (Get-FileHash -Algorithm SHA256 $compatPatches[2]).Hash.ToLower()
@(
  'channel=sandbox-v2'
  "source_commit=$Commit"
  'compat_patches=sandbox-v2-sync.patch,sandbox-v2-miner-metrics.patch,sandbox-v2-live-state-lock.patch'
  "sync_patch_sha256=$syncPatchHash"
  "miner_metrics_patch_sha256=$metricsPatchHash"
  "live_state_lock_patch_sha256=$stateLockPatchHash"
  'network=regtest'
  'wire_protocol=2'
  'store_format=1'
  "laser_sha256=$laserHash"
  "laserd_sha256=$laserdHash"
) | Set-Content -LiteralPath (Join-Path $output 'BUILDINFO.txt') -Encoding ascii

Write-Output "Built pinned sandbox runtime in $output"
Get-Content (Join-Path $output 'BUILDINFO.txt')
