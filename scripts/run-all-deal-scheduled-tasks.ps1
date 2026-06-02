# Run all discount scheduled tasks via Admin API and print summaries.
param(
  [string]$BaseUrl = "https://steam-game-api-r7vmg7elga-as.a.run.app",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$TopN = 20,
  [int]$MinGames = 20,
  [switch]$SkipPatchPayload
)

$ErrorActionPreference = "Stop"
$dealKeys = @(
  'daily_deals_top_steam',
  'daily_deals_top_itad',
  'daily_deals_top_ggdeals',
  'daily_deals_top_cheapshark',
  'daily_deals_per_platform_heat',
  'daily_deals_per_platform_heat_steam',
  'daily_deals_per_platform_heat_itad',
  'daily_deals_per_platform_heat_ggdeals',
  'daily_deals_per_platform_heat_cheapshark'
)

$login = Invoke-RestMethod -Uri "$BaseUrl/api/admin/auth/login" -Method POST -ContentType "application/json" -Body (@{ username = $Username; password = $Password } | ConvertTo-Json)
if (-not ($login.ok -or $login.success)) { throw "login failed: $($login | ConvertTo-Json -Compress)" }
$token = $login.data.token
$headers = @{ Authorization = "Bearer $token" }

$list = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks" -Headers $headers
$tasks = @($list.data.tasks)
Write-Host "discountOffersPersistence: $($list.data.discountOffersPersistence)"

if (-not $SkipPatchPayload) {
  foreach ($t in $tasks) {
    if ($dealKeys -notcontains $t.taskKey) { continue }
    $payload = @{}
    if ($t.payload) {
      $t.payload.PSObject.Properties | ForEach-Object { $payload[$_.Name] = $_.Value }
    }
    if ($t.taskKey -like 'daily_deals_top_*') {
      $payload.topN = $TopN
    } elseif ($t.taskKey -like 'daily_deals_per_platform_heat*') {
      $payload.minGames = $MinGames
    }
    $payload.forceRefresh = $true
    $payload.countryScope = 'enabled'
    if ($payload.PSObject.Properties['countries']) { $payload.Remove('countries') }
    if ($payload.PSObject.Properties['maxCountries']) { $payload.Remove('maxCountries') }
    $t | Add-Member -NotePropertyName payload -NotePropertyValue $payload -Force
  }
  $saved = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks" -Method PUT -Headers $headers -ContentType "application/json" -Body (@{ tasks = $tasks } | ConvertTo-Json -Depth 20)
  $tasks = @($saved.data.tasks)
  Write-Host "Patched deal tasks: topN=$TopN minGames=$MinGames forceRefresh=true"
}

$results = @()
$toRun = $tasks | Where-Object { $dealKeys -contains $_.taskKey }
$toRun += $tasks | Where-Object { $_.taskKey -eq 'build_public_cache' }

foreach ($t in $toRun) {
  Write-Host "`n=== RUN $($t.id) ($($t.taskKey)) ===" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks/$([uri]::EscapeDataString($t.id))/run" -Method POST -Headers $headers -TimeoutSec 7200
    $sw.Stop()
    $task = $r.data.task
    $results += [PSCustomObject]@{
      id = $task.id
      label = $task.label
      ok = $task.lastRunOk
      seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
      summary = $task.lastRunSummary
      error = $task.lastError
    }
    Write-Host "OK=$($task.lastRunOk) elapsed=$([math]::Round($sw.Elapsed.TotalSeconds,1))s"
    Write-Host $task.lastRunSummary
    if ($task.lastError) { Write-Host "ERROR: $($task.lastError)" -ForegroundColor Red }
  } catch {
    $sw.Stop()
    $msg = $_.Exception.Message
    $results += [PSCustomObject]@{ id = $t.id; label = $t.label; ok = $false; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); summary = $null; error = $msg }
    Write-Host "FAILED: $msg" -ForegroundColor Red
  }
}

Write-Host "`n=== TASK SUMMARY TABLE ===" -ForegroundColor Green
$results | Format-Table -AutoSize -Wrap

# Sample games with discount + URLs (US insight)
Write-Host "`n=== SAMPLE DISCOUNTS (US) ===" -ForegroundColor Green
$games = Invoke-RestMethod -Uri "$BaseUrl/api/admin/games?has_discount_info=true&insight_country=US&page=1&pageSize=5&sortBy=discount_desc" -Headers $headers
foreach ($g in $games.data.items) {
  Write-Host "`n--- $($g.name) (appid=$($g.appid)) discount=$($g.discountPercent)% ---"
  $detail = Invoke-RestMethod -Uri "$BaseUrl/api/admin/games/$($g.appid)?" -Headers $headers
  $us = $detail.data.game.byCountry.US
  if (-not $us) { $us = $detail.data.game.byCountry.PSObject.Properties | Select-Object -First 1 | ForEach-Object { $_.Value } }
  foreach ($src in @('steam','isthereanydeal','ggdeals','cheapshark')) {
    $s = $us.$src
    if ($s -and ($s.finalPrice -or $s.url)) {
      Write-Host "  $src : $($s.discountPercent)% $($s.currency) $($s.finalPrice) (was $($s.originalPrice)) url=$($s.url)"
    }
  }
}

$results | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $PSScriptRoot "last-deal-task-run.json") -Encoding UTF8
Write-Host "`nWrote $(Join-Path $PSScriptRoot 'last-deal-task-run.json')"
