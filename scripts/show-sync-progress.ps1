# Quick progress: Get-Content logs\detail-deals-*.log -Tail 5
param([string]$SqliteUrl = "http://139.180.199.42:8090", [string]$SqliteSecret = "steamgame-data-api-secret-change-me")
$log = Get-ChildItem (Join-Path $PSScriptRoot "..\logs\detail-deals-*.log") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($log) {
  Write-Host "=== Log tail: $($log.Name) ===" -ForegroundColor Cyan
  Get-Content $log.FullName -Tail 6
}
$sql = '{"sql":"SELECT COUNT(*) AS total, SUM(CASE WHEN detail_synced=1 OR last_detail_sync_at_ms>0 THEN 1 ELSE 0 END) AS with_detail, SUM(CASE WHEN json_extract(data_json, ''$.detailUnavailable'')=1 THEN 1 ELSE 0 END) AS unavailable FROM game_catalog","params":[],"mode":"get"}'
$r = Invoke-RestMethod -Uri "$SqliteUrl/v1/sql" -Method POST -Headers @{ "Content-Type"="application/json"; "X-Data-Api-Secret"=$SqliteSecret } -Body $sql
Write-Host "`n=== SQLite ===" -ForegroundColor Cyan
Write-Host "total=$($r.row.total) with_detail=$($r.row.with_detail) unavailable=$($r.row.unavailable)"
