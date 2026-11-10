#!/usr/bin/env python3
"""Merge report-only full-test logs across worktrees/machines; never a gate input.

    python3 scripts/full-test-report.py [--log PATH ...] [--remote TAILSCALE_HOST ...]

No log is a green receipt. Missing hosts, damaged rows and incomplete leases remain
explicit. Remote reads use bounded, noninteractive SSH and the standard root only.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import subprocess

MAX_LOG_BYTES = 128 * 1024 * 1024


def read_log(path):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_LOG_BYTES:
            raise ValueError('nonregular/oversized observation source')
        chunks, size = [], 0
        while True:
            data = os.read(fd, min(1024 * 1024, MAX_LOG_BYTES + 1 - size))
            if not data:
                break
            chunks.append(data)
            size += len(data)
            if size > MAX_LOG_BYTES:
                raise ValueError('oversized observation source')
        return b''.join(chunks).decode('utf-8')
    finally:
        os.close(fd)


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def report(sources, since):
    events, unavailable, invalid, duplicates, conflicts = {}, [], [], 0, set()
    for source, contents in sources:
        if contents is None:
            unavailable.append(source)
            continue
        for number, line in enumerate(contents.splitlines(), 1):
            try:
                row = json.loads(line)
                if row['schema'] != 'full-test-day/1' or row['event'] not in ('request', 'acquire', 'release', 'not-acquired'):
                    raise ValueError('unknown schema/event')
                if not isinstance(row['machine'], str) or not isinstance(row['token'], str) or not isinstance(row['epoch'], (int, float)) or not math.isfinite(row['epoch']):
                    raise ValueError('invalid observation identity/time')
                if any(not isinstance(row.get(key), str) for key in ('kind', 'lane', 'cwd', 'worktree')):
                    raise ValueError('missing observation holder/worktree')
                if row.get('plan') is not None and not isinstance(row['plan'], str):
                    raise ValueError('invalid plan identity')
                if row['event'] == 'release' and not isinstance(row.get('exitCode'), int):
                    raise ValueError('missing command exit code')
                if row['epoch'] < since:
                    continue
                key = (row['machine'], row['token'], row['event'])
                if key in events:
                    if events[key] != row:
                        conflicts.add((row['machine'], row['token']))
                        raise ValueError('conflicting duplicate event')
                    duplicates += 1
                else:
                    events[key] = row
            except (ValueError, KeyError, TypeError) as error:
                invalid.append({'source': source, 'line': number, 'error': str(error)[:160]})
    leases = defaultdict(dict)
    for (machine, token, event), row in events.items():
        leases[(machine, token)][event] = row
    groups, incomplete = defaultdict(list), []
    completed, rejected = [], []
    for (machine, token), rows in leases.items():
        if (machine, token) in conflicts:
            incomplete.append({'machine': machine, 'token': token, 'events': sorted(rows), 'error': 'conflicting duplicate; excluded from totals'})
            continue
        if 'release' in rows and 'acquire' in rows:
            acquired, ended = rows['acquire'], rows['release']
            if any(not isinstance(ended.get(key), (int, float)) or not math.isfinite(ended[key]) or ended[key] < 0 for key in ('queueSeconds', 'heldSeconds', 'userSeconds', 'systemSeconds')):
                invalid.append({'machine': machine, 'token': token, 'error': 'invalid completed durations/CPU'})
                continue
            completed.append(ended)
            groups[(machine, acquired['kind'], acquired['lane'], acquired['worktree'], acquired.get('plan'))].append(ended)
        elif 'not-acquired' in rows:
            rejected.append(rows['not-acquired'])
        else:
            incomplete.append({'machine': machine, 'token': token, 'events': sorted(rows)})
    def summarize(values):
        waits = [row['queueSeconds'] for row in values]
        return {'leases': len(values), 'heldSeconds': sum(row['heldSeconds'] for row in values),
                'userSeconds': sum(row['userSeconds'] for row in values),
                'systemSeconds': sum(row['systemSeconds'] for row in values),
                'waitP50': percentile(waits, .5), 'waitP90': percentile(waits, .9),
                'exitCodes': dict(Counter(str(row['exitCode']) for row in values))}
    return {'schema': 'full-test-report/1', 'generatedAt': datetime.now(timezone.utc).isoformat(),
            'since': since, 'reportingMachine': socket.gethostname(), 'sources': [name for name, _ in sources],
            'machines': sorted({machine for machine, _ in leases}), 'unavailable': unavailable,
            'invalid': invalid, 'duplicateEvents': duplicates, 'notAcquired': len(rejected),
            'observationSpanSeconds': max((row['epoch'] for row in events.values()), default=0) - min((row['epoch'] for row in events.values()), default=0),
            'incomplete': incomplete, 'totals': summarize(completed),
            'groups': [{'machine': key[0], 'kind': key[1], 'lane': key[2], 'worktree': key[3],
                        'plan': key[4], **summarize(values)} for key, values in sorted(groups.items(), key=lambda pair: str(pair[0]))]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', type=Path, action='append', default=[])
    parser.add_argument('--remote', action='append', default=[])
    parser.add_argument('--since', type=float, default=0, help='UTC epoch; default all retained events')
    args = parser.parse_args()
    if not math.isfinite(args.since) or args.since < 0:
        parser.error('since must be a finite nonnegative UTC epoch')
    sources, source_errors = [], []
    for path in args.log or [Path.home() / '.wildshard-heavy-lanes/full-test-day.log']:
        try:
            contents = read_log(path)
        except (OSError, UnicodeError, ValueError) as error:
            contents = None
            source_errors.append({'source': str(path), 'error': str(error)[:160]})
        sources.append((str(path), contents))
    for host in args.remote:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}', host):
            parser.error('remote must be a host name, without shell syntax or SSH options')
        try:
            result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
                '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1', host,
                'head -c 134217729 ~/.wildshard-heavy-lanes/full-test-day.log'], capture_output=True, timeout=12)
            if result.returncode != 0 or len(result.stdout) > MAX_LOG_BYTES:
                raise ValueError('remote observation source unavailable/oversized')
            contents = result.stdout.decode('utf-8')
        except (OSError, UnicodeError, ValueError, subprocess.TimeoutExpired) as error:
            contents = None
            source_errors.append({'source': 'ssh:' + host, 'error': str(error)[:160]})
        sources.append(('ssh:' + host, contents))
    result = report(sources, args.since)
    result['sourceErrors'] = source_errors
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
