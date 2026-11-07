"""Reject malformed messages before expensive hooks; valid hooks remain fatal."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

source = Path(sys.argv[1]).resolve()
wrapper = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else source / 'scripts/commit.sh'
before = len(sys.argv) > 3 and sys.argv[3] == 'before'
env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
env.pop('SKIP_ATTRIB', None)
with tempfile.TemporaryDirectory(dir=source / 'tmp', prefix='commit-message-') as temporary:
    root = Path(temporary)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, env=env, text=True).strip()
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'core.hooksPath', '/dev/null')
    (root / 'own.txt').write_text('base\n')
    (root / 'peer.txt').write_text('base\n')
    git('add', '--', 'own.txt', 'peer.txt')
    git('commit', '-qm', 'base')
    (root / 'scripts').mkdir()
    shutil.copy2(wrapper, root / 'scripts/commit.sh')
    (root / '.githooks').mkdir()
    shutil.copy2(source / '.githooks/commit-msg-conventions', root / '.githooks/commit-msg-conventions')
    hook = root / '.githooks/pre-commit'
    hook.write_text('''#!/usr/bin/env python3
import os, pathlib, sys, time
pathlib.Path('checks.txt').write_text('executed')
time.sleep(.2)
sys.exit(23 if os.environ.get('FIXTURE_RED') else 0)
''')
    hook.chmod(0o755)
    hook = root / '.githooks/commit-msg'
    hook.write_text('#!/bin/sh\nexec python3 .githooks/commit-msg-conventions "$1"\n')
    hook.chmod(0o755)
    git('config', 'core.hooksPath', '.githooks')
    (root / 'peer.txt').write_text('peer stage\n')
    git('add', '--', 'peer.txt')
    (root / 'own.txt').write_text('change\n')
    index, head = (root / '.git/index').read_bytes(), git('rev-parse', 'HEAD')
    def run(message, extra=None):
        start = time.monotonic()
        result = subprocess.run(['scripts/commit.sh', message, '--', 'own.txt'],
                                cwd=root, env={**env, **(extra or {})}, capture_output=True, text=True)
        return result, (time.monotonic() - start) * 1000
    message = 'test(cf1): bad body\n\n' + 'x' * 73 + '\n\nAssisted-by: Codex:gpt-6.1-sol'
    rejected, elapsed = run(message)
    assert rejected.returncode != 0 and 'Wrap the body' in rejected.stderr, rejected
    assert git('rev-parse', 'HEAD') == head
    checks = root / 'checks.txt'
    if before:
        assert checks.exists()
        print(json.dumps({'mode': 'before', 'invalidMessageMs': elapsed, 'checksExecuted': True}))
        sys.exit(0)
    assert not checks.exists(), 'malformed message ran expensive checks'
    assert (root / '.git/index').read_bytes() == index, 'preflight changed index'
    missing, _ = run('test(cf1): missing attribution')
    assert missing.returncode != 0 and 'Assisted-by' in missing.stderr and not checks.exists()
    valid = 'test(cf1): valid message\n\nAssisted-by: Codex:gpt-6.1-sol'
    red, _ = run(valid, {'FIXTURE_RED': '1'})
    assert red.returncode != 0 and checks.exists() and git('rev-parse', 'HEAD') == head, red
    passed, _ = run(valid)
    assert passed.returncode == 0 and git('show', 'HEAD:own.txt') == 'change', passed
    assert git('show', 'HEAD:peer.txt') == 'base' and git('show', ':peer.txt') == 'peer stage'
    (root / 'own.txt').write_text('human\n')
    human, _ = run('test(cf1): human commit', {'SKIP_ATTRIB': '1'})
    assert human.returncode == 0 and git('show', 'HEAD:own.txt') == 'human', human
    print(json.dumps({'mode': 'after', 'invalidMessageMs': elapsed, 'checksExecuted': False,
                      'indexPreserved': True, 'validHookRedRefuses': True, 'humanUnchanged': True}))
