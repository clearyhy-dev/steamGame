# Deploy API + Admin + ffmpeg image to Cloud Run (uses repo-root Dockerfile).
# Run from repo root:  .\scripts\deploy-cloud-run.ps1
# Requires: gcloud auth, project with Cloud Run + Cloud Build enabled.
#
# Secrets: server\.env and/or JWT_SECRET, STEAM_API_KEY, ADMIN_PASSWORD (User env).
# If credentials already exist on Cloud Run only: .\deploy-cloud-run.ps1 -PreserveCloudRunEnv
#   or set DEPLOY_PRESERVE_CLOUD_RUN_ENV=1 (deploy new image without --update-env-vars).
#
# Optional daily deal sync: set CRON_SECRET (server\.env or -CronSecret), deploy, then Cloud Scheduler →
#   POST {APP_BASE_URL}/api/internal/cron/daily-schedules  Header: X-Cron-Secret: <CRON_SECRET>
#   (runs ALL enabled scheduled tasks once — refreshes each task's lastRun status; catalog, deals, cache, etc.)
#   Or discount-only: POST .../daily-deal-schedules
#   Or legacy single shot: POST .../api/internal/cron/daily-deals  body {"topN":1000,...}
#   Schedule: daily 03:00 Asia/Shanghai (matches in-process node-cron on Cloud Run when min instances >= 1).
#
# Optional GCS JSON cache (trending / hot-deals / per-country snapshots): same CRON_SECRET, Scheduler →
#   POST {APP_BASE_URL}/api/internal/cron/build-cache  Header: X-Cron-Secret: <CRON_SECRET>
#   Set env GCS_CACHE_BUCKET (or rely on VIDEO_GCS_BUCKET). For the app to fetch CDN first, also set
#   PUBLIC_CACHE_CDN_BASE e.g. https://storage.googleapis.com/<bucket> (no trailing slash).
#   Suggested schedule: every 1–6 hours (after major catalog/deal syncs).

param(
  [string]$ProjectId = "steamdeal",
  [string]$Region = "asia-southeast1",
  [string]$Service = "steam-game-api",
  [string]$ServiceUrl = "https://steam-game-api-803425642695.asia-southeast1.run.app",
  [string]$JwtSecret = "",
  [string]$SteamApiKey = "",
  [string]$FirebaseProjectId = "steamdeal",
  [string]$AdminUsername = "admin",
  [string]$AdminPassword = "",
  [string]$CronSecret = "",
  [string]$Memory = "1Gi",
  [int]$Cpu = 1,
  [int]$TimeoutSec = 3600,
  [int]$MaxInstances = 1,
  [int]$MinInstances = 1,
  [switch]$SkipBuild,
  [switch]$CostOptimized,
  [switch]$PreserveCloudRunEnv
)

$ErrorActionPreference = "Stop"
# gcloud.ps1 将构建日志写到 stderr，勿让 PowerShell 误判为失败
$global:PSNativeCommandUseErrorActionPreference = $false
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
if ([string]::IsNullOrWhiteSpace($CronSecret)) {
  $CronSecret = $dotEnv["CRON_SECRET"]
  if ([string]::IsNullOrWhiteSpace($CronSecret)) { $CronSecret = Get-EnvAny "CRON_SECRET" }
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
  "STEAM_AUTO_SYNC_ENABLED=false",
  "STEAM_AUTO_SYNC_INTERVAL_MS=3600000",
  "STEAM_AUTO_SYNC_BATCH_SIZE=200",
  "STEAM_AUTO_SYNC_DELAY_MS=120",
  "FIREBASE_PROJECT_ID=$FirebaseProjectId",
  "ADMIN_USERNAME=$AdminUsername",
  "ADMIN_PASSWORD=$AdminPassword",
  "JWT_SECRET=$JwtSecret",
  "STEAM_API_KEY=$SteamApiKey",
  "DISCOUNT_OFFERS_PERSISTENCE=object_storage"
)

function Get-DotOrEnv([string]$Key) {
  if ($dotEnv.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($dotEnv[$Key])) { return $dotEnv[$Key] }
  return Get-EnvAny $Key
}

