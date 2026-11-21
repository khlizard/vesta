<#
.SYNOPSIS
  Builds the release vesta.exe and overwrites the installed one, to try a change in the real
  environment. Spec: docs/spec/update.md「手元の確認用の上書き」

.DESCRIPTION
  1. scripts/build-exe.ps1 (npm run tauri build -- --no-bundle, without the user name in the exe)
  2. Closes Vesta if it runs from %LocalAppData%\Vesta (the window is closed normally, so tabs and
     settings are saved; forced after 10 seconds). A `tauri dev` instance is left alone.
  3. Copies the exe over %LocalAppData%\Vesta\current\vesta.exe
  No Velopack package is made and the version is not changed.

.EXAMPLE
  ./scripts/install-local.ps1
.EXAMPLE
  ./scripts/install-local.ps1 -Start   # start the installed Vesta afterwards
#>
param([switch]$Start)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$InstallDir = Join-Path $env:LOCALAPPDATA "Vesta"
$Installed = Join-Path $InstallDir "current\vesta.exe"

if (-not (Test-Path $Installed)) {
  throw "Vesta is not installed ($Installed). Install it once with Vesta-win-Setup.exe (scripts/release.ps1 -NoUpload)."
}

Push-Location $Root
try {
  # Builds without the Windows user name in the exe (see build-exe.ps1).
  $exe = & (Join-Path $PSScriptRoot "build-exe.ps1")

  # ---- close the installed Vesta (only the one running from the install folder)
  $running = @(Get-Process vesta -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) })
  foreach ($p in $running) {
    Write-Host "Closing Vesta (pid $($p.Id))"
    [void]$p.CloseMainWindow()
  }
  foreach ($p in $running) {
    if (-not $p.WaitForExit(10000)) {
      Write-Warning "Vesta (pid $($p.Id)) did not close; stopping it"
      Stop-Process -Id $p.Id -Force
      $p.WaitForExit(5000) | Out-Null
    }
  }

  Copy-Item $exe $Installed -Force
  $info = Get-Item $Installed
  Write-Host "Installed $($info.FullName) ($($info.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))"
  if ($Start) { Start-Process (Join-Path $InstallDir "Vesta.exe") }
} finally {
  Pop-Location
}
