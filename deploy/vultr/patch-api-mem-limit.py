#!/usr/bin/env python3
"""Raise API container mem_limit and restart once."""
import os
import paramiko
import time

password = os.environ.get("VULTR_SSH_PASSWORD", "")
if not password:
    raise SystemExit("Set VULTR_SSH_PASSWORD")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("139.180.199.42", username="root", password=password, timeout=60)

script = r"""
set -e
cd /opt/steamgame-api
cp docker-compose.yml docker-compose.yml.bak-mem
python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
text = p.read_text()
if "mem_limit: 768m" in text:
    print("already 768m")
else:
    text = text.replace("mem_limit: 480m", "mem_limit: 768m")
    p.write_text(text)
    print("patched mem_limit -> 768m")
PY
docker compose up -d steam-api
sleep 5
curl -sf --max-time 5 http://127.0.0.1:8080/health
docker inspect steamgame-api --format 'mem={{.HostConfig.Memory}} restart={{.RestartCount}}'
"""

_, stdout, stderr = c.exec_command(script, timeout=120)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print(out or err)
c.close()
