# Run discount tasks + build_public_cache. Countries from region-countries API (not hardcoded).
param(
  [string]$BaseUrl = "https://steam-game-api-r7vmg7elga-as.a.run.app",
  [int]$TopN = 200,
  [int]$MinGames = 120
)

$runIds = @(
  'daily_deals_top_steam',
  'daily_deals_top_itad',
  'daily_deals_top_ggdeals',
  'daily_deals_top_cheapshark',
  'daily_deals_per_platform_heat_steam',
  'daily_deals_per_platform_heat_itad',
  'daily_deals_per_platform_heat_ggdeals',
  'daily_deals_per_platform_heat_cheapshark',
  'build_public_cache'
)

$login = Invoke-RestMethod -Uri "$BaseUrl/api/admin/auth/login" -Method POST -ContentType "application/json" -Body '{"username":"admin","password":"123456"}'
if (-not ($login.ok -or $login.success)) { throw 'login failed' }
$h = @{ Authorization = "Bearer $($login.data.token)" }

# GET triggers server-side migration (strip hardcoded countries)
$list = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks" -Headers $h
$rc = Invoke-RestMethod -Uri "$BaseUrl/api/admin/region-countries" -Headers $h
$enabled = @($rc.data.items | Where-Object { $_.enabled }).Count
$total = @($rc.data.items).Count
Write-Host "region-countries: enabled=$enabled total=$total"

$results = @()
foreach ($id in $runIds) {
  Write-Host "`n>>> RUN $id (async)"
  try {
    $r = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks/$([uri]::EscapeDataString($id))/run" -Method POST -Headers $h -ContentType "application/json" -Body '{}' -TimeoutSec 120
    $task = $r.data.task
    $results += [PSCustomObject]@{ id = $id; async = $r.data.async; summary = $task.lastRunSummary }
    Write-Host $task.lastRunSummary
  } catch {
    $results += [PSCustomObject]@{ id = $id; async = $false; summary = $_.Exception.Message }
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}
$results | Format-Table -Wrap
Write-Host "Wait 5-30 min then refresh Scheduled Tasks page for lastRunOk/summary (国家数= in summary)."
