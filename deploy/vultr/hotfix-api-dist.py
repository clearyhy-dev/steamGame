#!/usr/bin/env python3
"""Hot-patch server dist on Vultr and restart API container."""
import os, sys, tarfile, io, tempfile
import paramiko

host = os.environ.get("VULTR_HOST", "139.180.199.42")
user = os.environ.get("VULTR_SSH_USER", "root")
password = os.environ.get("VULTR_SSH_PASSWORD", "")
dist_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "server", "dist")

if not password:
    print("Set VULTR_SSH_PASSWORD", file=sys.stderr)
    sys.exit(1)

tmp = tempfile.NamedTemporaryFile(suffix=".tgz", delete=False)
tmp.close()
with tarfile.open(tmp.name, "w:gz") as tar:
    for root, _, files in os.walk(dist_dir):
        for f in files:
            full = os.path.join(root, f)
            tar.add(full, arcname=os.path.relpath(full, dist_dir))

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
sftp.put(tmp.name, "/tmp/steam-api-dist.tgz")
sftp.close()
os.unlink(tmp.name)

run("rm -rf /tmp/steam-api-dist && mkdir -p /tmp/steam-api-dist")
run("tar -xzf /tmp/steam-api-dist.tgz -C /tmp/steam-api-dist")
run("docker cp /tmp/steam-api-dist/. steamgame-api:/app/dist/")
run("docker restart steamgame-api")
run("sleep 4 && curl -sf http://127.0.0.1:8080/health")
run("curl -sI http://127.0.0.1:8080/admin/ | head -20")
c.close()
print("HOTFIX_OK")
