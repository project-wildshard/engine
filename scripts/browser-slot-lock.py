"""Nonblocking POSIX slot lease for hosts without BSD lockf.

The supervisor and slot shell share the lease. Browsers and timers close it.
The existing browser-lane child owns admission, timeout and tree cleanup.
"""
import fcntl
import os
import signal
import subprocess
import sys


def run(path, command):
    with open(path, 'a+') as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 75
        # A killed supervisor must not release a still-live slot shell's lock.
        # Reserve one descriptor for that shell; it closes it in both browser
        # and timer children. Mac's BSD path does not use this transport.
        shared = 8
        duplicate = lease.fileno() != shared
        if duplicate:
            os.dup2(lease.fileno(), shared)
        try:
            child = subprocess.Popen(command, close_fds=True, pass_fds=(shared,),
                env={**os.environ, 'BROWSER_SLOT_LOCK_FD': str(shared)})
        finally:
            if duplicate:
                os.close(shared)
        def forward(signum, _frame):
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass
        handlers = {kind: signal.signal(kind, forward) for kind in (signal.SIGINT, signal.SIGTERM)}
        try:
            code = child.wait()
            return code if code >= 0 else 128 - code
        finally:
            for kind, handler in handlers.items():
                signal.signal(kind, handler)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit('usage: browser-slot-lock.py LOCK COMMAND [ARG ...]')
    sys.exit(run(sys.argv[1], sys.argv[2:]))
