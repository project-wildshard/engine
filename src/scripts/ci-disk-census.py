#!/usr/bin/env python3
"""Read-only disk observations retained as runner check annotations."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess


def observe(phase):
    home = Path.home()
    paths = [('workspace', Path('.')), ('dist', Path('dist')),
             ('out', Path('out')), ('tmp', Path('tmp')),
             ('gen', home / '.cache/wildshard/gen'),
             ('spawn-parts-br', home / '.cache/wildshard/gen/spawn-parts-br'),
             ('generate', home / '.cache/wildshard/generate'),
             ('shardfiles', home / '.cache/wildshard/shardfiles')]
    title = 'Fixture disk before snapshots' if phase == 'fixture-before-snapshots' else 'Prepare disk ' + phase.removeprefix('prepare-')
    for name, path in paths:
        row = {'name': name, 'phase': phase,
               'observedAt': datetime.now(timezone.utc).isoformat(),
               'sha': os.environ.get('GITHUB_SHA'),
               'run': os.environ.get('GITHUB_RUN_ID'),
               'job': os.environ.get('GITHUB_JOB'),
               'scope': 'runner' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'local-control'}
        try:
            row['exists'] = path.exists()
            if path.exists():
                disk = os.statvfs(path)
                row.update(freeBytes=disk.f_bavail * disk.f_frsize, freeInodes=disk.f_favail)
                size = subprocess.run(['du', '-sk', str(path)], capture_output=True, text=True)
                fields = size.stdout.split()
                row['allocatedBytes'] = int(fields[0]) * 1024 if size.returncode == 0 and fields else None
                if name in ('dist', 'spawn-parts-br'):
                    parts = {kind: {'files': 0, 'bytes': 0} for kind in ('raw', 'br', 'loose')}
                    for root, _, files in os.walk(path):
                        for file in files:
                            kind = 'raw' if file.endswith('.pack') else 'br' if file.endswith('.pack.br') or name == 'spawn-parts-br' and file.endswith('.br') else 'loose'
                            member = Path(root) / file
                            if not member.is_symlink():
                                parts[kind]['files'] += 1
                                parts[kind]['bytes'] += member.stat().st_size
                    row['parts'] = parts
        except (OSError, ValueError) as error:
            row['unavailable'] = type(error).__name__
        # Both prepare phases share one Actions step's annotation allowance.
        # Retain every row in its log, and the four requested rows per phase
        # in check annotations even if a disk-full runner loses that log.
        annotated = phase == 'fixture-before-snapshots' or name in ('workspace', 'dist', 'gen', 'spawn-parts-br')
        prefix = '::notice title=' + title + '::' if annotated else 'CI disk detail::'
        print(prefix + json.dumps(row, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('fixture-before-snapshots', 'prepare-before-parallel', 'prepare-after-parallel'))
    observe(parser.parse_args().phase)