$cacheBackend = (Get-DotOrEnv "CACHE_UPLOAD_BACKEND").Trim().ToLower()
if ([string]::IsNullOrWhiteSpace($cacheBackend)) { $cacheBackend = "s3" }
$envPairs += "CACHE_UPLOAD_BACKEND=$cacheBackend"

$dealPriceDayTz = (Get-DotOrEnv "DEAL_SYNC_PRICE_DAY_TZ").Trim()
if ([string]::IsNullOrWhiteSpace($dealPriceDayTz)) { $dealPriceDayTz = "Asia/Shanghai" }
$envPairs += "DEAL_SYNC_PRICE_DAY_TZ=$dealPriceDayTz"

$bgWorkers = (Get-DotOrEnv "BACKGROUND_WORKERS_ENABLED").Trim().ToLower()
if ([string]::IsNullOrWhiteSpace($bgWorkers)) { $bgWorkers = "true" }
$envPairs += "BACKGROUND_WORKERS_ENABLED=$bgWorkers"
Write-Host "Background workers: BACKGROUND_WORKERS_ENABLED=$bgWorkers"

$dataStore = (Get-DotOrEnv "DATA_STORE").Trim().ToLower()
if ([string]::IsNullOrWhiteSpace($dataStore)) { $dataStore = "vultr_sqlite" }
$envPairs += "DATA_STORE=$dataStore"
$sqliteUrl = Get-DotOrEnv "SQLITE_API_URL"
if (-not [string]::IsNullOrWhiteSpace($sqliteUrl)) { $envPairs += "SQLITE_API_URL=$sqliteUrl" }
$sqliteSecret = Get-DotOrEnv "SQLITE_API_SECRET"
if (-not [string]::IsNullOrWhiteSpace($sqliteSecret)) { $envPairs += "SQLITE_API_SECRET=$sqliteSecret" }
$reqLog = Get-DotOrEnv "REQUEST_LOG_ENABLED"
if (-not [string]::IsNullOrWhiteSpace($reqLog)) { $envPairs += "REQUEST_LOG_ENABLED=$reqLog" }
Write-Host "Data store: DATA_STORE=$dataStore"

$s3Endpoint = Get-DotOrEnv "S3_ENDPOINT"
$s3Key = Get-DotOrEnv "S3_ACCESS_KEY_ID"
$s3Secret = Get-DotOrEnv "S3_SECRET_ACCESS_KEY"
$s3Bucket = Get-DotOrEnv "S3_BUCKET"
if ([string]::IsNullOrWhiteSpace($s3Endpoint)) { $s3Endpoint = Get-DotOrEnv "R2_ENDPOINT" }
if ([string]::IsNullOrWhiteSpace($s3Key)) { $s3Key = Get-DotOrEnv "R2_ACCESS_KEY_ID" }
if ([string]::IsNullOrWhiteSpace($s3Secret)) { $s3Secret = Get-DotOrEnv "R2_SECRET_ACCESS_KEY" }
if ([string]::IsNullOrWhiteSpace($s3Bucket)) {
  $s3Bucket = Get-DotOrEnv "R2_CACHE_BUCKET"
  if ([string]::IsNullOrWhiteSpace($s3Bucket)) { $s3Bucket = "steamgame" }
}
if ($cacheBackend -ne "gcs") {
  if (-not [string]::IsNullOrWhiteSpace($s3Endpoint)) { $envPairs += "S3_ENDPOINT=$s3Endpoint" }
  if (-not [string]::IsNullOrWhiteSpace($s3Key)) { $envPairs += "S3_ACCESS_KEY_ID=$s3Key" }
  if (-not [string]::IsNullOrWhiteSpace($s3Secret)) { $envPairs += "S3_SECRET_ACCESS_KEY=$s3Secret" }
  if (-not [string]::IsNullOrWhiteSpace($s3Bucket)) { $envPairs += "S3_BUCKET=$s3Bucket" }
  Write-Host "Object storage: S3/MinIO (CACHE_UPLOAD_BACKEND=$cacheBackend)."
} else {
  $gcsCache = Get-DotOrEnv "GCS_CACHE_BUCKET"
  if ([string]::IsNullOrWhiteSpace($gcsCache)) { $gcsCache = Get-DotOrEnv "VIDEO_GCS_BUCKET" }
  if (-not [string]::IsNullOrWhiteSpace($gcsCache)) {
    $envPairs += "GCS_CACHE_BUCKET=$gcsCache"
    Write-Host "Object storage: GCS bucket $gcsCache"
  }
}

