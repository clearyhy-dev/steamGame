# 按 ITAD / GG 官方 API 强制重拉各国 Top N 价（批量模式：Steam+ITAD+GG，跳过 CheapShark）。
# 用法: .\scripts\resync-market-prices-force.ps1 [-TopN 200] [-ResetQueue] [-BatchSize 50] [-Concurrency 6]
param(
  [string]$BaseUrl = "https://steam-game-api-803425642695.asia-southeast1.run.app",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$TopN = 200,
  [int]$BatchSize = 80,
  [int]$Concurrency = 10,
  [int]$InterBatchSec = 0,
  [int]$MaxRuns = 800,
  [int]$RequestTimeoutSec = 1200,
  [switch]$ResetQueue
)
$ErrorActionPreference = "Continue"

for ($loginTry = 1; $loginTry -le 5; $loginTry++) {
  try {
    $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/auth/login" `
      -ContentType "application/json" -Body (@{ username = $Username; password = $Password } | ConvertTo-Json) -TimeoutSec 60
    break
  } catch {
    Write-Host "Login attempt $loginTry failed: $($_.Exception.Message)"
    if ($loginTry -ge 5) { throw }
    Start-Sleep -Seconds 10
  }
}
$auth = @{ Authorization = "Bearer $($login.data.token)" }

$bodyObj = @{
  payload = @{
    topNPerCountry = $TopN
    batchSize        = $BatchSize
    delayMs          = 0
    skipSyncedToday  = $false
    forceRefresh     = $true
    includeDetail    = $false
    includeHeat      = $false
    includePrices    = $true
    concurrency      = $Concurrency
  }
}
Write-Host "=== Force resync market prices (ITAD prices/v3 + GG region API) ==="
Write-Host "TopN=$TopN BatchSize=$BatchSize Concurrency=$Concurrency InterBatchSec=$InterBatchSec ResetQueue=$ResetQueue"

for ($run = 1; $run -le $MaxRuns; $run++) {
  try {
    $reqBody = $bodyObj | ConvertTo-Json -Depth 6
    if ($ResetQueue -and $run -eq 1) {
      $reqObj = $bodyObj | ConvertTo-Json -Depth 6 | ConvertFrom-Json
      $reqObj.payload | Add-Member -NotePropertyName resetQueue -NotePropertyValue $true -Force
      $reqBody = $reqObj | ConvertTo-Json -Depth 6
      Write-Host "Run 1: reset queue to first country (US)"
    }
    $rr = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/markets/round-robin/run" `
      -Headers $auth -ContentType "application/json" -Body $reqBody -TimeoutSec $RequestTimeoutSec
    $d = $rr.data
    Write-Host "Run $run cc=$($d.countryCode) ok=$($d.success)/$($d.processed) fail=$($d.failed) completed=$($d.countryCompleted) next=$($d.nextCountryCode)"
    if ($d.processed -eq 0 -and $d.failed -eq 0 -and -not $d.countryCode) { break }
    if ($d.countryCompleted -and -not $d.nextCountryCode) {
      Write-Host "All countries in queue completed."
      break
    }
    if ($InterBatchSec -gt 0) { Start-Sleep -Seconds $InterBatchSec }
  } catch {
    Write-Host "Run $run ERROR: $($_.Exception.Message)"
    if ($_.Exception.Message -match '401|Unauthorized|Bearer') {
      Write-Host "Refreshing auth token..."
      try {
        $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/auth/login" `
          -ContentType "application/json" -Body (@{ username = $Username; password = $Password } | ConvertTo-Json) -TimeoutSec 60
        $auth = @{ Authorization = "Bearer $($login.data.token)" }
      } catch {
        Write-Host "Re-login failed: $($_.Exception.Message)"
      }
    }
    $sleepSec = if ($_.Exception.Message -match '503') { 30 } else { 15 }
    Start-Sleep -Seconds $sleepSec
  }
}

Write-Host "Done."
