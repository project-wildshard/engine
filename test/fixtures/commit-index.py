"""D9: real pathspec commits preserve foreign stages and serialize messages."""
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
wrapper_text = sys.stdin.read() if len(sys.argv) > 2 and sys.argv[2] == '-' else None
env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
with tempfile.TemporaryDirectory(dir=source / 'tmp', prefix='commit-test-') as temp:
    root = Path(temp)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, env=env, text=True).strip()
    def put(path, text):
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
    # Model Linux's absent BSD lockf even when this fixture runs on macOS.
    put('bin/lockf', '#!/bin/sh\nexit 127\n')
    (root / 'bin/lockf').chmod(0o755)
    env['PATH'] = str(root / 'bin') + os.pathsep + env['PATH']
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'user.name', 'fixture')
    git('config', 'core.hooksPath', '/dev/null')
    for name in ['own.txt', 'peer.txt', 'gone.txt']:
        put(name, 'base\n')
    git('add', '--', 'own.txt', 'peer.txt', 'gone.txt')
    git('commit', '-qm', 'base')
    (root / 'scripts').mkdir()
    if wrapper_text is None:
        shutil.copy2(wrapper, root / 'scripts/commit.sh')
    else:
        (root / 'scripts/commit.sh').write_text(wrapper_text)
        (root / 'scripts/commit.sh').chmod(0o755)
    put('peer.txt', 'staged peer\n')
    git('add', '--', 'peer.txt')
    peer = git('rev-parse', ':peer.txt')
    put('peer.txt', 'working peer\n')
    put('own.txt', 'own change\n')
    put('new file.txt', 'new file\n')
    (root / 'gone.txt').rename(root / 'renamed.txt')
    started = time.monotonic()
    subprocess.run(['scripts/commit.sh', 'fixture own', '--', 'own.txt', 'new file.txt', 'gone.txt'], cwd=root, env=env, check=True)
    assert git('show', 'HEAD:peer.txt') == 'base'
    assert git('rev-parse', ':peer.txt') == peer
    assert (root / 'peer.txt').read_text() == 'working peer\n'
    assert git('show', 'HEAD:new file.txt') == 'new file'
    assert 'gone.txt' not in git('ls-tree', '--name-only', 'HEAD').splitlines()
    first_seconds = time.monotonic() - started
    put('a.txt', 'a\n'); put('b.txt', 'b\n')
    a = subprocess.Popen(['scripts/commit.sh', 'fixture A', '--', 'a.txt'], cwd=root, env=env)
    b = subprocess.Popen(['scripts/commit.sh', 'fixture B', '--', 'b.txt'], cwd=root, env=env)
    results = [a.wait(timeout=10), b.wait(timeout=10)]
    # A concurrent parent change invalidates the exact snapshot. An explicit
    # fresh attempt runs every check again, never silently rebases a proof.
    for status, name in zip(results, ['A', 'B']):
        if status != 0:
            subprocess.run(['scripts/commit.sh', 'fixture ' + name, '--', name.lower() + '.txt'], cwd=root, env=env, check=True)
    assert set(git('log', '-2', '--format=%s').splitlines()) == {'fixture A', 'fixture B'}
    # A patch commits only our lines from HEAD; both peer stages and the
    # same file's other working hunks remain byte-identical.
    put('shared.txt', 'own=base\npeer=base\n')
    subprocess.run(['scripts/commit.sh', 'fixture shared base', '--', 'shared.txt'], cwd=root, env=env, check=True)
    put('shared.txt', 'own=ours\npeer=base\n')
    patch = root / 'own.patch'
    patch.write_text(git('diff', '--', 'shared.txt') + '\n')
    put('shared.txt', 'own=ours\npeer=foreign\n')
    index = (root / '.git/index').read_bytes()
    working = (root / 'shared.txt').read_bytes()
    head = git('rev-parse', 'HEAD')
    refused = subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture wrong scope', '--', 'peer.txt'],
                             cwd=root, env=env, capture_output=True)
    assert refused.returncode != 0 and git('rev-parse', 'HEAD') == head
    preserved = subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture patch', '--', 'shared.txt'], cwd=root, env=env, check=True, capture_output=True, text=True)
    assert 'preserve working edits: shared.txt' in preserved.stderr
    assert git('show', 'HEAD:shared.txt') == 'own=ours\npeer=base'
    assert git('rev-parse', ':shared.txt') == git('rev-parse', 'HEAD:shared.txt')
    assert git('rev-parse', ':peer.txt') == peer
    assert (root / 'shared.txt').read_bytes() == working
    index = (root / '.git/index').read_bytes()
    head = git('rev-parse', 'HEAD')
    stale = subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture stale', '--', 'shared.txt'],
                           cwd=root, env=env, capture_output=True)
    assert stale.returncode != 0 and git('rev-parse', 'HEAD') == head
    assert (root / '.git/index').read_bytes() == index
    assert (root / 'shared.txt').read_bytes() == working
    assert list((root / '.git').glob('commit-patch.*')) == []
    # A same-file foreign stage is preserved rather than aligned to our patch.
    put('shared.txt', 'own=next\npeer=base\n')
    patch.write_text(git('diff', 'HEAD', '--', 'shared.txt') + '\n')
    put('shared.txt', 'own=ours\npeer=staged\n')
    git('add', '--', 'shared.txt')
    foreign = git('rev-parse', ':shared.txt')
    put('shared.txt', 'own=next\npeer=working\n')
    working = (root / 'shared.txt').read_bytes()
    subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture foreign stage', '--', 'shared.txt'], cwd=root, env=env, check=True)
    assert git('rev-parse', ':shared.txt') == foreign
    assert git('show', 'HEAD:shared.txt') == 'own=next\npeer=base'
    assert (root / 'shared.txt').read_bytes() == working
    # New and deleted patch paths advance when their stages are untouched.
    patch.write_text('--- /dev/null\n+++ b/patch-new.txt\n@@ -0,0 +1 @@\n+added\n'
                     '--- a/own.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-own change\n')
    subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture patch paths', '--', 'patch-new.txt', 'own.txt'], cwd=root, env=env, check=True)
    assert git('rev-parse', ':patch-new.txt') == git('rev-parse', 'HEAD:patch-new.txt')
    assert git('ls-files', '--', 'own.txt') == ''
    assert not (root / 'own.txt').exists()
    assert (root / 'patch-new.txt').read_text() == 'added\n'
    assert git('rev-parse', ':peer.txt') == peer
    # An untouched working copy advances, while an edited sibling stays put.
    put('clean.txt', 'before\n')
    subprocess.run(['scripts/commit.sh', 'fixture clean base', '--', 'clean.txt'], cwd=root, env=env, check=True)
    patch.write_text('--- a/clean.txt\n+++ b/clean.txt\n@@ -1 +1 @@\n-before\n+after\n')
    subprocess.run(['scripts/commit.sh', '--patch', str(patch), 'fixture clean patch', '--', 'clean.txt'], cwd=root, env=env, check=True)
    assert (root / 'clean.txt').read_text() == 'after\n'
    assert git('diff', 'HEAD', '--', 'clean.txt') == ''
    assert (root / 'shared.txt').read_bytes() == working
    assert git('rev-parse', ':shared.txt') == foreign
    assert git('rev-parse', ':peer.txt') == peer
    # The storage check still reads this pathspec's staged object and refuses it.
    shutil.copy2(source / 'scripts/repo-size.mjs', root / 'scripts/repo-size.mjs')
    put('scripts/storage-policy.json', json.dumps({'schemaVersion': 1, 'maxBlobBytes': 1000000,
        'maxPreviewBytes': 250000, 'maxBoardBytes': 500000, 'maxPushBytes': 10000000,
        'maxWeeklyBytes': 100000000, 'pins': []}))
    subprocess.run(['scripts/commit.sh', 'fixture storage policy', '--', 'scripts/storage-policy.json'],
                   cwd=root, env=env, check=True)
    put('.githooks/pre-commit', '#!/bin/sh\nnode scripts/repo-size.mjs --index\n')
    (root / '.githooks/pre-commit').chmod(0o755)
    git('config', 'core.hooksPath', '.githooks')
    put('oversized.txt', 'x' * 2000000)
    refused = subprocess.run(['scripts/commit.sh', 'fixture oversize', '--', 'oversized.txt'],
                              cwd=root, env=env, text=True, capture_output=True)
    assert refused.returncode != 0 and '1.00 MB blob cap' in refused.stderr + refused.stdout, refused
    print(json.dumps({'pathspec': 'passed', 'workingAdvance': 'passed', 'patchIsolation': 'passed', 'concurrent': 'passed', 'storageRefusal': 'passed',
                      'commitSeconds': round(first_seconds, 3)}))
