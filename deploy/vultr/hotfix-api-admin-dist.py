#!/usr/bin/env python3
"""Hot-patch server dist + admin dist on Vultr and restart API container."""
import os
import sys
import tarfile
import tempfile
import paramiko

host = os.environ.get("VULTR_HOST", "139.180.199.42")
user = os.environ.get("VULTR_SSH_USER", "root")
password = os.environ.get("VULTR_SSH_PASSWORD", "")
repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
server_dist = sys.argv[1] if len(sys.argv) > 1 else os.path.join(repo, "server", "dist")
admin_dist = sys.argv[2] if len(sys.argv) > 2 else os.path.join(repo, "admin", "dist")

if not password:
    print("Set VULTR_SSH_PASSWORD", file=sys.stderr)
    sys.exit(1)

for label, path in [("server dist", server_dist), ("admin dist", admin_dist)]:
    if not os.path.isdir(path):
        print(f"Missing {label}: {path}", file=sys.stderr)
        sys.exit(1)


def make_tgz(src_dir: str) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".tgz", delete=False)
    tmp.close()
    with tarfile.open(tmp.name, "w:gz") as tar:
        for root, _, files in os.walk(src_dir):
            for f in files:
                full = os.path.join(root, f)
                tar.add(full, arcname=os.path.relpath(full, src_dir))
    return tmp.name


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=password, timeout=60)


def run(cmd, timeout=300):
    print(">>>", cmd)
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="")
    if err:
        print(err, end="", file=sys.stderr)
    if code != 0:
        raise RuntimeError(f"failed ({code}): {cmd}")


sftp = c.open_sftp()
for remote_name, src in [("steam-api-dist.tgz", server_dist), ("steam-admin-dist.tgz", admin_dist)]:
    local_tgz = make_tgz(src)
    try:
        sftp.put(local_tgz, f"/tmp/{remote_name}")
    finally:
        os.unlink(local_tgz)

sftp.close()

run("rm -rf /tmp/steam-api-dist /tmp/steam-admin-dist && mkdir -p /tmp/steam-api-dist /tmp/steam-admin-dist")
run("tar -xzf /tmp/steam-api-dist.tgz -C /tmp/steam-api-dist")
run("tar -xzf /tmp/steam-admin-dist.tgz -C /tmp/steam-admin-dist")
run("docker cp /tmp/steam-api-dist/. steamgame-api:/app/dist/")
run("docker cp /tmp/steam-admin-dist/. steamgame-api:/app/admin/dist/")
run("docker restart steamgame-api")
run("sleep 5 && curl -sf http://127.0.0.1:8080/health")
run("curl -sI http://127.0.0.1:8080/admin/ | head -15")
c.close()
print("HOTFIX_OK")
