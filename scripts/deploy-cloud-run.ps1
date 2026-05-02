# Deploy API + Admin + ffmpeg image to Cloud Run (uses repo-root Dockerfile).
# Run from repo root:  .\scripts\deploy-cloud-run.ps1
# Requires: gcloud auth, project with Cloud Run + Cloud Build enabled.
#
# Secrets: server\.env and/or JWT_SECRET, STEAM_API_KEY, ADMIN_PASSWORD (User env).
# If credentials already exist on Cloud Run only: .\deploy-cloud-run.ps1 -PreserveCloudRunEnv
#   or set DEPLOY_PRESERVE_CLOUD_RUN_ENV=1 (deploy new image without --update-env-vars).

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
  [switch]$CostOptimized,
  [switch]$PreserveCloudRunEnv
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Tmp = Join-Path $RepoRoot ".deploy-tmp"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

$env:TEMP = $Tmp
$env:TMP = $Tmp
$env:TMPDIR = $Tmp

Set-Location $RepoRoot

$PreserveEnv = [bool]$PreserveCloudRunEnv
if (($env:DEPLOY_PRESERVE_CLOUD_RUN_ENV -eq "1") -or ($env:DEPLOY_PRESERVE_CLOUD_RUN_ENV -match '^(?i)true$')) {
  $PreserveEnv = $true
}

Write-Host "Repo: $RepoRoot"
Write-Host "TEMP: $Tmp"
Write-Host "Deploying $Service to $ProjectId ($Region)..."
Write-Host "(Must run from repo root so Cloud Build uses root Dockerfile: API + admin dist + ffmpeg)"

function Get-EnvAny([string]$Name) {
  foreach ($scope in @("Process", "User", "Machine")) {
    $v = [Environment]::GetEnvironmentVariable($Name, $scope)
    if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
  }
  return ""
}

function Read-ServerDotEnv([string]$LiteralPath) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $LiteralPath)) { return $map }
  Get-Content -LiteralPath $LiteralPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if (
      ($val.Length -ge 2 -and $val.StartsWith('"') -and $val.EndsWith('"')) -or
      ($val.Length -ge 2 -and $val.StartsWith("'") -and $val.EndsWith("'"))
    ) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $map[$k] = $val
  }
  return $map
}

# Fill secrets from server\.env and/or OS env (README: optional server/.env; or set JWT_SECRET, STEAM_API_KEY, ADMIN_PASSWORD).
$dotEnv = Read-ServerDotEnv (Join-Path $RepoRoot "server\.env")
if ([string]::IsNullOrWhiteSpace($JwtSecret)) {
  $JwtSecret = $dotEnv["JWT_SECRET"]
  if ([string]::IsNullOrWhiteSpace($JwtSecret)) { $JwtSecret = Get-EnvAny "JWT_SECRET" }
}
if ([string]::IsNullOrWhiteSpace($SteamApiKey)) {
  $SteamApiKey = $dotEnv["STEAM_API_KEY"]
  if ([string]::IsNullOrWhiteSpace($SteamApiKey)) { $SteamApiKey = Get-EnvAny "STEAM_API_KEY" }
}
if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  $AdminPassword = $dotEnv["ADMIN_PASSWORD"]
  if ([string]::IsNullOrWhiteSpace($AdminPassword)) { $AdminPassword = Get-EnvAny "ADMIN_PASSWORD" }
}
$au = Get-EnvAny "ADMIN_USERNAME"
if (-not [string]::IsNullOrWhiteSpace($au)) { $AdminUsername = $au }
elseif ($dotEnv.ContainsKey("ADMIN_USERNAME") -and -not [string]::IsNullOrWhiteSpace($dotEnv["ADMIN_USERNAME"])) {
  $AdminUsername = $dotEnv["ADMIN_USERNAME"]
}
$gcpProj = Get-EnvAny "GOOGLE_CLOUD_PROJECT"
if ([string]::IsNullOrWhiteSpace($gcpProj)) { $gcpProj = Get-EnvAny "GCLOUD_PROJECT" }
if (-not [string]::IsNullOrWhiteSpace($gcpProj)) { $ProjectId = $gcpProj }
$fb = Get-EnvAny "FIREBASE_PROJECT_ID"
if (-not [string]::IsNullOrWhiteSpace($fb)) { $FirebaseProjectId = $fb }
elseif ($dotEnv.ContainsKey("FIREBASE_PROJECT_ID") -and -not [string]::IsNullOrWhiteSpace($dotEnv["FIREBASE_PROJECT_ID"])) {
  $FirebaseProjectId = $dotEnv["FIREBASE_PROJECT_ID"]
}

if (-not [string]::IsNullOrWhiteSpace($JwtSecret) -and -not [string]::IsNullOrWhiteSpace($SteamApiKey) -and -not [string]::IsNullOrWhiteSpace($AdminPassword)) {
  Write-Host "Credentials: loaded JWT_SECRET, STEAM_API_KEY, ADMIN_PASSWORD (from server\.env and/or environment)."
}

if ($CostOptimized) {
  if ($Memory -eq "1Gi") { $Memory = "512Mi" }
  if ($Cpu -eq 1) { $Cpu = 1 }
  if ($MaxInstances -gt 1) { $MaxInstances = 1 }
  if ($TimeoutSec -gt 1800) { $TimeoutSec = 1800 }
}

if (-not $PreserveEnv) {
  if ([string]::IsNullOrWhiteSpace($JwtSecret)) {
    throw "JwtSecret is required (set JWT_SECRET / server\.env), or use -PreserveCloudRunEnv if secrets already exist on Cloud Run."
  }
  if ([string]::IsNullOrWhiteSpace($SteamApiKey)) {
    throw "SteamApiKey is required (set STEAM_API_KEY / server\.env), or use -PreserveCloudRunEnv."
  }
  if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
    throw "AdminPassword is required (set ADMIN_PASSWORD / server\.env), or use -PreserveCloudRunEnv."
  }
}
else {
  Write-Host "PreserveCloudRunEnv: deploying without --update-env-vars; Cloud Run keeps existing environment variables."
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
  Write-Host "SkipBuild=true: updating Cloud Run runtime settings only (no Cloud Build)."
  if ($PreserveEnv) {
    gcloud run services update $Service `
      --project=$ProjectId `
      --region=$Region `
      --memory=$Memory `
      --cpu=$Cpu `
      --timeout=$TimeoutSec `
      --max-instances=$MaxInstances `
      --min-instances=$MinInstances
  } else {
    gcloud run services update $Service `
      --project=$ProjectId `
      --region=$Region `
      --memory=$Memory `
      --cpu=$Cpu `
      --timeout=$TimeoutSec `
      --max-instances=$MaxInstances `
      --min-instances=$MinInstances `
      "--update-env-vars=$($envPairs -join ',')"
  }
} else {
  if ($PreserveEnv) {
    gcloud run deploy $Service `
      --project=$ProjectId `
      --source . `
      --region=$Region `
      --allow-unauthenticated `
      --memory=$Memory `
      --cpu=$Cpu `
      --timeout=$TimeoutSec `
      --max-instances=$MaxInstances `
      --min-instances=$MinInstances
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
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Done. Service URL:"
gcloud run services describe $Service --project=$ProjectId --region=$Region --format="value(status.url)"
