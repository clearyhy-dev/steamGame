# Backfill Steam trailer URLs into videos table (games that already have catalog detail).
param(
  [string]$BaseUrl = "https://steam-game-api-803425642695.asia-southeast1.run.app",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$BatchSize = 80,
  [int]$MaxRounds = 500,
  [switch]$NoFetchSteam,
  [switch]$FetchAll
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $PSScriptRoot "..\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("backfill-videos-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

function Log([string]$msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

$login = Invoke-RestMethod -Uri "$BaseUrl/api/admin/auth/login" -Method POST -ContentType "application/json" `
  -Body (@{ username = $Username; password = $Password } | ConvertTo-Json) -TimeoutSec 120
$h = @{ Authorization = "Bearer $($login.data.token)" }

Log "Backfill trailer videos -> $logFile"
$cursor = "0"
$round = 0
$totalVideos = 0
$totalProcessed = 0

while ($round -lt $MaxRounds) {
  $round++
  $body = @{
    batchSize     = $BatchSize
    cursorAppid   = $cursor
    onlyWithUrls  = (-not $FetchAll)
    fetchSteam    = $FetchAll -and (-not $NoFetchSteam)
  } | ConvertTo-Json -Compress

  $out = Invoke-RestMethod -Uri "$BaseUrl/api/admin/games/backfill-trailer-videos" -Method POST `
    -Headers $h -ContentType "application/json" -Body $body -TimeoutSec 1800

  $d = $out.data
  $totalVideos += [int]$d.videosCreated
  $totalProcessed += [int]$d.processed
  $cursor = [string]$d.nextCursorAppid
  $hasMore = [bool]$d.hasMore

  Log ("round={0} processed={1} videosCreated={2} noUrls={3} next={4} hasMore={5} | cum videos={6}" -f `
    $round, $d.processed, $d.videosCreated, $d.noUrls, $cursor, $hasMore, $totalVideos)

  if (-not $hasMore) {
    Log "Backfill finished."
    break
  }
  Start-Sleep -Seconds 2
}

Log "Done rounds=$round processed=$totalProcessed videosCreated=$totalVideos"
