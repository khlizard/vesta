<#
.SYNOPSIS
  Builds the release vesta.exe and prints its path. Used by release.ps1 and install-local.ps1.

.DESCRIPTION
  Rust keeps the source paths of the crates it links (for panic messages), and those paths sit
  under the home folder: C:\Users\<name>\.cargo\registry\... A plain build therefore puts the
  Windows user name of whoever built it into the exe. This script replaces the folders that can
  hold the name (home, cargo home, the repository, the build output) with fixed words, and then
  fails if "Users\<name>" is still found in the exe.

  The first build after this script changes rebuilds everything (the compiler flags changed).
#>
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location (Join-Path $Root "src-tauri")
try {
  $target = (cargo metadata --no-deps --format-version 1 | ConvertFrom-Json).target_directory
} finally { Pop-Location }
if (-not $target) { throw "cargo metadata did not report the target directory" }

# A later rule wins over an earlier one, so the narrower folders come last.
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME ".cargo" }
$remap = [ordered]@{
  $HOME                           = "~"
  $cargoHome                      = "~cargo"
  ([IO.Path]::GetFullPath($target)) = "target"
  $Root                           = "."
}
$flags = @()
if ($env:RUSTFLAGS) { $flags += $env:RUSTFLAGS -split "\s+" | Where-Object { $_ } }
foreach ($from in $remap.Keys) { $flags += "--remap-path-prefix=$from=$($remap[$from])" }

$oldFlags = $env:CARGO_ENCODED_RUSTFLAGS
# Separated by U+001F, so a path with a space stays one argument.
$env:CARGO_ENCODED_RUSTFLAGS = $flags -join [char]0x1f
Push-Location $Root
try {
  npm run tauri build -- --no-bundle | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit code $LASTEXITCODE)" }
} finally {
  Pop-Location
  $env:CARGO_ENCODED_RUSTFLAGS = $oldFlags
}

$exe = Join-Path $target "release/vesta.exe"
if (-not (Test-Path $exe)) { throw "Not found: $exe" }

# The name must not be in the exe, as bytes or as UTF-16 text.
$name = Split-Path -Leaf $HOME
$needle = [regex]::Escape("Users\$name")
$bytes = [IO.File]::ReadAllBytes($exe)
$options = [Text.RegularExpressions.RegexOptions]::IgnoreCase
$found = [regex]::Matches([Text.Encoding]::Latin1.GetString($bytes), $needle, $options).Count +
  [regex]::Matches([Text.Encoding]::Unicode.GetString($bytes), $needle, $options).Count
if ($found -gt 0) {
  throw "The built exe contains the Windows user name ($found places: 'Users\$name'). Do not distribute it; fix the path rules in scripts/build-exe.ps1."
}

return (Resolve-Path $exe).Path
