# 4 worker 分片强制重拉各国 Top N 折扣价（每 worker 负责不同国家，互不抢游标）。
# 用法: .\scripts\resync-market-prices-shard.ps1 [-TopN 500] [-WorkerCount 4] [-ResetShard]
param(
  [string]$BaseUrl = "http://139.180.199.42:8080",
  [string]$Username = "admin",
  [string]$Password = "123456",
  [int]$TopN = 500,
  [int]$BatchSize = 100,
  [int]$Concurrency = 8,
  [int]$WorkerCount = 4,
  [int]$MaxRuns = 200,
  [int]$RequestTimeoutSec = 1200,
  [switch]$ResetShard,
  [switch]$SkipCleanup
)
$ErrorActionPreference = "Continue"

function New-ShardPayload {
  param([int]$WorkerId, [bool]$DoReset)
  return @{
    topNPerCountry = $TopN
    batchSize        = $BatchSize
    delayMs          = 0
    skipSyncedToday  = $false
    forceRefresh     = $true
    includeDetail    = $false
    includeHeat      = $false
    includePrices    = $true
    concurrency      = $Concurrency
    workerCount      = $WorkerCount
    workerId         = $WorkerId
    resetShard       = $DoReset
  }
}

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
$token = $login.data.token
$auth = @{ Authorization = "Bearer $token" }

if (-not $SkipCleanup) {
  Write-Host "=== Cleanup stale discounts (before today) ==="
  try {
    $cl = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/markets/stale-discounts/cleanup" `
      -Headers $auth -ContentType "application/json" `
      -Body (@{ cutoffMode = "before_today"; maxRows = 5000; maxBatches = 30 } | ConvertTo-Json) `
      -TimeoutSec 600
    $d = $cl.data
    Write-Host "Cleanup done: scanned=$($d.scanned) clearedIndex=$($d.clearedIndex) clearedObjects=$($d.clearedObjects)"
  } catch {
    Write-Host "Cleanup WARN: $($_.Exception.Message) (continuing)"
  }
}

Write-Host "=== Sharded force resync ($WorkerCount workers, TopN=$TopN) ==="

$workerDone = @{}
0..($WorkerCount - 1) | ForEach-Object { $workerDone[$_] = $false }

for ($run = 1; $run -le $MaxRuns; $run++) {
  $activeWorkers = 0..($WorkerCount - 1) | Where-Object { -not $workerDone[$_] }
  if ($activeWorkers.Count -eq 0) {
    Write-Host "All workers completed their country shards."
    break
  }

  $jobs = @()
  foreach ($wid in $activeWorkers) {
    $doReset = [bool]($ResetShard -and $run -eq 1)
    $jobs += Start-Job -ScriptBlock {
      param($Url, $Bearer, $Payload, $TimeoutSec)
      $headers = @{ Authorization = "Bearer $Bearer" }
      $body = @{ payload = $Payload }
      try {
        $r = Invoke-RestMethod -Method Post -Uri "$Url/api/admin/markets/round-robin/run-shard" `
          -Headers $headers -ContentType "application/json" `
          -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec $TimeoutSec
        return @{ ok = $true; workerId = $Payload.workerId; data = $r.data }
      } catch {
        return @{ ok = $false; workerId = $Payload.workerId; err = $_.Exception.Message }
      }
    } -ArgumentList $BaseUrl, $token, (New-ShardPayload -WorkerId $wid -DoReset $doReset), $RequestTimeoutSec
  }

  $results = $jobs | Wait-Job | Receive-Job
  $jobs | Remove-Job -Force

  foreach ($res in $results) {
    if (-not $res.ok) {
      Write-Host "Run $run W$($res.workerId) ERROR: $($res.err)"
      continue
    }
    $d = $res.data
    Write-Host "Run $run W$($d.workerId) cc=$($d.countryCode) ok=$($d.success)/$($d.processed) fail=$($d.failed) completed=$($d.countryCompleted) next=$($d.nextCountryCode)"
    if ($d.shardCountries -and $d.countryCompleted) {
      $shardLen = @($d.shardCountries).Count
      $nextIdx = [array]::IndexOf(@($d.shardCountries), $d.nextCountryCode)
      if ($null -ne $d.nextCountryCode -and $nextIdx -eq 0 -and $d.countryCode -eq $d.shardCountries[-1]) {
        $workerDone[$d.workerId] = $true
      }
    }
  }
}

Write-Host "Done."
