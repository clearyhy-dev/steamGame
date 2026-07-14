# Deploy steamgame-auth to Cloud Run (Steam login + token introspect only)
param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = "asia-southeast1",
  [string]$ServiceName = "steamgame-auth",
  [string]$ImageTag = "latest"
)
$ErrorActionPreference = "Stop"
if (-not $ProjectId) { throw "Set GCP_PROJECT_ID or pass -ProjectId" }

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path $repoRoot)) { $repoRoot = "d:\googleplay\steamgame\steamGame" }

Write-Host "Building auth-service image..."
Push-Location $repoRoot
gcloud builds submit --tag "${Region}-docker.pkg.dev/${ProjectId}/cloud-run-source-deploy/${ServiceName}:${ImageTag}" -f auth-service/Dockerfile .
Pop-Location

Write-Host "Deploying $ServiceName to Cloud Run..."
gcloud run deploy $ServiceName `
  --image "${Region}-docker.pkg.dev/${ProjectId}/cloud-run-source-deploy/${ServiceName}:${ImageTag}" `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --min-instances 0 `
  --max-instances 3 `
  --memory 256Mi `
  --cpu 1

Write-Host "Done. Set STEAM_REALM and STEAM_RETURN_URL to the service URL."
