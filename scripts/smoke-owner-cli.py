#!/usr/bin/env python3
"""Linux CI smoke test for the real interactive owner-setup CLI.

Uses a pseudo-terminal so raw-mode hidden password input is exercised, not
just the password validation function. Only synthetic credentials are used.
"""
import os
import pty
import select
import subprocess
import tempfile
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="notetaking-owner-smoke-") as temporary:
    master, slave = pty.openpty()
    env = dict(os.environ, DATABASE_PATH=str(Path(temporary) / "owner.sqlite"))
    process = subprocess.Popen(
        ["npm", "run", "owner:create"],
        cwd=root,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
    )
    os.close(slave)
    transcript = ""
    cursor = 0

    def expect(marker: str) -> None:
        global transcript, cursor
        deadline = time.monotonic() + 25
        while marker not in transcript[cursor:]:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                raise AssertionError(f"Timed out waiting for {marker!r}. Recent output: {transcript[-1000:]!r}")
            if not select.select([master], [], [], remaining)[0]:
                continue
            try:
                chunk = os.read(master, 4096)
            except OSError as error:
                process.kill()
                raise AssertionError(f"Owner setup exited unexpectedly while waiting for {marker!r}") from error
            if not chunk:
                raise AssertionError(f"Owner setup closed early while waiting for {marker!r}")
            transcript += chunk.decode("utf-8", errors="replace")
        cursor = transcript.index(marker, cursor) + len(marker)

    try:
        expect("New owner password")
        os.write(master, b"short\r")
        expect("Password is too short")
        expect("New owner password")
        os.write(master, b"synthetic-long-password-123\r")
        expect("Confirm owner password")
        os.write(master, b"wrong-confirmation-123\r")
        expect("Passwords did not match")
        expect("New owner password")
        os.write(master, b"synthetic-long-password-123\r")
        expect("Confirm owner password")
        os.write(master, b"synthetic-long-password-123\r")
        expect("Owner account created successfully")
        assert process.wait(timeout=15) == 0, "Owner setup returned a nonzero exit code"
        assert Path(env["DATABASE_PATH"]).exists(), "Owner database was not created"
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        os.close(master)

print("Interactive owner setup smoke test passed (short password, mismatch, success).")
