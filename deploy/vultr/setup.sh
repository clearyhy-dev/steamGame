#!/usr/bin/env bash
set -euo pipefail

# 在 Vultr Ubuntu 22.04 上安装 Docker + Redis + MinIO + SQLite 目录
# 用法：bash setup.sh

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg sqlite3 ufw

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

mkdir -p /opt/steamgame-data/sqlite
chmod 700 /opt/steamgame-data/sqlite
touch /opt/steamgame-data/sqlite/steam.db
chmod 600 /opt/steamgame-data/sqlite/steam.db

ENV_FILE=/opt/steamgame-data/.env
if [[ ! -f "$ENV_FILE" ]]; then
  REDIS_PASSWORD=$(openssl rand -hex 16)
  MINIO_USER=steamminio
  MINIO_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  cat > "$ENV_FILE" <<EOF
REDIS_PASSWORD=${REDIS_PASSWORD}
MINIO_ROOT_USER=${MINIO_USER}
MINIO_ROOT_PASSWORD=${MINIO_PASS}
EOF
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE (save these credentials for Cloud Run .env)"
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -f "$SCRIPT_DIR/docker-compose.yml" /opt/steamgame-data/docker-compose.yml
cd /opt/steamgame-data
docker compose --env-file .env up -d

# 防火墙：SSH + MinIO API + Redis（Cloud Run 无固定出口 IP，生产建议 VPN/隧道）
ufw allow 22/tcp || true
ufw allow 9000/tcp || true
ufw allow 6379/tcp || true
ufw allow 8090/tcp || true
ufw --force enable || true

echo ""
echo "=== Vultr data stack ready ==="
echo "MinIO API:      http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):9000"
echo "MinIO bucket:   steamgame"
echo "Redis:          :6379 (password in $ENV_FILE)"
echo "SQLite path:    /opt/steamgame-data/sqlite/steam.db"
echo ""
echo "Cloud Run env (example):"
echo "  CACHE_UPLOAD_BACKEND=s3"
echo "  S3_ENDPOINT=http://YOUR_VULTR_IP:9000"
echo "  S3_ACCESS_KEY_ID=$MINIO_ROOT_USER"
echo "  S3_SECRET_ACCESS_KEY=(see $ENV_FILE)"
echo "  S3_BUCKET=steamgame"
echo "  PUBLIC_CACHE_CDN_BASE=http://YOUR_VULTR_IP:9000/steamgame"
echo "  REDIS_URL=redis://:$(grep REDIS_PASSWORD $ENV_FILE | cut -d= -f2)@YOUR_VULTR_IP:6379"
echo "  DISCOUNT_OFFERS_PERSISTENCE=object_storage"
