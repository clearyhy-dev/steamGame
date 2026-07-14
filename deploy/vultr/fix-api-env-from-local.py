#!/usr/bin/env python3
"""Merge secrets from local server/.env into Vultr /opt/steamgame-api/.env and restart."""
import os
import re
import sys
import paramiko

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOCAL_ENV = os.path.join(REPO, "server", ".env")
HOST = os.environ.get("VULTR_HOST", "139.180.199.42")
PASSWORD = os.environ.get("VULTR_SSH_PASSWORD", "")

REQUIRED = [
    "JWT_SECRET",
    "STEAM_API_KEY",
    "S3_SECRET_ACCESS_KEY",
    "SQLITE_API_SECRET",
    "ADMIN_PASSWORD",
]


def parse_env(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def main():
    if not PASSWORD:
        print("Set VULTR_SSH_PASSWORD", file=sys.stderr)
        sys.exit(1)
    local = parse_env(LOCAL_ENV)
    missing = [k for k in REQUIRED if not local.get(k)]
    if missing:
        print(f"Local server/.env missing: {missing}", file=sys.stderr)
        sys.exit(1)

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=60)
    sftp = c.open_sftp()
    with sftp.open("/opt/steamgame-api/.env", "r") as f:
        remote_text = f.read().decode("utf-8", errors="replace")
    sftp.close()

    lines = remote_text.splitlines()
    keys_seen = set()
    new_lines = []
    for line in lines:
        if "=" in line and not line.strip().startswith("#"):
            k = line.split("=", 1)[0].strip()
            keys_seen.add(k)
            if k in local and local[k]:
                new_lines.append(f"{k}={local[k]}")
                continue
        new_lines.append(line)

    for k, v in local.items():
        if k not in keys_seen and v:
            new_lines.append(f"{k}={v}")

    merged = "\n".join(new_lines).rstrip() + "\n"
    sftp = c.open_sftp()
    with sftp.open("/opt/steamgame-api/.env", "w") as f:
        f.write(merged.encode("utf-8"))
    sftp.close()

    def run(cmd: str):
        print(">>>", cmd)
        _, stdout, stderr = c.exec_command(cmd, timeout=120)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        print(out or err)
        if code != 0:
            raise RuntimeError(f"failed: {cmd}")

    run("cd /opt/steamgame-api && docker compose up -d --force-recreate")
    run("sleep 6 && curl -sf http://127.0.0.1:8080/health")
    run("docker exec steamgame-api grep -c fallbackHotAppidsFromMarket /app/dist/modules/market/market-round-robin.runner.js")
    c.close()
    print("ENV_FIX_OK")


if __name__ == "__main__":
    main()
