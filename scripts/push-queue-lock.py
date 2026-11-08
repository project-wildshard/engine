#!/usr/bin/env python3
"""Keep a queue operation's flock through its real child lifetime."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
child = None


def stop(_signum, _frame):
    if child is None:
        raise SystemExit(130)
    if child is not None:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
with path.open('a+') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    child = subprocess.Popen(sys.argv[2:], start_new_session=True, pass_fds=(lock.fileno(),))
    code = child.wait()
    raise SystemExit(code if code >= 0 else 128 - code)
