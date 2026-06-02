#!/usr/bin/env python3
"""Upload deploy/vultr assets and run setup.sh on the Vultr host.

Usage (do not commit passwords):
  set VULTR_HOST=139.180.199.42
  set VULTR_SSH_USER=root
  set VULTR_SSH_PASSWORD=your_password
  python deploy/vultr/remote-install.py
"""
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
REMOTE_DIR = "/root/steamgame-vultr-setup"


def main() -> int:
    host = os.environ.get("VULTR_HOST", "").strip()
    user = os.environ.get("VULTR_SSH_USER", "root").strip()
    password = os.environ.get("VULTR_SSH_PASSWORD", "").strip()
    if not host or not password:
        print("Set VULTR_HOST and VULTR_SSH_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {user}@{host}...")
    client.connect(host, username=user, password=password, timeout=60)

    sftp = client.open_sftp()
    try:
        try:
            sftp.mkdir(REMOTE_DIR)
        except OSError:
            pass
        for name in ("docker-compose.yml", "setup.sh"):
            local = VULTR_DIR / name
            remote = f"{REMOTE_DIR}/{name}"
            print(f"Upload {name} -> {remote}")
            data = local.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            with sftp.file(remote, "wb") as rf:
                rf.write(data)
        sftp.chmod(f"{REMOTE_DIR}/setup.sh", 0o755)
    finally:
        sftp.close()

    cmd = f"cd {REMOTE_DIR} && bash -x setup.sh 2>&1"
    print("Running setup.sh (may take several minutes)...")
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=900)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()

    def safe_print(text: str) -> None:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.buffer.write(text.encode(enc, errors="replace"))
        sys.stdout.buffer.write(b"\n")

    safe_print(out)
    if err.strip():
        safe_print(err)
    if code != 0:
        print(f"setup.sh failed with exit {code}", file=sys.stderr)
        client.close()
        return code

    print("\n--- /opt/steamgame-data/.env (save for Cloud Run; do not commit) ---")
    _, stdout2, _ = client.exec_command("cat /opt/steamgame-data/.env", timeout=30)
    print(stdout2.read().decode("utf-8", errors="replace"))
    client.close()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
