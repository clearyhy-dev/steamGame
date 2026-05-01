# Deploy API + Admin + ffmpeg image to Cloud Run (uses repo-root Dockerfile).
# Run from repo root:  .\scripts\deploy-cloud-run.ps1
# Requires: gcloud auth, project with Cloud Run + Cloud Build enabled.

param(
  [string]$ProjectId = "steamdeal",
  [string]$Region = "asia-southeast1",
  [string]$Service = "steam-game-api",
  [string]$ServiceUrl = "https://steam-game-api-r7vmg7elga-as.a.run.app",
  [string]$JwtSecret = "",
  [string]$SteamApiKey = "",
  [string]$FirebaseProjectId = "steamdeal",
  [string]$AdminUsername = "admin",
  [string]$AdminPassword = "",
  [string]$Memory = "1Gi",
  [int]$Cpu = 1,
  [int]$TimeoutSec = 3600,
  [int]$MaxInstances = 1,
  [int]$MinInstances = 0,
  [switch]$SkipBuild,
  [switch]$CostOptimized
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Tmp = Join-Path $RepoRoot ".deploy-tmp"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

$env:TEMP = $Tmp
$env:TMP = $Tmp
$env:TMPDIR = $Tmp

Set-Location $RepoRoot

Write-Host "Repo: $RepoRoot"
Write-Host "TEMP: $Tmp"
Write-Host "Deploying $Service to $ProjectId ($Region)..."
Write-Host "(Must run from repo root so Cloud Build uses root Dockerfile: API + admin dist + ffmpeg)"

if ($CostOptimized) {
  if ($Memory -eq "1Gi") { $Memory = "512Mi" }
  if ($Cpu -eq 1) { $Cpu = 1 }
  if ($MaxInstances -gt 1) { $MaxInstances = 1 }
  if ($TimeoutSec -gt 1800) { $TimeoutSec = 1800 }
}

if ([string]::IsNullOrWhiteSpace($JwtSecret)) {
  throw "JwtSecret is required. Example: -JwtSecret `"your-strong-secret`""
}
if ([string]::IsNullOrWhiteSpace($SteamApiKey)) {
  throw "SteamApiKey is required. Example: -SteamApiKey `"xxxxx`""
}
if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw "AdminPassword is required. Example: -AdminPassword `"your-admin-pass`""
}

$envPairs = @(
  "SERVE_ADMIN_STATIC=true",
  "NODE_ENV=production",
  "ADMIN_DIST_PATH=/app/admin/dist",
  "JWT_EXPIRES_IN=30d",
  "STEAM_REALM=$ServiceUrl",
  "STEAM_RETURN_URL=$ServiceUrl/auth/steam/callback",
  "APP_BASE_URL=$ServiceUrl",
  "APP_DEEP_LINK_SCHEME=myapp",
  "APP_DEEP_LINK_SUCCESS_HOST=auth",
  "APP_DEEP_LINK_FAIL_HOST=auth",
  "APP_CONNECT_TIMEOUT_SEC=15",
  "APP_RECEIVE_TIMEOUT_SEC=90",
  "STEAM_HTTP_TIMEOUT_MS=8000",
  "STEAM_AUTO_SYNC_ENABLED=true",
  "STEAM_AUTO_SYNC_INTERVAL_MS=3600000",
  "STEAM_AUTO_SYNC_BATCH_SIZE=200",
  "STEAM_AUTO_SYNC_DELAY_MS=120",
  "FIREBASE_PROJECT_ID=$FirebaseProjectId",
  "ADMIN_USERNAME=$AdminUsername",
  "ADMIN_PASSWORD=$AdminPassword",
  "JWT_SECRET=$JwtSecret",
  "STEAM_API_KEY=$SteamApiKey"
)

if ($SkipBuild) {
  Write-Host "SkipBuild=true: updating Cloud Run runtime settings/env only (no Cloud Build)."
  gcloud run services update $Service `
    --project=$ProjectId `
    --region=$Region `
    --memory=$Memory `
    --cpu=$Cpu `
    --timeout=$TimeoutSec `
    --max-instances=$MaxInstances `
    --min-instances=$MinInstances `
    "--update-env-vars=$($envPairs -join ',')"
} else {
  gcloud run deploy $Service `
    --project=$ProjectId `
    --source . `
    --region=$Region `
    --allow-unauthenticated `
    --memory=$Memory `
    --cpu=$Cpu `
    --timeout=$TimeoutSec `
    --max-instances=$MaxInstances `
    --min-instances=$MinInstances `
    "--update-env-vars=$($envPairs -join ',')"
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Done. Service URL:"
gcloud run services describe $Service --project=$ProjectId --region=$Region --format="value(status.url)"
