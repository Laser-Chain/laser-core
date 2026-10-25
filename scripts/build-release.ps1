[CmdletBinding()]
param(
  [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AppRepoRoot = (& git -C $AppDir rev-parse --show-toplevel | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $AppRepoRoot) {
  throw 'Laser Core must be built from a Git checkout.'
}
$LaserSourceRoot = if ($env:LASER_SOURCE_DIR) {
  (Resolve-Path $env:LASER_SOURCE_DIR).Path
} else {
  (Resolve-Path (Join-Path $AppDir '..')).Path
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Program,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE"
  }
}

function Read-KeyValueFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding utf8) {
    $separator = $line.IndexOf('=')
    if ($separator -gt 0) {
      $values[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
    }
  }
  return $values
}

Push-Location $AppDir
try {
  if (-not (Test-Path -LiteralPath 'package-lock.json' -PathType Leaf)) {
    throw 'package-lock.json is required. Run npm install and commit the lockfile.'
  }

  $status = @(& git -C $AppRepoRoot status --porcelain --untracked-files=normal)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the source worktree.' }
  $dirty = $status.Count -gt 0
  $dirtyAllowed = $AllowDirty -or $env:LASER_ALLOW_DIRTY_BUILD -eq '1'
  if ($dirty -and -not $dirtyAllowed) {
    throw 'Refusing a release candidate from a dirty worktree. Commit the reviewed changes first.'
  }

  $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding utf8 | ConvertFrom-Json
  $appVersion = [string]$package.version
  if ($appVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Invalid Laser Core version: $appVersion"
  }

  & (Join-Path $PSScriptRoot 'stage-v3.ps1') -SourceRoot $LaserSourceRoot
  $v3Dir = Join-Path $AppDir '.runtime\v3'
  $laser = Join-Path $v3Dir 'laser.exe'
  $laserd = Join-Path $v3Dir 'laserd.exe'
  $shadow = Join-Path $v3Dir 'laser-shadow.exe'
  foreach ($binary in @($laser, $laserd, $shadow)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
      throw "Missing required v3 runtime: $binary"
    }
  }

  $laserVersion = (& $laser --version | Out-String).Trim()
  $laserdVersion = (& $laserd --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $laserVersion -notmatch '^Laser (.+)$') {
    throw 'Unable to read the bundled Laser CLI version.'
  }
  $nodeSemver = $Matches[1]
  if ($laserdVersion -ne "laserd $nodeSemver") {
    throw "Runtime version mismatch: $laserVersion / $laserdVersion"
  }
  $sourceCommit = (& git -C $AppRepoRoot rev-parse HEAD | Out-String).Trim()
  $sourceDate = (& git -C $AppRepoRoot show -s --format=%cI HEAD | Out-String).Trim()
  $v3Info = Read-KeyValueFile (Join-Path $v3Dir 'BUILDINFO.txt')
  $explorerHelperIdentity = (& node -e "console.log(require('./scripts/verify-publisher-package').verifyRuntime('.runtime/explorer'))" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Explorer publisher runtime verification failed.' }
  $cudaMiner = Join-Path $v3Dir 'laser-cuda-miner.exe'
  $cudaMinerIdentity = if (Test-Path -LiteralPath $cudaMiner -PathType Leaf) {
    (Get-FileHash -LiteralPath $cudaMiner -Algorithm SHA256).Hash.ToLowerInvariant()
  } else {
    'absent'
  }
  if ($cudaMinerIdentity -ne $v3Info.laser_cuda_miner_sha256) {
    throw 'The optional CUDA runtime does not match v3 BUILDINFO.txt.'
  }

  $sandboxDir = Join-Path $AppDir '.runtime\sandbox-v2'
  $sandboxInfoPath = Join-Path $sandboxDir 'BUILDINFO.txt'
  $sandboxLaser = Join-Path $sandboxDir 'laser.exe'
  $sandboxLaserd = Join-Path $sandboxDir 'laserd.exe'
  foreach ($file in @($sandboxInfoPath, $sandboxLaser, $sandboxLaserd)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw 'The pinned sandbox runtime is incomplete. Run npm run prepare:sandbox.'
    }
  }
  $sandboxInfo = Read-KeyValueFile $sandboxInfoPath
  $sandboxLaserHash = (Get-FileHash -LiteralPath $sandboxLaser -Algorithm SHA256).Hash.ToLowerInvariant()
  $sandboxLaserdHash = (Get-FileHash -LiteralPath $sandboxLaserd -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sandboxLaserHash -ne $sandboxInfo.laser_sha256 -or
      $sandboxLaserdHash -ne $sandboxInfo.laserd_sha256) {
    throw 'The pinned sandbox runtime does not match BUILDINFO.txt.'
  }

  Invoke-Checked npm test
  Invoke-Checked npm run dist:win

  $artifactName = "Laser-Core-$appVersion-portable-x64.exe"
  $artifact = Join-Path $AppDir "dist\$artifactName"
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "electron-builder did not produce $artifactName"
  }

  $releaseDir = Join-Path $AppDir "dist\release\Laser-Core-$appVersion-windows-x64"
  if (Test-Path -LiteralPath $releaseDir) {
    throw "Release directory already exists: $releaseDir"
  }
  $candidateDir = "$releaseDir.staging-$PID"
  if (Test-Path -LiteralPath $candidateDir) {
    throw "Release staging directory already exists: $candidateDir"
  }
  New-Item -ItemType Directory -Path $candidateDir | Out-Null
  Copy-Item -LiteralPath $artifact -Destination (Join-Path $candidateDir $artifactName)
  Copy-Item -LiteralPath (Join-Path $AppDir 'NOTICE.txt') -Destination $candidateDir
  Copy-Item -LiteralPath (Join-Path $AppDir 'RELEASE_NOTES.md') -Destination $candidateDir
  $sbom = @(& npm sbom --sbom-format spdx)
  if ($LASTEXITCODE -ne 0 -or $sbom.Count -eq 0) {
    throw 'npm failed to generate the SPDX dependency inventory.'
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText(
    (Join-Path $candidateDir 'SBOM.spdx.json'),
    ($sbom -join [Environment]::NewLine) + [Environment]::NewLine,
    $utf8NoBom
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $artifact
  if ($signature.Status -notin @('Valid', 'NotSigned')) {
    throw "The executable has an invalid Authenticode status: $($signature.Status)"
  }
  $electronVersion = (& node -p "require('./package-lock.json').packages['node_modules/electron'].version" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $electronVersion) {
    throw 'Unable to resolve the locked Electron version.'
  }
  $buildInfo = @(
    'format=laser-core-release-v1'
    "app_version=$appVersion"
    "source_commit=$sourceCommit"
    "source_commit_date=$sourceDate"
    "source_dirty=$($dirty.ToString().ToLowerInvariant())"
    'platform=windows-x64'
    'package_target=portable'
    "electron_version=$electronVersion"
    "laser_version=$laserVersion"
    "laserd_version=$laserdVersion"
    "node_source_commit=$($v3Info.source_commit)"
    "node_source_dirty=$($v3Info.source_dirty)"
    "cuda_miner_sha256=$cudaMinerIdentity"
    "explorer_helper_sha256=$explorerHelperIdentity"
    'default_network=shadow'
    'wire_protocol=3'
    'block_store_version=3'
    "sandbox_source_commit=$($sandboxInfo.source_commit)"
    'project_license=UNLICENSED'
    "authenticode_status=$($signature.Status)"
  )
  $buildInfoPath = Join-Path $candidateDir 'BUILDINFO.txt'
  Set-Content -LiteralPath $buildInfoPath -Value $buildInfo -Encoding utf8

  $manifestNames = @(
    $artifactName,
    'BUILDINFO.txt',
    'NOTICE.txt',
    'RELEASE_NOTES.md',
    'SBOM.spdx.json'
  )
  $manifest = foreach ($name in $manifestNames) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $candidateDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $name"
  }
  Set-Content -LiteralPath (Join-Path $candidateDir 'SHA256SUMS') -Value $manifest -Encoding ascii

  $verifyScript = Join-Path $PSScriptRoot 'verify-release.ps1'
  if ($dirty) {
    & $verifyScript -ReleaseDir $candidateDir -AllowDirty
  } else {
    & $verifyScript -ReleaseDir $candidateDir
  }
  if ($LASTEXITCODE -ne 0) { throw 'Release verification failed.' }
  Move-Item -LiteralPath $candidateDir -Destination $releaseDir

  Write-Host "Laser Core candidate prepared: $releaseDir"
  if ($signature.Status -eq 'NotSigned') {
    Write-Warning 'Candidate is not Authenticode-signed. Do not publish it as a final Windows release.'
  }
} finally {
  Pop-Location
}
