#!/usr/bin/env python3
"""Safe helpers for launching Lean parity_smoke (process-group kill + flock).

Python's subprocess timeout only kills the direct child. `lake exe …` spawns
`parity_smoke` as a grandchild; if we only kill `lake`, hung binaries orphan
and pile up. Always start a new session and kill the whole process group.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterator, Sequence


DEFAULT_LOCK = Path("/tmp/puzzlescript-lean-parity.lock")


def _kill_process_group(proc: subprocess.Popen[str], *, grace_s: float = 0.5) -> None:
    if proc.pid is None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + grace_s
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.05)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


def run_parity_smoke(
    cmd: Sequence[str],
    *,
    cwd: Path | str,
    timeout: float | None,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a command in its own process group; kill the group on timeout."""
    proc = subprocess.Popen(
        list(cmd),
        cwd=str(cwd),
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        _kill_process_group(proc)
        # Drain pipes after kill so we don't leave zombies holding FDs.
        try:
            stdout, stderr = proc.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            _kill_process_group(proc, grace_s=0.1)
            stdout, stderr = "", ""
        raise subprocess.TimeoutExpired(
            cmd=exc.cmd,
            timeout=exc.timeout,
            output=stdout,
            stderr=stderr,
        ) from None
    return subprocess.CompletedProcess(
        args=list(cmd),
        returncode=proc.returncode if proc.returncode is not None else -1,
        stdout=stdout or "",
        stderr=stderr or "",
    )


@contextlib.contextmanager
def parity_lock(
    lock_path: Path = DEFAULT_LOCK,
    *,
    wait: bool = False,
    stale_s: float = 6 * 3600,
) -> Iterator[None]:
    """Exclusive flock so expand/smoke/bisect do not stack concurrent runs.

    If wait=False and the lock is held, exit with a clear error (non-zero).
    Removes a stale lock file older than stale_s (crash leftover).
    """
    import fcntl

    lock_path = Path(lock_path)
    if lock_path.exists():
        try:
            age = time.time() - lock_path.stat().st_mtime
            if age > stale_s:
                lock_path.unlink(missing_ok=True)
        except OSError:
            pass

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(lock_path, "a+", encoding="utf-8")
    try:
        flags = fcntl.LOCK_EX
        if not wait:
            flags |= fcntl.LOCK_NB
        try:
            fcntl.flock(fh.fileno(), flags)
        except BlockingIOError:
            print(
                f"lean parity: another parity job holds {lock_path}. "
                "Wait for it to finish, or remove the lock if orphaned.",
                file=sys.stderr,
            )
            sys.exit(75)  # EX_TEMPFAIL
        fh.seek(0)
        fh.truncate()
        fh.write(f"pid={os.getpid()} started={time.time():.0f}\n")
        fh.flush()
        yield
    finally:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        fh.close()
