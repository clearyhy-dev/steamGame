#!/usr/bin/env python3
import os, paramiko

password = os.environ.get("VULTR_SSH_PASSWORD", "")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("139.180.199.42", username="root", password=password, timeout=60)
cmd = (
    "source /opt/steamgame-data/.env && "
    "docker compose -f /opt/steamgame-data/docker-compose.yml run --rm minio-init "
    "mc ls local/steamgame 2>&1 || "
    "docker compose -f /opt/steamgame-data/docker-compose.yml ps -a"
)
_, o, _ = c.exec_command(cmd, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
