"""Patch commits may reuse stat metadata, never peer blobs or hidden flags."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

source, wrapper = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
wrapper_text = sys.stdin.read() if sys.argv[2] == '-' else None
env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
with tempfile.TemporaryDirectory(dir=source / 'tmp', prefix='commit-refresh-') as temporary:
    root = Path(temporary)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, env=env, text=True).strip()
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'core.hooksPath', '/dev/null')
    for index in range(64):
        (root / f'asset-{index}.txt').write_text('unchanged content\n' * 1024)
    for name in ['own.txt', 'peer.txt', 'hidden.txt', 'skip.txt', 'gone.txt']:
        (root / name).write_text('base\n')
    for file in root.iterdir():
        if file.is_file(): os.utime(file, (time.time() - 5, time.time() - 5))
    git('add', '.')
    git('commit', '-qm', 'base')
    git('update-index', '--refresh')
    # Keep peer staged content distinct from both HEAD and working bytes.
    (root / 'peer.txt').write_text('peer stage\n')
    git('add', '--', 'peer.txt')
    peer = git('rev-parse', ':peer.txt')
    (root / 'peer.txt').write_text('peer working\n')
    git('update-index', '--assume-unchanged', 'hidden.txt')
    (root / 'hidden.txt').write_text('foreign hidden working\n')
    git('update-index', '--skip-worktree', 'skip.txt')
    (root / 'skip.txt').write_text('foreign skipped working\n')
    (root / 'new-peer.txt').write_text('new peer stage\n')
    git('add', '--', 'new-peer.txt')
    new_peer = git('rev-parse', ':new-peer.txt')
    (root / 'new-peer.txt').write_text('new peer working\n')
    git('rm', '--cached', '--', 'gone.txt')
    (root / 'scripts').mkdir()
    if wrapper_text is None:
        shutil.copy2(wrapper, root / 'scripts/commit.sh')
    else:
        (root / 'scripts/commit.sh').write_text(wrapper_text)
        (root / 'scripts/commit.sh').chmod(0o755)
    (root / '.githooks').mkdir()
    hook = root / '.githooks/pre-commit'
    hook.write_text('''#!/usr/bin/env python3
import json, subprocess
files=subprocess.check_output(['git','ls-files','-v'],text=True).splitlines()
hidden=[line for line in files if line.startswith('S ') or line[0].islower()]
dirty=subprocess.check_output(['git','diff','--name-only'],text=True).splitlines()
assert all(name in dirty for name in ['hidden.txt','skip.txt','peer.txt']), dirty
open('candidate-flags.json','w').write(json.dumps(hidden))
''')
    hook.chmod(0o755)
    git('config', 'core.hooksPath', '.githooks')
    (root / 'own.txt').write_text('ours\n')
    patch = root / 'own.patch'
    patch.write_text('--- a/own.txt\n+++ b/own.txt\n@@ -1 +1 @@\n-base\n+ours\n')
    trace = root / 'trace.json'
    start = time.monotonic()
    result = subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture metadata', '--', 'own.txt'],
                            cwd=root, env={**env, 'GIT_TRACE2_EVENT': str(trace)}, capture_output=True, text=True)
    elapsed = (time.monotonic() - start) * 1000
    assert result.returncode == 0, result.stdout + result.stderr
    assert git('show', 'HEAD:own.txt') == 'ours'
    assert git('show', 'HEAD:peer.txt') == 'base'
    assert git('show', 'HEAD:hidden.txt') == 'base'
    assert git('rev-parse', ':peer.txt') == peer
    assert (root / 'peer.txt').read_text() == 'peer working\n'
    assert (root / 'hidden.txt').read_text() == 'foreign hidden working\n'
    assert git('show', 'HEAD:skip.txt') == 'base'
    assert git('show', 'HEAD:gone.txt') == 'base'
    assert 'new-peer.txt' not in git('ls-tree', '--name-only', 'HEAD').splitlines()
    assert git('rev-parse', ':new-peer.txt') == new_peer
    assert git('ls-files', '--', 'gone.txt') == ''
    assert (root / 'new-peer.txt').read_text() == 'new peer working\n'
    assert git('ls-files', '-v', '--', 'hidden.txt').startswith('h ')
    assert git('ls-files', '-v', '--', 'skip.txt').startswith('S ')
    rows = [json.loads(line) for line in trace.read_text().splitlines()]
    commit = next(row['sid'] for row in rows if row.get('event') == 'start' and 'commit' in row.get('argv', []))
    scans = [int(row['value']) for row in rows if row.get('sid') == commit and row.get('key') == 'refresh/sum_scan']
    hidden = json.loads((root / 'candidate-flags.json').read_text())
    if len(sys.argv) > 3 and sys.argv[3] == 'strict':
        assert sum(scans) <= 5 and not hidden, (scans, hidden)
    print(json.dumps({'ms': elapsed, 'scanned': sum(scans), 'entries': 69, 'candidateHiddenFlags': hidden,
                      'peerStagePreserved': True, 'peerWorkingPreserved': True}))
