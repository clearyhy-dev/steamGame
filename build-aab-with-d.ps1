# 使用 D 盘环境打包 AAB（Android App Bundle，用于上架 Google Play）
# 用法：在 PowerShell 中执行 .\build-aab-with-d.ps1
# 环境与 build-and-install-with-d.ps1 一致：Flutter、Pub、Gradle、Android SDK 均用 D 盘

$ErrorActionPreference = "Continue"
$env:PATH               = "D:\Android\Sdk\platform-tools;D:\development\flutter\bin;" + $env:PATH
$env:GRADLE_USER_HOME   = "D:\dev-config\gradle"
$env:PUB_CACHE          = "D:\dev-config\pub"
$env:ANDROID_HOME       = "D:\Android\Sdk"
$env:ANDROID_SDK_ROOT   = "D:\Android\Sdk"

Set-Location $PSScriptRoot

Write-Host "D drive env: Flutter, Pub, Gradle, Android SDK (all on D)..." -ForegroundColor Cyan
Write-Host "Running flutter clean..." -ForegroundColor Cyan
flutter clean
if ($LASTEXITCODE -ne 0) { Write-Host "flutter clean failed." -ForegroundColor Red; exit 1 }

Write-Host "Running flutter pub get..." -ForegroundColor Cyan
flutter pub get
if ($LASTEXITCODE -ne 0) { Write-Host "flutter pub get failed." -ForegroundColor Red; exit 1 }

Write-Host "Building release AAB..." -ForegroundColor Cyan
flutter build appbundle --release
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

$aab = ".\build\app\outputs\bundle\release\app-release.aab"
if (-not (Test-Path $aab)) { Write-Host "AAB not found. Check build\app\outputs\bundle\release." -ForegroundColor Red; exit 1 }

Write-Host "Done. AAB output: $((Resolve-Path $aab).Path)" -ForegroundColor Green
