<#
.SYNOPSIS
    대상 프로젝트 Windows 버전업 셋업 파일(.exe) 생성 및 Cloudflare R2 업로드 스크립트
.DESCRIPTION
    셋업 파일을 제공하는 프로젝트(Inno Setup, Wails, Tauri, Electron 등)에서
    버전을 읽어 Windows 설치 프로그램(.exe)과 SHA-256 해시/latest.json을 생성하고,
    Cloudflare R2 버킷으로 자동 업로드합니다.
#>

[CmdletBinding()]
param(
    [string]$Version = "",
    [switch]$SkipUpload = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
Set-Location $rootDir

# 1. 버전 및 앱 슬러그 감지
$appSlug = Split-Path -Leaf $rootDir
$pkgPath = Join-Path $rootDir "package.json"
if (Test-Path $pkgPath) {
    $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pkg.name -eq "@neohum77/create-agent-harness") {
        throw "create-agent-harness 자체는 GitHub로만 배포합니다. 셋업 파일을 만드는 대상 프로젝트에서만 실행하세요."
    }
    if ($pkg.name) {
        $appSlug = ($pkg.name -replace '^@[^/]+/', '').Trim()
    }
    if (-not $Version -and $pkg.version) {
        $Version = $pkg.version
    }
}

$verFile = Join-Path $rootDir "VERSION"
if (-not $Version -and (Test-Path $verFile)) {
    $Version = (Get-Content $verFile -Raw -Encoding UTF8).Trim()
}
if (-not $Version) { $Version = "0.1.0" }
$Version = $Version.TrimStart("v")

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 📦 Windows Setup Installer Builder & R2 Publisher" -ForegroundColor Cyan
Write-Host "    Target: $appSlug v$Version" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

$distDir = Join-Path $rootDir "dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
$outSetupPath = Join-Path $distDir "$appSlug-setup-v$Version.exe"

if ($DryRun) {
    Write-Host "[DRY RUN] Setup file would be built at: $outSetupPath" -ForegroundColor Yellow
    node --disable-warning=ExperimentalWarning (Join-Path $rootDir "scripts\release\release-r2.ts") --dry-run --version $Version
    exit 0
}

# 2. Inno Setup (.iss) 또는 Wails NSIS 빌드
$issFiles = @()
$installerDir = Join-Path $rootDir "installer"
if (Test-Path $installerDir) {
    $issFiles = @(Get-ChildItem -Path $installerDir -Filter "*.iss" -File)
}

if ($issFiles.Count -gt 0) {
    $iscc = $null
    foreach ($cand in @("C:\Program Files (x86)\Inno Setup 6\ISCC.exe", "C:\Program Files\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $cand) { $iscc = $cand; break }
    }
    if (-not $iscc) {
        $cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
        if ($cmd) { $iscc = $cmd.Source }
    }
    if (-not $iscc) {
        throw "Inno Setup 6 (ISCC.exe) not found."
    }

    $issPath = $issFiles[0].FullName
    $outputBase = "$appSlug-setup-v$Version"
    Write-Host "Compiling Inno Setup installer: $issPath -> dist\$outputBase.exe" -ForegroundColor Cyan
    & $iscc "/Qp" "/O$distDir" "/F$outputBase" "/DMyAppVersion=$Version" "/DAppVersion=$Version" $issPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outSetupPath)) {
        throw "Inno Setup compilation failed (exit $LASTEXITCODE)"
    }
} elseif (Test-Path (Join-Path $rootDir "wails.json")) {
    Write-Host "Building Wails NSIS installer..." -ForegroundColor Cyan
    & wails build -clean -nsis -platform windows/amd64
    if ($LASTEXITCODE -ne 0) { throw "wails build -nsis failed (exit $LASTEXITCODE)" }
    $binCandidates = Get-ChildItem -Path (Join-Path $rootDir "build\bin") -Filter "*.exe" | Sort-Object LastWriteTime -Descending
    if ($binCandidates) {
        Copy-Item $binCandidates[0].FullName $outSetupPath -Force
    }
}

if (-not (Test-Path $outSetupPath)) {
    throw "Setup installer was not produced at $outSetupPath"
}

$item = Get-Item -LiteralPath $outSetupPath
$hash = (Get-FileHash -LiteralPath $outSetupPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "✓ Setup Built: $($item.Name) ($([math]::Round($item.Length / 1MB, 2)) MB, SHA256=$hash)" -ForegroundColor Green

# 3. Cloudflare R2 업로드 및 매니페스트 생성
if (-not $SkipUpload) {
    Write-Host "`n☁️ Uploading Setup & latest.json to Cloudflare R2..." -ForegroundColor Cyan
    node --disable-warning=ExperimentalWarning (Join-Path $rootDir "scripts\release\release-r2.ts") --upload --installer $outSetupPath --version $Version
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    node --disable-warning=ExperimentalWarning (Join-Path $rootDir "scripts\release\release-r2.ts") --dry-run --installer $outSetupPath --version $Version
}