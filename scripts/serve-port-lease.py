"""Keep a preview's advisory port lock through build and listener startup.

The Bash 3 caller exchanges bounded requests over private FIFOs. Lock files
are never unlinked: replacing their inode could admit two owners at once.
"""
import errno
import fcntl
import os
from pathlib import Path
import select
import signal
import sys
import time


def terminate(_signal, _frame):
    raise SystemExit(0)


def hold(registry, channel, owner):
    signal.signal(signal.SIGTERM, terminate)
    # Advertise command readiness only after a reply writer exists. Otherwise
    # a startup client can observe reply EOF between these two opens.
    replies = os.open(channel / 'replies', os.O_RDWR | os.O_NONBLOCK)
    commands = os.open(channel / 'commands', os.O_RDWR | os.O_NONBLOCK)
    held = None
    pending = b''
    try:
        while os.getppid() == owner:
            if not select.select([commands], [], [], 0.25)[0]:
                continue
            pending += os.read(commands, 4096)
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                if line == b'close':
                    if held is not None:
                        held.close()
                        held = None
                    os.write(replies, b'ok\n')
                    return
                verb, number = line.decode().split()
                port = int(number)
                if verb != 'take' or not 1 <= port <= 65535:
                    raise ValueError('Expected take <port>')
                candidate = (registry / f'.port-{port}.lock').open('a+')
                try:
                    fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    candidate.close()
                    os.write(replies, b'busy\n')
                    continue
                # Acquire the replacement before releasing the old port.
                if held is not None:
                    held.close()
                held = candidate
                os.write(replies, b'ok\n')
    finally:
        if held is not None:
            held.close()
        os.close(commands)
        os.close(replies)
        for name in ('commands', 'replies'):
            (channel / name).unlink(missing_ok=True)
        channel.rmdir()


def request(channel, command):
    deadline = time.monotonic() + 3
    reader = os.open(channel / 'replies', os.O_RDONLY | os.O_NONBLOCK)
    try:
        while True:
            try:
                writer = os.open(channel / 'commands', os.O_WRONLY | os.O_NONBLOCK)
                break
            except OSError as error:
                if error.errno != errno.ENXIO or time.monotonic() >= deadline:
                    raise
                time.sleep(0.02)
        try:
            os.write(writer, (' '.join(command) + '\n').encode())
        finally:
            os.close(writer)
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([reader], [], [], remaining)[0]:
            raise TimeoutError('Preview port lease did not reply')
        reply = os.read(reader, 4096).decode().strip()
        if reply not in ('ok', 'busy'):
            raise RuntimeError('Invalid preview port lease reply')
        print(reply)
    finally:
        os.close(reader)


if __name__ == '__main__':
    if sys.argv[1] == 'hold':
        hold(Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]))
    elif sys.argv[1] == 'request':
        request(Path(sys.argv[2]), sys.argv[3:])
    else:
        raise ValueError('Expected hold or request')
