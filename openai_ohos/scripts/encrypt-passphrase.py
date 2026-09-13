"""Run the OHPM interactive password-encryption prompt in an ephemeral PTY.

Input is JSON on stdin; output is only the encrypted security: value. No password,
terminal transcript, or private key is written to disk or forwarded to the log.
GitHub's hosted Linux runner supplies Python and POSIX PTYs.
"""
import errno
import json
import os
import pty
import re
import select
import subprocess
import sys
import time


def encrypt(payload):
    master, slave = pty.openpty()
    env = dict(os.environ)
    for key in ("OHPM_KEY_PASSPHRASE", "OHPM_PRIVATE_KEY", "OHPM_PUBLISH_ID"):
        env.pop(key, None)
    process = subprocess.Popen(payload["command"], stdin=slave, stdout=slave,
                               stderr=slave, env=env, start_new_session=True)
    os.close(slave)
    transcript = b""
    sent = False
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                transcript += chunk
                if not sent and b"password to be encrypted" in transcript.lower():
                    # OHPM's raw-data listener ignores control characters, so send
                    # the password separately from Return.
                    os.write(master, payload["password"].encode("utf-8"))
                    time.sleep(0.15)
                    os.write(master, b"\r")
                    sent = True
            if process.poll() is not None:
                # Read any final buffered ciphertext before exiting.
                continue
        if process.poll() is None:
            process.kill()
        code = process.wait(timeout=5)
        clean = re.sub(rb"\x1b\[[0-9;]*[a-zA-Z]", b"", transcript)
        match = re.search(rb"security:[A-Za-z0-9+/=:_-]+", clean)
        if code != 0 or not sent or not match:
            raise RuntimeError("OHPM password encryption did not complete")
        return match.group().decode("ascii")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)


if __name__ == "__main__":
    try:
        print(encrypt(json.load(sys.stdin)))
    except Exception:
        print("OHPM password encryption failed; terminal output suppressed.", file=sys.stderr)
        sys.exit(1)
