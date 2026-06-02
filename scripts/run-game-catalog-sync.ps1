# Sync Steam app list + details via Admin API (after Cloud Run deploy).
param(
  [string]$BaseUrl = "https://steam-game-api-803425642695.asia-southeast1.run.app",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$AppListMaxResults = 5000,
  [int]$DetailBatchSize = 200,
  [int]$MaxDetailRounds = 50,
  [int]$DetailDelayMs = 80,
  [int]$AppListStartCursor = 0,
  [switch]$SkipAppList,
  [switch]$DetailsOnly
)

$ErrorActionPreference = "Stop"

function Admin-Login {
  $login = Invoke-RestMethod -Uri "$BaseUrl/api/admin/auth/login" -Method POST -ContentType "application/json" `
    -Body (@{ username = $Username; password = $Password } | ConvertTo-Json) -TimeoutSec 60
  if (-not $login.data.token) { throw "Admin login failed" }
  return @{ Authorization = "Bearer $($login.data.token)" }
}

function Invoke-AdminPost {
  param([string]$Uri, [hashtable]$Headers, [string]$Body, [int]$TimeoutSec = 3600)
  $maxTry = 4
  for ($t = 1; $t -le $maxTry; $t++) {
    try {
      return Invoke-RestMethod -Uri $Uri -Method POST -Headers $Headers -ContentType "application/json" -Body $Body -TimeoutSec $TimeoutSec
    } catch {
      if ($t -eq $maxTry) { throw }
      Write-Host "  retry $t/$maxTry after: $($_.Exception.Message)"
      Start-Sleep -Seconds ([Math]::Min(30, 5 * $t))
    }
  }
}

$headers = Admin-Login
Write-Host "Logged in to $BaseUrl"

# 1) App list (paginate while hasMore)
if (-not $DetailsOnly) {
$cursor = $AppListStartCursor
$totalInserted = 0
$totalUpdated = 0
$page = 0
do {
  $page++
  $body = @{ chunkSize = 400; maxResults = $AppListMaxResults; lastAppId = $cursor } | ConvertTo-Json
  $out = Invoke-AdminPost -Uri "$BaseUrl/api/admin/games/sync-app-list" -Headers $headers -Body $body -TimeoutSec 900
  $d = $out.data
  $totalInserted += [int]$d.inserted
  $totalUpdated += [int]$d.updated
  $cursor = if ($null -ne $d.nextLastAppId) { [int]$d.nextLastAppId } else { 0 }
  $hasMore = [bool]$d.hasMore
  Write-Host "[app-list] page=$page inserted=$($d.inserted) updated=$($d.updated) unique=$($d.uniqueCount) hasMore=$hasMore cursor=$cursor"
} while ($hasMore -and $page -lt 20)

Write-Host "App list done: inserted=$totalInserted updated=$totalUpdated"
}

if ($SkipAppList -and -not $DetailsOnly) {
  Write-Host "SkipAppList: starting details only"
}

# 2) Detail batch (unsynced cursor)
$cursorAppid = ""
$round = 0
$syncedTotal = 0
$failedTotal = 0
while ($round -lt $MaxDetailRounds) {
  $round++
  $body = @{
    batchSize = $DetailBatchSize
    delayMs = $DetailDelayMs
    concurrency = 4
    cursorAppid = $cursorAppid
  } | ConvertTo-Json
  $out = Invoke-AdminPost -Uri "$BaseUrl/api/admin/games/sync-details" -Headers $headers -Body $body -TimeoutSec 3600
  $d = $out.data
  $synced = @($d.rows | Where-Object { $_.status -eq 'synced' }).Count
  $failed = @($d.rows | Where-Object { $_.status -eq 'failed' }).Count
  $skipped = @($d.rows | Where-Object { $_.status -eq 'skipped' }).Count
  $syncedTotal += $synced
  $failedTotal += $failed
  $next = if ($d.nextCursorAppid) { [string]$d.nextCursorAppid } else { "" }
  $hasMore = $true
  if ($null -ne $d.hasMore) { $hasMore = [bool]$d.hasMore }
  elseif ($null -ne $d.reachedEnd) { $hasMore = -not [bool]$d.reachedEnd }
  Write-Host "[details] round=$round synced=$synced failed=$failed skipped=$skipped next=$next hasMore=$hasMore"
  if (-not $hasMore -or [string]::IsNullOrWhiteSpace($next)) { break }
  $cursorAppid = $next
}

Write-Host "Details done: synced=$syncedTotal failed=$failedTotal rounds=$round"

# 3) SQLite game count
$sec = "steamgame-data-api-secret-change-me"
$sqlBody = '{"sql":"SELECT COUNT(*) AS n FROM game_catalog","params":[],"mode":"get"}'
$row = Invoke-RestMethod -Uri "http://139.180.199.42:8090/v1/sql" -Method POST `
  -Headers @{ "Content-Type" = "application/json"; "X-Data-Api-Secret" = $sec } -Body $sqlBody
Write-Host "SQLite game_catalog count: $($row.row.n)"
