# Full detail sync (skip unavailable) then today's discount tasks.
# Run: .\scripts\run-full-detail-then-deals.ps1
param(
  [string]$BaseUrl = "https://steam-game-api-803425642695.asia-southeast1.run.app",
  [string]$SqliteUrl = "http://139.180.199.42:8090",
  [string]$SqliteSecret = "steamgame-data-api-secret-change-me",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$DetailBatchSize = 200,
  [int]$DetailDelayMs = 80,
  [int]$DetailConcurrency = 4,
  [int]$MaxDetailRounds = 5000,
  [int]$StatsEveryRounds = 10,
  [switch]$SkipDeals
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $PSScriptRoot "..\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("detail-deals-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

function Log([string]$msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Admin-Login {
  $login = Invoke-RestMethod -Uri "$BaseUrl/api/admin/auth/login" -Method POST -ContentType "application/json" `
    -Body (@{ username = $Username; password = $Password } | ConvertTo-Json) -TimeoutSec 120
  if (-not $login.data.token) { throw "Admin login failed" }
  return @{ Authorization = "Bearer $($login.data.token)" }
}

function Invoke-AdminPost {
  param([string]$Uri, [hashtable]$Headers, [string]$Body, [int]$TimeoutSec = 3600)
  $maxTry = 5
  for ($t = 1; $t -le $maxTry; $t++) {
    try {
      return Invoke-RestMethod -Uri $Uri -Method POST -Headers $Headers -ContentType "application/json" -Body $Body -TimeoutSec $TimeoutSec
    } catch {
      if ($t -eq $maxTry) { throw }
      Log "  HTTP retry $t/$maxTry : $($_.Exception.Message)"
      Start-Sleep -Seconds ([Math]::Min(60, 10 * $t))
    }
  }
}

function Get-CatalogStats {
  $sql = @'
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN detail_synced=1 OR last_detail_sync_at_ms>0 THEN 1 ELSE 0 END) AS with_detail,
  SUM(CASE WHEN json_extract(data_json,'$.detailUnavailable')=1 THEN 1 ELSE 0 END) AS unavailable
FROM game_catalog
'@
  $body = @{ sql = $sql; params = @(); mode = "get" } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri "$SqliteUrl/v1/sql" -Method POST `
    -Headers @{ "Content-Type" = "application/json"; "X-Data-Api-Secret" = $SqliteSecret } -Body $body -TimeoutSec 60
  return $r.row
}

$headers = Admin-Login
Log "=== Start full detail sync -> deals | log=$logFile ==="
Log "API=$BaseUrl batch=$DetailBatchSize maxRounds=$MaxDetailRounds"

$stats = Get-CatalogStats
Log "SQLite before: total=$($stats.total) with_detail=$($stats.with_detail) unavailable=$($stats.unavailable)"

$cursorAppid = ""
$round = 0
$syncedTotal = 0
$failedTotal = 0
$skippedTotal = 0

while ($round -lt $MaxDetailRounds) {
  $round++
  $body = @{
    batchSize     = $DetailBatchSize
    delayMs       = $DetailDelayMs
    concurrency   = $DetailConcurrency
    cursorAppid   = $cursorAppid
    force         = $false
  } | ConvertTo-Json -Compress

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $out = Invoke-AdminPost -Uri "$BaseUrl/api/admin/games/sync-details" -Headers $headers -Body $body -TimeoutSec 3600
  } catch {
    Log "ROUND $round FAILED (will retry same cursor): $($_.Exception.Message)"
    Start-Sleep -Seconds 30
    $round--
    continue
  }
  $sw.Stop()

  $d = $out.data
  $synced = @($d.rows | Where-Object { $_.status -eq "synced" }).Count
  $failed = @($d.rows | Where-Object { $_.status -eq "failed" }).Count
  $skipped = @($d.rows | Where-Object { $_.status -eq "skipped" }).Count
  $syncedTotal += $synced
  $failedTotal += $failed
  $skippedTotal += $skipped

  $next = if ($d.nextCursorAppid) { [string]$d.nextCursorAppid } else { "" }
  $hasMore = $true
  if ($null -ne $d.hasMore) { $hasMore = [bool]$d.hasMore }
  elseif ($null -ne $d.reachedEnd) { $hasMore = -not [bool]$d.reachedEnd }

  Log ("ROUND {0} +{1}s synced={2} failed={3} skipped={4} next={5} hasMore={6} | cum synced={7} failed={8}" -f `
    $round, [int]$sw.Elapsed.TotalSeconds, $synced, $failed, $skipped, $next, $hasMore, $syncedTotal, $failedTotal)

  if ($round % $StatsEveryRounds -eq 0) {
    $s = Get-CatalogStats
    Log "  progress: with_detail=$($s.with_detail)/$($s.total) unavailable=$($s.unavailable)"
  }

  if (-not $hasMore -or [string]::IsNullOrWhiteSpace($next)) {
    Log "Detail sync finished (reachedEnd)."
    break
  }
  $cursorAppid = $next
}

$stats = Get-CatalogStats
Log "SQLite after details: total=$($stats.total) with_detail=$($stats.with_detail) unavailable=$($stats.unavailable)"
Log "Details summary: rounds=$round synced=$syncedTotal failed=$failedTotal skipped=$skippedTotal"

if ($SkipDeals) {
  Log "SkipDeals set — done."
  exit 0
}

Log "=== Starting today's discount sync tasks (async on server) ==="
$dealIds = @(
  "daily_deals_top_steam",
  "daily_deals_top_itad",
  "daily_deals_top_ggdeals",
  "daily_deals_top_cheapshark"
)

foreach ($id in $dealIds) {
  try {
    $r = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks/$([uri]::EscapeDataString($id))/run" `
      -Method POST -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 180
    $sum = $r.data.task.lastRunSummary
    Log "DEAL TASK $id started async=$($r.data.async) summary=$sum"
  } catch {
    Log "DEAL TASK $id ERROR: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 5
}

Log "=== Done. Monitor: admin Scheduled Tasks + logs $logFile ==="
