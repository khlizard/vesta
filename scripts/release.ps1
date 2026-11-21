<#
.SYNOPSIS
  Builds Vesta, packs it with Velopack and publishes it to GitHub Releases. Spec: docs/spec/update.md

.DESCRIPTION
  1. scripts/build-exe.ps1               (vesta.exe; the UI and default settings are embedded,
                                          and the Windows user name of the builder is kept out)
  2. vpk download github                 (the previous release, so a delta package can be made)
  3. vpk pack                            (Vesta-win-Setup.exe, a portable zip, full and delta packages)
  4. vpk upload github                   (creates the release v<version>)
  The "## <version>" section of CHANGELOG.md becomes the release notes (in the package and on GitHub).

  Needs: Node, Rust, the vpk tool (dotnet tool install -g vpk --version 1.2.161).
  GITHUB_TOKEN (or -Token) must be able to write repository contents. Not needed with -NoUpload.

.EXAMPLE
  $env:GITHUB_TOKEN = "<token>"; ./scripts/release.ps1
.EXAMPLE
  ./scripts/release.ps1 -NoUpload   # build and pack only, into build/velopack/releases
#>
param(
  [string]$Token = $env:GITHUB_TOKEN,
  [switch]$NoUpload
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoUrl = "https://github.com/khlizard/vesta"   # same as REPO_URL in src-tauri/src/update.rs
$PackId = "Vesta"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Out = Join-Path $Root "build/velopack"
$Publish = Join-Path $Out "publish"
$Releases = Join-Path $Out "releases"

function Invoke-Native([string]$What, [scriptblock]$Block) {
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

# Text under "## <version>" (optionally "## v<version> ...") up to the next "## " heading.
function Get-ReleaseNotes([string]$Path, [string]$Version) {
  $lines = Get-Content $Path -Encoding utf8
  $heading = "^##\s+v?" + [regex]::Escape($Version) + "(\s|$)"
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $heading) { $start = $i + 1; break } }
  if ($start -lt 0) { throw "CHANGELOG.md has no section '## $Version'. Write the changes first." }
  $end = $lines.Count
  for ($i = $start; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^##\s") { $end = $i; break } }
  $body = (($lines[$start..($end - 1)]) -join "`n").Trim()
  if (-not $body) { throw "The '## $Version' section of CHANGELOG.md is empty." }
  return $body
}

# Puts the notes into the body of the GitHub release (vpk may leave it empty).
function Set-ReleaseBody([string]$Repo, [string]$Tag, [string]$Body, [string]$Token) {
  $api = "https://api.github.com/repos/$Repo/releases"
  $headers = @{ Authorization = "Bearer $Token"; Accept = "application/vnd.github+json"; "User-Agent" = "vesta-release" }
  $release = Invoke-RestMethod -Uri "$api/tags/$Tag" -Headers $headers
  $payload = @{ body = $Body } | ConvertTo-Json
  Invoke-RestMethod -Method Patch -Uri "$api/$($release.id)" -Headers $headers -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
}

Push-Location $Root
try {
  # ---- version: the three files must agree, and match the tag when run from a tag build
  $version = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
  $pkgVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $cargoVersion = (Select-String -Path src-tauri/Cargo.toml -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
  if ($pkgVersion -ne $version -or $cargoVersion -ne $version) {
    throw "Versions differ: tauri.conf.json $version, package.json $pkgVersion, Cargo.toml $cargoVersion"
  }
  if ($env:GITHUB_REF_TYPE -eq "tag" -and $env:GITHUB_REF_NAME -ne "v$version") {
    throw "Tag $($env:GITHUB_REF_NAME) does not match version v$version"
  }
  if (-not $NoUpload -and -not $Token) { throw "GITHUB_TOKEN (or -Token) is required to upload; use -NoUpload to only pack" }
  Write-Host "Vesta $version"

  # ---- release notes: the "## <version>" section of CHANGELOG.md (required)
  $notes = Get-ReleaseNotes (Join-Path $Root "CHANGELOG.md") $version
  New-Item -ItemType Directory -Force $Out | Out-Null
  $NotesFile = Join-Path $Out "notes.md"
  Set-Content -Path $NotesFile -Value $notes -Encoding utf8

  # ---- build vesta.exe
  # Builds without the Windows user name in the exe, and checks that (see build-exe.ps1).
  $exe = & (Join-Path $PSScriptRoot "build-exe.ps1")

  # ---- a clean folder holding only what is installed
  Remove-Item $Publish -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $Publish, $Releases | Out-Null
  Copy-Item $exe $Publish
  # The licences of Vesta and of the libraries in the exe go with every copy.
  Copy-Item (Join-Path $Root "LICENSE"), (Join-Path $Root "THIRD-PARTY-NOTICES.md") $Publish

  # ---- previous release (for delta updates); none yet is fine
  if ($Token) {
    vpk download github --repoUrl $RepoUrl --token $Token -o $Releases
    if ($LASTEXITCODE -ne 0) { Write-Warning "No previous release downloaded; only a full package will be made" }
  }

  # ---- pack
  Invoke-Native "vpk pack" {
    vpk pack -u $PackId -v $version -p $Publish -e vesta.exe -o $Releases -r win-x64 `
      --packTitle Vesta --packAuthors khlizard `
      -i (Join-Path $Root "src-tauri/icons/icon.ico") `
      --framework webview2 --releaseNotes $NotesFile
  }

  # ---- publish
  if ($NoUpload) {
    Write-Host "Packed into $Releases (not uploaded)"
  } else {
    Invoke-Native "vpk upload" {
      vpk upload github --repoUrl $RepoUrl --token $Token -o $Releases `
        --publish --releaseName "Vesta $version" --tag "v$version"
    }
    Set-ReleaseBody ($RepoUrl -replace "^https://github.com/", "") "v$version" $notes $Token
    Write-Host "Published $RepoUrl/releases/tag/v$version"
  }
} finally {
  Pop-Location
}
