"""Checks release the shared lease and preserve named Git/working state."""
from concurrent.futures import ThreadPoolExecutor
import fcntl
import json
import os
from pathlib import Path
import select
import signal
import shutil
import subprocess
import sys
import tempfile
import time

source = Path(sys.argv[1]).resolve()
wrapper_text = sys.stdin.read() if len(sys.argv) > 2 and sys.argv[2] == '-' else None
wrapper = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else source / 'scripts/commit.sh'
env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
CASES = ['none', 'disjoint', 'dependency', 'stage', 'working', 'candidate', 'red', 'message', 'late-index', 'budget', 'syntax-body', 'syntax-edge']


def check_cases(cases):
    with tempfile.TemporaryDirectory(dir=source / 'tmp', prefix='commit-snapshot-') as directory:
        root = Path(directory)
        def git(*args, **kwargs):
            return subprocess.check_output(['git', *args], cwd=root, env=env, text=True, **kwargs).strip()
        git('init', '-q', '-b', 'main')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.invalid')
        git('config', 'core.hooksPath', '/dev/null')
        for name in ['own.txt', 'own.bin', 'dependency.txt', 'peer.txt', 'dependency.js']:
            (root / name).write_text('base\n')
        git('add', '.')
        git('commit', '-qm', 'base')
        (root / 'scripts').mkdir()
        (root / 'node_modules/@typescript').mkdir(parents=True)
        (root / 'node_modules/@typescript/typescript6').symlink_to((source / 'node_modules/@typescript/typescript6').resolve())
        shutil.copy2(source / 'scripts/repo-size.mjs', root / 'scripts/repo-size.mjs')
        if wrapper_text is None:
            shutil.copy2(wrapper, root / 'scripts/commit.sh')
        else:
            (root / 'scripts/commit.sh').write_text(wrapper_text)
            (root / 'scripts/commit.sh').chmod(0o755)
        (root / '.githooks').mkdir()
        hook = root / '.githooks/pre-commit'
        hook.write_text('''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
root = pathlib.Path.cwd()
read_set = os.environ.get('WS_COMMIT_READ_SET')
if read_set:
    with open(read_set, 'a') as receipt:
        receipt.write(json.dumps({'root': str(root), 'paths':['own.txt','dependency.txt'], 'budget': bool(os.environ.get('BUDGET_MOVE')),
            'imports': {'dependency.js':[]} if os.environ.get('SYNTAX_MOVE') else {}})+'\\n')
before = subprocess.check_output(['git','rev-parse','HEAD'])
print('CHECK_READY', flush=True)
with open('gate') as gate: gate.read()
assert subprocess.check_output(['git','rev-parse','HEAD']) == before, 'check HEAD was not pinned'
if os.environ.get('MUTATE_CANDIDATE'):
    oid=subprocess.check_output(['git','hash-object','-w','--stdin'],input=b'other\\n').decode().strip()
    subprocess.check_call(['git','update-index','--cacheinfo','100644,'+oid+',own.txt'])
sys.exit(23 if os.environ.get('HOOK_RED') else 0)
''')
        hook.chmod(0o755)
        message_hook = root / '.githooks/commit-msg'
        message_hook.write_text('''#!/usr/bin/env python3
import os, subprocess, sys
if os.environ.get('MESSAGE_MUTATE'):
    oid=subprocess.check_output(['git','hash-object','-w','--stdin'],input=b'late\\n').decode().strip()
    subprocess.check_call(['git','update-index','--cacheinfo','100644,'+oid+',own.txt'])
sys.exit(1 if os.environ.get('MESSAGE_RED') else 0)
''')
        message_hook.chmod(0o755)
        git('config', 'core.hooksPath', '.githooks')
        os.mkfifo(root / 'gate')
        results = []
        for number, action in cases:
            case_started = time.monotonic()
            print("CASE_START " + action, file=sys.stderr, flush=True)
            (root / 'own.txt').write_text('change ' + str(number) + '\n')
            head = git('rev-parse', 'HEAD')
            paths = ['own.txt']
            if action == 'budget':
                (root / 'own.bin').write_text('binary change\n')
                paths.append('own.bin')
            child = subprocess.Popen(['scripts/commit.sh', 'fixture ' + action, '--', *paths], cwd=root,
                env={**env, **({'MUTATE_CANDIDATE':'1'} if action == 'candidate' else {}),
                     **({'HOOK_RED':'1'} if action == 'red' else {}), **({'MESSAGE_RED':'1'} if action == 'message' else {}),
                     **({'MESSAGE_MUTATE':'1'} if action == 'late-index' else {}), **({'BUDGET_MOVE':'1'} if action == 'budget' else {}),
                     **({'SYNTAX_MOVE':'1'} if action.startswith('syntax-') else {})},
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
            entered = False
            try:
                ready, _, _ = select.select([child.stdout], [], [], 5)
                assert ready, 'hook did not start'
                first = child.stdout.readline()
                while first and first.strip() != 'CHECK_READY':
                    first = child.stdout.readline()
                entered = first.strip() == 'CHECK_READY'
                assert first.strip() == 'CHECK_READY', first
                # Causal witness: another lane can own the commit lease while the
                # hook is still blocked, without a sleep or timing threshold.
                with (root / '.git/commit.lock').open('a') as lease:
                    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(lease, fcntl.LOCK_UN)
                if action in ['disjoint', 'dependency', 'budget', 'syntax-body', 'syntax-edge']:
                    name = {'disjoint':'peer.txt', 'dependency':'dependency.txt', 'budget':'peer.bin',
                            'syntax-body':'dependency.js', 'syntax-edge':'dependency.js'}[action]
                    contents = {'syntax-body':'export const value=2;\n', 'syntax-edge':'import "./other.js";\n'}
                    (root / name).write_text(contents.get(action, action + '\n'))
                    git('add', '--', name)
                    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'peer ' + action)
                    head = git('rev-parse', 'HEAD')
                if action == 'stage':
                    git('add', '--', 'own.txt')
                if action == 'working':
                    (root / 'own.txt').write_text('late edit\n')
            finally:
                if entered:
                    with (root / 'gate').open('w') as gate:
                        gate.write('continue')
                elif child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                output, error = child.communicate(timeout=8)
            # G768/G769 retired proof/freshness prerequisites. Keep all twelve
            # controls against the actual named candidate; completed hook and
            # message refusals remain fatal, while peer commits remain parents.
            passed = action not in ['red', 'message']
            assert (child.returncode == 0) == passed, (action, output, error)
            assert ('CHECK_READY' not in output), 'pre-commit executed twice'
            if passed:
                expected = 'other' if action == 'candidate' else 'change ' + str(number)
                assert git('show', 'HEAD:own.txt') == expected
                assert git('rev-parse', 'HEAD^') == head
            else:
                assert git('rev-parse', 'HEAD') == head
            if action == 'disjoint':
                assert git('show', 'HEAD:peer.txt') == 'disjoint'
                assert 'retain disjoint peer commits' in output
            if action == 'budget':
                assert git('show', 'HEAD:peer.bin') == 'budget'
                assert git('show', 'HEAD:own.bin') == 'binary change'
            if action == 'dependency':
                assert git('show', 'HEAD:dependency.txt') == 'dependency'
            if action == 'working':
                assert (root / 'own.txt').read_text() == 'late edit\n'
            elif passed:
                assert (root / 'own.txt').read_text() == 'change ' + str(number) + '\n'
            if action == 'syntax-edge':
                assert git('show', 'HEAD:dependency.js') == 'import "./other.js";'
            results.append(action)
            print("CASE_PASS " + action + " " + str(round(time.monotonic() - case_started, 3)) + "s", file=sys.stderr, flush=True)
            # This fixture owns its entire index; do not carry the deliberately
            # staged refusal into a later simulated peer commit.
            git('read-tree', 'HEAD')
        assert list((root / '.git').glob('commit-patch.*')) == []
        return results


# Each group owns its Git history; every scenario checks a real blocked hook / peer race.
# Two independent tiny repositories overlap subprocess startup and waits; the
# Node caller still gives this entire Python process one unchanged 20 s bound.
numbered = list(enumerate(CASES))
with ThreadPoolExecutor(max_workers=2) as pool:
    groups = list(pool.map(check_cases, [numbered[::2], numbered[1::2]]))
results = [case for group in groups for case in group]
assert len(results) == len(CASES) and set(results) == set(CASES), results
print(json.dumps({'outsideLock':True, 'pinnedHead':True, 'disjointPreserved':True,
                  'namedEditsPreserved':True, 'hookRedsFatal':True, 'cases':CASES}))