$cdnBase = Get-DotOrEnv "PUBLIC_CACHE_CDN_BASE"
if ([string]::IsNullOrWhiteSpace($cdnBase) -and $cacheBackend -eq "gcs") {
  $gcsForCdn = Get-DotOrEnv "GCS_CACHE_BUCKET"
  if ([string]::IsNullOrWhiteSpace($gcsForCdn)) { $gcsForCdn = Get-DotOrEnv "VIDEO_GCS_BUCKET" }
  if (-not [string]::IsNullOrWhiteSpace($gcsForCdn)) {
    $cdnBase = "https://storage.googleapis.com/$gcsForCdn"
  }
}
if (-not [string]::IsNullOrWhiteSpace($cdnBase)) {
  $envPairs += "PUBLIC_CACHE_CDN_BASE=$cdnBase"
}

$redisUrl = Get-DotOrEnv "REDIS_URL"
if (-not [string]::IsNullOrWhiteSpace($redisUrl)) {
  $envPairs += "REDIS_URL=$redisUrl"
}
if (-not [string]::IsNullOrWhiteSpace($CronSecret)) {
  $envPairs += "CRON_SECRET=$CronSecret"
  Write-Host "CRON_SECRET: will be set on Cloud Run (daily-deals / weekly-heat / build-cache cron enabled)."
}

$envVarsFile = Join-Path $Tmp "cloud-run-env.yaml"
$yamlLines = New-Object System.Collections.Generic.List[string]
foreach ($pair in $envPairs) {
  $eq = $pair.IndexOf("=")
  if ($eq -lt 1) { continue }
  $k = $pair.Substring(0, $eq).Trim()
  $v = $pair.Substring($eq + 1)
  $escaped = $v -replace '\\', '\\\\' -replace '"', '\"'
  $yamlLines.Add("${k}: `"${escaped}`"")
}
[System.IO.File]::WriteAllLines($envVarsFile, $yamlLines, [System.Text.UTF8Encoding]::new($false))
Write-Host "Cloud Run env file: $envVarsFile ($($yamlLines.Count) vars)"

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
      --env-vars-file=$envVarsFile
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
    & gcloud run deploy $Service `
      --project=$ProjectId `
      --source . `
      --region=$Region `
      --allow-unauthenticated `
      --memory=$Memory `
      --cpu=$Cpu `
      --timeout=$TimeoutSec `
      --max-instances=$MaxInstances `
      --min-instances=$MinInstances `
      --env-vars-file=$envVarsFile 2>&1 | ForEach-Object { Write-Host $_ }
    $deployExit = $LASTEXITCODE
  }
}

if (-not $PreserveEnv) {
  if ($null -ne $deployExit -and $deployExit -ne 0) { exit $deployExit }
  elseif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} elseif ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if ($cacheBackend -ne "gcs" -and -not $PreserveEnv) {
  Write-Host "Removing legacy GCS env vars (CACHE_UPLOAD_BACKEND=$cacheBackend)..."
  gcloud run services update $Service `
    --project=$ProjectId `
    --region=$Region `
    --remove-env-vars=GCS_CACHE_BUCKET,VIDEO_GCS_BUCKET
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: could not remove GCS env vars (non-fatal)."
  }
}

Write-Host "Done."
$reportedUrl = gcloud run services describe $Service --project=$ProjectId --region=$Region --format="value(status.url)"
Write-Host "Use this URL for clients and docs: $ServiceUrl"
if ($reportedUrl -and ($reportedUrl.TrimEnd('/') -ne $ServiceUrl.TrimEnd('/'))) {
  Write-Host "(gcloud status.url is $reportedUrl — same Cloud Run service; prefer $ServiceUrl.)"
}
