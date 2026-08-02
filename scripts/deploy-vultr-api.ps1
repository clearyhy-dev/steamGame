# 将 API + Admin 部署到 Vultr（数据层 Redis/MinIO/SQLite 已在本机 Docker）
# 用法（仓库根目录）:
#   .\scripts\deploy-vultr-api.ps1
#   .\scripts\deploy-vultr-api.ps1 -Host 139.180.199.42 -Password 'your-root-password'
param(
  [string]$VultrHost = "139.180.199.42",
  [string]$User = "root",
  [string]$Password = "",
  [string]$RemoteDir = "/opt/steamgame-api",
  [int]$ApiPort = 8080
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($Password)) {
  $Password = $env:VULTR_SSH_PASSWORD
}
if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "请设置 -Password 或环境变量 VULTR_SSH_PASSWORD"
}

Write-Host "=== 1/4 本地构建 admin + server ===" -ForegroundColor Cyan
Push-Location (Join-Path $RepoRoot "admin")
if (-not (Test-Path "node_modules")) { npm ci }
npm run build
Pop-Location

Push-Location (Join-Path $RepoRoot "server")
if (-not (Test-Path "node_modules")) { npm ci }
npm run build
Pop-Location

Write-Host "准备生产 node_modules（独立目录，不改动本地 dev 依赖）..."
$ProdMods = Join-Path $env:TEMP "steamgame-api-prod-mods"
if (Test-Path $ProdMods) { Remove-Item $ProdMods -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ProdMods | Out-Null
Copy-Item (Join-Path $RepoRoot "server\package.json") $ProdMods
Copy-Item (Join-Path $RepoRoot "server\package-lock.json") $ProdMods
Push-Location $ProdMods
npm ci --omit=dev
Pop-Location

Write-Host "=== 2/4 打包上传 ===" -ForegroundColor Cyan
$Staging = Join-Path $env:TEMP "steamgame-api-deploy"
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

Copy-Item (Join-Path $RepoRoot "server\dist") (Join-Path $Staging "dist") -Recurse
Copy-Item (Join-Path $ProdMods "node_modules") (Join-Path $Staging "node_modules") -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $Staging "admin-dist") | Out-Null
Copy-Item (Join-Path $RepoRoot "admin\dist\*") (Join-Path $Staging "admin-dist") -Recurse
Copy-Item (Join-Path $RepoRoot "deploy\vultr\api\Dockerfile") $Staging
Copy-Item (Join-Path $RepoRoot "deploy\vultr\api\docker-compose.yml") $Staging

# 从 server/.env + Vultr 数据层生成运行时 .env（Docker 内网访问 data-api/minio/redis）
# 用 Python 解析，避免部分环境下 PowerShell 读不到 .env
$dotEnvPath = Join-Path $RepoRoot "server\.env"
$envKvPath = Join-Path $env:TEMP "steamgame-api-local-env.kv"
$envDot = @{}
py -3 -c @"
import pathlib
p = pathlib.Path(r'$dotEnvPath')
out = []
count = 0
jwt = False
if p.is_file():
    for line in p.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k, v = k.strip(), v.strip()
        # escape newlines for kv file
        v = v.replace('\\', '\\\\').replace('\n', '\\n')
        out.append(k + '=' + v)
        count += 1
        if k == 'JWT_SECRET' and v:
            jwt = True
pathlib.Path(r'$envKvPath').write_text('\n'.join(out) + ('\n' if out else ''), encoding='utf-8')
print('env_keys', count, 'jwt', jwt)
"@
if (Test-Path -LiteralPath $envKvPath) {
  Get-Content -LiteralPath $envKvPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    $eq = $line.IndexOf("=")
    if ($eq -gt 0) {
      $envDot[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
    }
  }
}

function Get-Val([string]$k, [string]$fallback = "") {
  if ($envDot.ContainsKey($k) -and -not [string]::IsNullOrWhiteSpace([string]$envDot[$k])) { return [string]$envDot[$k] }
  return $fallback
}

$baseUrl = "http://${VultrHost}:${ApiPort}"
$redisPass = ""
if ($envDot['REDIS_URL'] -match 'redis://:([^@]+)@') { $redisPass = $Matches[1] }

