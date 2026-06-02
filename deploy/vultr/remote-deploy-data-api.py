#!/usr/bin/env python3
"""Upload data-api + docker-compose and rebuild data-api on Vultr."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Install paramiko: pip install paramiko", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parents[2]
VULTR_DIR = REPO_ROOT / "deploy" / "vultr"
DATA_API_DIR = VULTR_DIR / "data-api"
REMOTE_DATA = "/opt/steamgame-data"
REMOTE_API = f"{REMOTE_DATA}/data-api"
DATA_API_SECRET = os.environ.get("DATA_API_SECRET", "steamgame-data-api-secret-change-me").strip()


def upload_dir(sftp: paramiko.SFTPClient, local: Path, remote: str) -> None:
    try:
        sftp.mkdir(remote)
    except OSError:
        pass
    for item in local.iterdir():
        if item.name in (".git", "node_modules", "dist"):
            continue
        rpath = f"{remote}/{item.name}"
        if item.is_dir():
            upload_dir(sftp, item, rpath)
        else:
            data = item.read_bytes()
            if item.suffix in (".sh", ".sql", ".ts", ".json", ".yml", ".yaml") or item.name == "Dockerfile":
                data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            print(f"  upload {item.relative_to(REPO_ROOT)} -> {rpath}")
            with sftp.file(rpath, "wb") as rf:
                rf.write(data)


def safe_print(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
    if not text.endswith("\n"):
        sys.stdout.buffer.write(b"\n")


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 900) -> tuple[int, str]:
    print(f"\n$ {cmd}")
    _, stdout, _ = client.exec_command(cmd, get_pty=True, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    safe_print(out)
    return code, out


def main() -> int:
    host = os.environ.get("VULTR_HOST", "139.180.199.42").strip()
    user = os.environ.get("VULTR_SSH_USER", "root").strip()
    password = os.environ.get("VULTR_SSH_PASSWORD", "").strip()
    if not password:
        print("Set VULTR_SSH_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {user}@{host}...")
    client.connect(host, username=user, password=password, timeout=60)

    sftp = client.open_sftp()
    try:
        compose_local = VULTR_DIR / "docker-compose.yml"
        compose_remote = f"{REMOTE_DATA}/docker-compose.yml"
        data = compose_local.read_bytes().replace(b"\r\n", b"\n")
        print(f"Upload docker-compose.yml -> {compose_remote}")
        with sftp.file(compose_remote, "wb") as rf:
            rf.write(data)

        print(f"Upload data-api/ -> {REMOTE_API}/")
        upload_dir(sftp, DATA_API_DIR, REMOTE_API)
    finally:
        sftp.close()

    secret_cmd = (
        f"grep -q '^DATA_API_SECRET=' {REMOTE_DATA}/.env 2>/dev/null || "
        f"echo 'DATA_API_SECRET={DATA_API_SECRET}' >> {REMOTE_DATA}/.env"
    )
    run(client, secret_cmd, timeout=30)
    run(client, "ufw allow 8090/tcp || true", timeout=30)
    code, _ = run(
        client,
        f"cd {REMOTE_DATA} && docker compose --env-file .env up -d --build data-api 2>&1",
        timeout=900,
    )
    if code != 0:
        client.close()
        return code

    run(client, f"curl -s http://127.0.0.1:8090/health || docker compose -f {REMOTE_DATA}/docker-compose.yml logs --tail 40 data-api", timeout=60)
    run(client, f"docker compose -f {REMOTE_DATA}/docker-compose.yml ps", timeout=30)
    client.close()
    print("data-api deploy done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
