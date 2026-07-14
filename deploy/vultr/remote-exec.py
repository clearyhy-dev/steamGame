#!/usr/bin/env python3
"""Run commands on Vultr via SSH. Usage: VULTR_SSH_PASSWORD=... py remote-exec.py 'cmd1' 'cmd2'"""
import os
import sys
import paramiko

host = os.environ.get("VULTR_HOST", "139.180.199.42")
user = os.environ.get("VULTR_SSH_USER", "root")
password = os.environ.get("VULTR_SSH_PASSWORD", "")
if not password:
    print("Set VULTR_SSH_PASSWORD", file=sys.stderr)
    sys.exit(1)

cmds = sys.argv[1:] or ["free -h", "df -h /", "docker ps --format '{{.Names}} {{.Status}}'"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=password, timeout=60)
for cmd in cmds:
    print("===", cmd, "===")
    _, stdout, stderr = c.exec_command(cmd, timeout=600)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
    if err:
        sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
    if not out and not err:
        print("(no output)")
c.close()
