# 通过 Admin API 循环调用 round-robin，刷新全部国家 Top N 四平台价。
# 用法: .\scripts\run-market-bulk-refresh.ps1 [-MaxRuns 300] [-BatchSize 50] [-TopN 200]
# 续跑: 自动沿用服务端 market_sync_global_state（如当前 ZA），无需重置队列。
param(
  [string]$BaseUrl = "https://steam-game-api-803425642695.asia-southeast1.run.app",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$MaxRuns = 300,
  [int]$BatchSize = 50,
  [int]$TopN = 200,
  [int]$DelayMs = 80,
  [int]$RequestTimeoutSec = 1200,
  [int]$MaxConsecutiveErrors = 30,
  [string]$LogFile = ""
)
$ErrorActionPreference = "Continue"
if (-not $LogFile) {
  $LogFile = Join-Path $PSScriptRoot "..\logs\market-bulk-refresh-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
}
$logDir = Split-Path $LogFile -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Log([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Output $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Log "=== Market bulk refresh start ==="
Log "BaseUrl=$BaseUrl MaxRuns=$MaxRuns BatchSize=$BatchSize TopN=$TopN TimeoutSec=$RequestTimeoutSec"

$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/auth/login" `
  -ContentType "application/json" -Body (@{ username = $Username; password = $Password } | ConvertTo-Json) -TimeoutSec 60
$auth = @{ Authorization = "Bearer $($login.data.token)" }

try {
  $st = Invoke-RestMethod -Uri "$BaseUrl/api/admin/markets/sync-status" -Headers $auth -TimeoutSec 30
  $s = $st.data.state
  Log "Resume queue: country=$($s.currentCountryCode) index=$($s.currentCountryIndex) cursor=$($s.appidCursor) queueLen=$($s.countryQueue.Count)"
} catch {
  Log "WARN: could not read sync-status: $($_.Exception.Message)"
}

$bodyObj = @{
  payload = @{
    topNPerCountry = $TopN
    batchSize      = $BatchSize
    delayMs        = $DelayMs
    skipSyncedToday = $true
    forceRefresh   = $false
    includeDetail  = $false
    includeHeat    = $false
    includePrices  = $true
    concurrency    = 6
  }
}
$body = $bodyObj | ConvertTo-Json -Depth 5

$startCountry = $null
$completedCountries = @{}
$consecutiveErrors = 0

for ($run = 1; $run -le $MaxRuns; $run++) {
  try {
    Log "Run $run/$MaxRuns ..."
    $rr = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/markets/round-robin/run" `
      -Headers $auth -ContentType "application/json" -Body $body -TimeoutSec $RequestTimeoutSec

    $consecutiveErrors = 0
    $d = $rr.data
    if (-not $startCountry) { $startCountry = $d.countryCode }
    Log "  cc=$($d.countryCode) ok=$($d.success)/$($d.processed) fail=$($d.failed) skip=$($d.skipped) completed=$($d.countryCompleted) next=$($d.nextCountryCode)"
    Log "  $($d.summary)"

    if ($d.countryCompleted -and $d.countryCode) {
      $completedCountries[$d.countryCode] = $true
    }

    if ($d.processed -eq 0 -and $d.failed -gt 0) {
      Log "  WARN: zero processed with failures, waiting 60s"
      Start-Sleep 60
    }

    # 从 ZA 续跑：绕完一圈回到起点且已标记足够多的国家完成
    if ($startCountry -and $d.countryCompleted -and $d.nextCountryCode -eq $startCountry -and $completedCountries.Count -ge 35) {
      Log "Cycle back to $startCountry ($($completedCountries.Count) countries completed this session)"
      break
    }

    Start-Sleep 3
  }
  catch {
    $consecutiveErrors++
    Log "  ERROR run $run ($consecutiveErrors consecutive): $($_.Exception.Message)"
    if ($consecutiveErrors -ge $MaxConsecutiveErrors) {
      Log "ABORT: $MaxConsecutiveErrors consecutive errors"
      break
    }
    $wait = [Math]::Min(120, 15 * $consecutiveErrors)
    Start-Sleep $wait
  }
}
try {
  $infra = Invoke-RestMethod -Uri "$BaseUrl/api/admin/settings/infrastructure" -Headers $auth -TimeoutSec 60
  Log "priceSync todayAll=$($infra.data.priceSyncIndex.todayAll) dayKey=$($infra.data.priceSyncIndex.dayKey)"
}
catch {
  Log "infra check failed: $($_.Exception.Message)"
}

Log "=== Done. Log: $LogFile ==="
