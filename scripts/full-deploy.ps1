param(
  [string]$ProjectId = "steamdeal",
  [string]$Region = "asia-southeast1",
  [string]$Service = "steam-game-api",
  [string]$ServiceUrl = "https://steam-game-api-r7vmg7elga-as.a.run.app",
  [string]$JwtSecret = "",
  [string]$SteamApiKey = "",
  [string]$FirebaseProjectId = "steamdeal",
  [string]$AdminUsername = "admin",
  [string]$AdminPassword = ""
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "deploy-cloud-run.ps1"

powershell -ExecutionPolicy Bypass -File $scriptPath `
  -ProjectId $ProjectId `
  -Region $Region `
  -Service $Service `
  -ServiceUrl $ServiceUrl `
  -JwtSecret $JwtSecret `
  -SteamApiKey $SteamApiKey `
  -FirebaseProjectId $FirebaseProjectId `
  -AdminUsername $AdminUsername `
  -AdminPassword $AdminPassword `
  -CostOptimized

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
