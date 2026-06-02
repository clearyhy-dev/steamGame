#!/usr/bin/env python3
import os, sys
import paramiko

host = os.environ.get("VULTR_HOST", "139.180.199.42")
user = os.environ.get("VULTR_SSH_USER", "root")
password = os.environ.get("VULTR_SSH_PASSWORD", "")
if not password:
    print("Set VULTR_SSH_PASSWORD", file=sys.stderr)
    sys.exit(1)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=password, timeout=60)
cmds = [
    "docker compose -f /opt/steamgame-data/docker-compose.yml ps 2>&1",
    "cat /opt/steamgame-data/.env 2>&1",
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/minio/health/live 2>&1 || echo fail",
]
for cmd in cmds:
    print("===", cmd, "===")
    _, stdout, _ = c.exec_command(cmd, timeout=60)
    text = stdout.read().decode("utf-8", errors="replace")
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
    if not text.endswith("\n"):
        sys.stdout.buffer.write(b"\n")
c.close()
