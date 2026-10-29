param(
  [string]$SourceRoot = $env:LASER_SOURCE_DIR,
  [string]$ExplorerSourceRoot = $env:LASER_EXPLORER_SOURCE_DIR
)
$ErrorActionPreference = 'Stop'
if (-not $SourceRoot -or -not $ExplorerSourceRoot) {
  throw 'Set LASER_SOURCE_DIR and LASER_EXPLORER_SOURCE_DIR to authorized native and explorer source checkouts.'
}
& node (Join-Path $PSScriptRoot 'build-runtimes.js') --source $SourceRoot --explorer-source $ExplorerSourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Fresh runtime compilation failed. Existing build evidence has been retained.' }