$apiEnv = @"
PORT=$ApiPort
NODE_ENV=production
SERVE_ADMIN_STATIC=true
ADMIN_DIST_PATH=/app/admin/dist
APP_BASE_URL=$baseUrl
STEAM_REALM=$baseUrl
STEAM_RETURN_URL=$baseUrl/auth/steam/callback
DATA_STORE=vultr_sqlite
SQLITE_API_URL=http://data-api:8090
SQLITE_API_SECRET=$(Get-Val "SQLITE_API_SECRET" "steamgame-data-api-secret-change-me")
CACHE_UPLOAD_BACKEND=s3
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY_ID=$(Get-Val "S3_ACCESS_KEY_ID" "steamminio")
S3_SECRET_ACCESS_KEY=$(Get-Val "S3_SECRET_ACCESS_KEY")
S3_BUCKET=$(Get-Val "S3_BUCKET" "steamgame")
PUBLIC_CACHE_CDN_BASE=http://${VultrHost}:9000/steamgame
REDIS_URL=redis://:${redisPass}@redis:6379
DISCOUNT_OFFERS_PERSISTENCE=object_storage
DEAL_SYNC_PRICE_DAY_TZ=$(Get-Val "DEAL_SYNC_PRICE_DAY_TZ" "Asia/Shanghai")
BACKGROUND_WORKERS_ENABLED=$(Get-Val "BACKGROUND_WORKERS_ENABLED" "true")
REQUEST_LOG_ENABLED=false
JWT_SECRET=$(Get-Val "JWT_SECRET")
JWT_ISSUER=steamgame-api
JWT_EXPIRES_IN=30d
AUTH_ON_GCP=false
AUTH_SERVICE_URL=https://steam-game-api-r7vmg7elga-as.a.run.app
STEAM_API_KEY=$(Get-Val "STEAM_API_KEY")
ADMIN_USERNAME=$(Get-Val "ADMIN_USERNAME" "admin")
ADMIN_PASSWORD=$(Get-Val "ADMIN_PASSWORD" "123456")
NODE_OPTIONS=--max-old-space-size=512
STEAM_HTTP_TIMEOUT_MS=8000
STEAM_AUTO_SYNC_ENABLED=false
"@

if ([string]::IsNullOrWhiteSpace((Get-Val "JWT_SECRET"))) {
  throw "server\.env 缺少 JWT_SECRET，无法部署生产 API"
}

Set-Content -Path (Join-Path $Staging ".env") -Value $apiEnv.Trim() -Encoding UTF8 -NoNewline

$tarPath = Join-Path $env:TEMP "steamgame-api-deploy.tgz"
if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
py -3 -c @"
import tarfile, os
staging = r'$Staging'
out = r'$tarPath'
with tarfile.open(out, 'w:gz') as tar:
    for root, dirs, files in os.walk(staging):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, staging)
            tar.add(full, arcname=arc)
print('tar ok', out, os.path.getsize(out))
"@

$pyDeploy = @"
import os, sys, time
import paramiko

host = sys.argv[1]
user = sys.argv[2]
password = os.environ.get('VULTR_SSH_PASSWORD') or (sys.argv[3] if len(sys.argv) > 3 else '')
remote_dir = sys.argv[4]
tar_path = sys.argv[5]
api_port = int(sys.argv[6])
if not password:
    raise SystemExit('VULTR_SSH_PASSWORD missing')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=password, timeout=60)

def run(cmd, timeout=900):
    print('>>>', cmd)
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if out: print(out, end='')
    if err: print(err, end='', file=sys.stderr)
    if code != 0:
        raise RuntimeError(f'command failed ({code}): {cmd}')

run(f'mkdir -p {remote_dir}')
sftp = c.open_sftp()
sftp.put(tar_path, f'{remote_dir}/deploy.tgz')
sftp.close()

run(f'cd {remote_dir} && rm -rf dist admin-dist node_modules package.json Dockerfile docker-compose.yml .env')
run(f'cd {remote_dir} && tar -xzf deploy.tgz && rm deploy.tgz')
run('ufw allow %d/tcp || true' % api_port)
run(f'cd {remote_dir} && docker compose build --no-cache')
run(f'cd {remote_dir} && docker compose up -d')
time.sleep(5)
run(f'curl -sf http://127.0.0.1:{api_port}/health || true')
run(f'docker compose -f {remote_dir}/docker-compose.yml ps')
run(f'docker logs steamgame-api --tail 30 2>&1 || true')

c.close()
print('DEPLOY_OK')
"@

$pyFile = Join-Path $env:TEMP "deploy-vultr-api-upload.py"
Set-Content -Path $pyFile -Value $pyDeploy -Encoding UTF8

Write-Host "=== 3/4 upload + docker build on server ===" -ForegroundColor Cyan
$env:VULTR_SSH_PASSWORD = $Password
# Pass password via env so PowerShell does not mangle special chars like { }
py -3 $pyFile $VultrHost $User "__via_env__" $RemoteDir $tarPath $ApiPort
if ($LASTEXITCODE -ne 0) {
  throw "upload/build failed (exit=$LASTEXITCODE)"
}

Write-Host ""
Write-Host "=== 4/4 deploy done ===" -ForegroundColor Green
Write-Host "Admin:  http://${VultrHost}:${ApiPort}/"
Write-Host "API:    http://${VultrHost}:${ApiPort}/health"
Write-Host "Login:  admin / (see server/.env ADMIN_PASSWORD)"
