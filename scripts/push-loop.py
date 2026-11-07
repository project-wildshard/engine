#!/usr/bin/env python3
"""One temporary push tick: live checks, safe prefix upload, lane notification. No history edits."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

LIVE = runpy.run_path(str(Path(__file__).with_name('live-prepush.py')))
git = LIVE['git']
PUSH_GATE_SECONDS = 45  # G768: unfinished and unverifiable work goes to CI.


def check_binary_json(root, base, tip, deadline):
    """Exact Git blobs before source preparation; no working assets or generated cache."""
    script = subprocess.run(['git', 'show', tip + ':scripts/no-binary-json.mjs'], cwd=root,
                            capture_output=True, text=True, timeout=10)
    if script.returncode != 0:
        # Historical prefixes before the rule existed have nothing to run.
        policy = subprocess.run(['git', 'log', '--format=%H', base + '..' + tip,
                                 '--', 'lint/no-binary-json.json'], cwd=root,
                                capture_output=True, text=True, timeout=10)
        previous = subprocess.run(['git', 'cat-file', '-e', base + ':lint/no-binary-json.json'],
                                  cwd=root, capture_output=True, timeout=10)
        if policy.returncode != 0 or policy.stdout.strip() or previous.returncode == 0:
            return {'ok': False, 'phase': 'binary-json', 'files': ['scripts/no-binary-json.mjs'],
                    'output': 'BINARY-JSON scripts/no-binary-json.mjs: candidate checker missing'}
        return {'ok': True, 'output': ''}
    (root / 'tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root / 'tmp', prefix='push-binary-') as owned:
        checker = Path(owned) / 'no-binary-json.mjs'
        checker.write_text(script.stdout)
        # The generated-source guard shares this immutable policy phase. Old
        # prefixes without its import keep their original checker contract.
        source_guard = subprocess.run(['git', 'show', tip + ':scripts/generated-source.mjs'], cwd=root,
                                      capture_output=True, text=True, timeout=10)
        if source_guard.returncode == 0:
            (Path(owned) / 'generated-source.mjs').write_text(source_guard.stdout)
        rc, output = LIVE['run'](['node', str(checker), '--range', base, tip], root, deadline)
    if rc == 124 and not re.search(r'(?:BINARY-JSON |GENERATED-SOURCE )', output):
        return {'ok': False, 'budget': True, 'phase': 'binary-json', 'files': [],
                'output': output + '\nREFUSED binary-json: local budget exhausted.\n'}
    if rc != 0:
        paths = sorted(set(re.findall(r'^(?:BINARY-JSON|GENERATED-SOURCE) ([^\n:]+):', output, re.M)))
        return {'ok': False, 'phase': 'binary-json', 'files': paths, 'output': output}
    return {'ok': True, 'output': output}


FAST_TOOLS = ('committed-fast-checks.mjs', 'git-source-view.mjs', 'git-rule-counts.mjs')


@contextmanager
def fast_tools(root, revision, deadline):
    """Only three checker modules, not a source tree, cache or generated input."""
    (root / 'tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root / 'tmp', prefix='push-tools-') as owned:
        folder = Path(owned)
        for name in FAST_TOOLS:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError('Exact checker inputs exceeded the local budget')
            source = subprocess.check_output(['git', 'show', revision + ':scripts/' + name], cwd=root, timeout=min(10, left))
            (folder / name).write_bytes(source)
        yield folder


def check_committed(root, base, tip, deadline):
    names = ('binary-json', 'tool-inputs', 'storage', 'deleted-paths', 'ratchet', 'guards', 'fast-lint', 'census')
    steps = LIVE['GateSteps'](names)
    result = {'ok': False, 'phase': 'binary-json', 'files': [], 'output': '', 'types': 'unverified', 'steps': steps.rows}
    def refuse_budget(phase):
        for entry in steps.rows:
            if entry['step'] == phase:
                entry.update(status='failed', reason='budget')
            elif entry['status'] == 'skipped' and entry.get('reason') == 'not-reached':
                entry.update(reason='prior-refusal')
        unfinished = [row['step'] for row in steps.rows if row['status'] != 'passed' and row.get('reason') != 'no-deletions']
        result.update(ok=True, types='ci', phase=phase,
                      output=result['output'] + '\nLocal check unfinished; CI owns the remainder.')
        return result

    with steps.measure('binary-json') as row:
        binary = check_binary_json(root, base, tip, deadline)
        row['status'] = 'budget' if binary.get('budget') else 'passed' if binary['ok'] else 'failed'
    result['output'] = binary['output']
    if binary.get('budget'):
        return refuse_budget('binary-json')
    if not binary['ok']:
        if not binary.get('files'):
            return refuse_budget('binary-json')
        result.update(phase='binary-json', files=binary.get('files', []))
        return result
    files = LIVE['changed'](root, base, tip)
    removed = git(root, 'diff', '--name-only', '--diff-filter=D', '--no-renames', base, tip).splitlines()
    try:
        with steps.measure('tool-inputs'):
            tools = fast_tools(root, git(root, 'rev-parse', 'main'), deadline)
            folder = tools.__enter__()
        try:
            env = dict(os.environ, WS_GIT_CHECK_DEADLINE=str(int((time.time() + max(0, deadline-time.monotonic())) * 1000)))
            for phase in ('storage', 'deleted-paths', 'ratchet', 'guards', 'fast-lint', 'census'):
                if phase == 'deleted-paths' and not removed:
                    steps.skip((phase,), 'no-deletions')
                    continue
                checker = folder / 'committed-fast-checks.mjs'
                command = ['node', str(checker), str(root), base, tip, phase,
                           json.dumps(removed if phase == 'deleted-paths' else files)]
                rc, output = steps.run(phase, LIVE['run'], command, root, deadline, env)
                result['output'] += '\n' + output
                if not rc and 'DEFERRED TO CI' in output:
                    steps.row(phase).update(status='skipped', reason='CI')
                    continue
                observed = re.search(r'(?:\berror(?:\s|\[|\()|(?:Error|TypeError|SyntaxError|RangeError|ReferenceError):|BINARY-JSON |CLOSED |SHRINK-ONLY |Ratchet rose:|deleted path|was \d+, now \d+)', LIVE['ANSI'].sub('', output), re.I)
                if rc == 124:
                    return refuse_budget(phase)
                if rc:
                    if observed is None or not LIVE['failure_paths'](output):
                        return refuse_budget(phase)
                    result.update(phase=phase, files=LIVE['failure_paths'](output))
                    steps.skip(names, 'prior-refusal' if rc != 124 else 'budget-failed')
                    return result
        finally:
            tools.__exit__(None, None, None)
    except (TimeoutError, subprocess.TimeoutExpired):
        return refuse_budget('tool-inputs')
    except (OSError, subprocess.SubprocessError) as error:
        result['output'] += '\nChecker unavailable: ' + str(error)
        return refuse_budget('tool-inputs')
    result.update(ok=True, phase='passed', types='ci', output=result['output'] + '\nFast committed checks complete; CI owns full checks.')
    return result


def load(path, fallback):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return fallback


def lane(root, commits):
    common = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
    ledger = common / 'commit-lanes.jsonl'
    rows = {}
    for line in ledger.read_text().splitlines() if ledger.exists() else []:
        try:
            row = json.loads(line)
            rows[row['sha']] = row.get('lane') or row.get('pane')
        except (ValueError, KeyError):
            continue
    target = next((rows[sha] for sha in commits if rows.get(sha)), None)
    if target and not re.fullmatch(r'sp-(?:[xo]\d+|ci-deploy)|w\w+:p\d+', target):
        target = None
    # Protected plan panes are never prompted, even via a stale pane record.
    if target and not target.startswith('sp-'):
        try:
            listed = json.loads(subprocess.check_output(['herdr', 'agent', 'list'], text=True, timeout=10))
            target = next((agent.get('name') for agent in listed['result']['agents']
                           if agent['pane_id'] == target), None)
        except (subprocess.SubprocessError, ValueError, KeyError):
            target = None
    return target if target and re.fullmatch(r'sp-(?:[xo]\d+|ci-deploy)', target) else 'sp-ci-deploy'


def ping(root, commits, message):
    return subprocess.run(['scripts/herdr-prompt.sh', lane(root, commits), message],
                          cwd=root, stdout=subprocess.DEVNULL, timeout=20).returncode == 0


def offender(root, base, tip, files, deadline):
    left = deadline - time.monotonic()
    if not files or left <= 0:
        return None
    # Diagnostics name exact committed inputs, never loose working files.
    inputs = files
    if not inputs:
        return None
    commits = git(root, 'rev-list', '--reverse', '--first-parent', base + '..' + tip).splitlines()
    for sha in commits:
        if time.monotonic() >= deadline:
            return None
        touched = git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha).splitlines()
        if set(touched).intersection(inputs):
            return sha
    return None


def refusal_signature(output):
    plain = LIVE['ANSI'].sub('', output)
    plain = re.sub(r'(?:push-source-|live-prepush-)[A-Za-z0-9_-]+', '<source-snapshot>', plain)
    return re.sub(r'\d+(?:\.\d+)?(?:ms|s)\b', '<time>', plain)


def tick(root, checker=check_committed, uploader=None, notify=ping, revision='main'):
    common = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
    started = time.monotonic()
    # G768: no quiet pause, red hold, subset, batch splitting or handoff tags.
    deadline = started + PUSH_GATE_SECONDS
    pending_notice = None
    attempts = []

    def finish(result):
        result['steps'] = [dict(row, candidate=revision) for revision, rows in attempts for row in rows]
        result['gateOtherSeconds'] = round(max(0, result['gateSeconds'] -
            sum(row['seconds'] for row in result['steps'])), 4)
        # Lane notification is outside the check budget and never delays upload.
        if pending_notice is not None:
            # The recipient may open this file as soon as Herdr delivers.
            folder = root / 'tmp/push-loop'
            folder.mkdir(parents=True, exist_ok=True)
            detail = {key: value for key, value in result.items() if key != 'output'}
            (folder / 'current.log').write_text(result.get('output', '') + '\n' + json.dumps(detail) + '\n')
            path, state, commits, message = pending_notice
            if notify(root, commits, message):
                state['pinged'] = True
                path.write_text(json.dumps(state))
        return result

    base = git(root, 'rev-parse', 'origin/main')
    tip = git(root, 'rev-parse', revision)
    if base == tip:
        return {'status': 'idle', 'tip': tip}
    if git(root, 'merge-base', tip, 'main') != tip:
        return {'status': 'diverged', 'tip': tip}
    if git(root, 'merge-base', base, tip) != base:
        return {'status': 'diverged', 'tip': tip}
    try:
        result = checker(root, base, tip, deadline)
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError) as error:
        result = {'ok': True, 'phase': 'ci', 'files': [], 'types': 'ci', 'steps': [],
                  'output': 'Local check unavailable; CI owns it: ' + str(error)}
    attempts.append((tip, result.get('steps', [])))

    candidate = tip
    bad = None
    if not result['ok']:
        attribution_started = time.monotonic()
        bad = offender(root, base, tip, result.get('inputs', result['files']), deadline)
        attempts.append((tip, [{'step': 'attribution', 'seconds': round(time.monotonic()-attribution_started, 4),
                                'status': 'passed'}]))
        candidate = git(root, 'rev-parse', bad + '^') if bad else tip
        # An unidentified or unfinished check goes to CI; no red-main hold.
        if bad and candidate != base:
            prefix = checker(root, base, candidate, deadline)
            attempts.append((candidate, prefix.get('steps', [])))
            if not prefix['ok']:
                candidate = base
        state_file = common / 'push-red.json'
        signature = refusal_signature(result['output'])
        fingerprint = hashlib.sha256(json.dumps([bad, result['phase'], result['files'], signature], sort_keys=True).encode()).hexdigest()
        state = load(state_file, {})
        count = state.get('count', 0) + 1 if state.get('fingerprint') == fingerprint else 1
        pinged = state.get('pinged', False) if count > 1 else False
        if not pinged and (bad or count >= 3):
            commits = [bad] if bad else git(root, 'rev-list', '--reverse', base + '..' + tip).splitlines()
            message = '[push-loop] ' + result['phase'] + ' red at ' + (bad or tip)[:10] + '; ' + \
                ('prefix checked; offending suffix stays local. ' if bad else 'same live refusal three times. ') + \
                'Log: tmp/push-loop/current.log. Fix forward and commit.'
            pending_notice = (state_file, {'fingerprint': fingerprint, 'count': count, 'pinged': False}, commits, message)
        state_file.write_text(json.dumps({'fingerprint': fingerprint, 'count': count, 'pinged': pinged}))
    if candidate == base:
        return finish({'status': 'red', 'tip': tip, 'bad': bad, 'phase': result['phase'],
                       'types': result.get('types', 'unavailable'),
                       'gateSeconds': round(time.monotonic() - started, 2), 'output': result['output']})
    env = dict(os.environ, WS_LIVE_GATE_TIP=candidate, WS_LIVE_GATE_BASE=base)
    if uploader is None:
        def uploader(revision, environment):
            return subprocess.run(['git', 'push', '-q', 'origin', revision + ':refs/heads/main'], cwd=root, env=environment).returncode
    gate_seconds = round(time.monotonic() - started, 2)
    upload_started = time.monotonic()
    rc = uploader(candidate, env)
    return finish({'status': 'pushed' if rc == 0 else 'upload-red', 'tip': candidate, 'bad': bad,
                   'types': result.get('types', 'unavailable'),
                   'gateSeconds': gate_seconds, 'uploadSeconds': round(time.monotonic()-upload_started, 4),
                   'output': result['output'], 'gateDeferred': result.get('deferred', []),
                   'batchCommits': result.get('batchCommits', [])})


def main():
    # Any other argument, --help included, must not fall through to a real tick.
    if sys.argv[1:] and not (len(sys.argv) == 3 and sys.argv[1] in ('--check', '--push')):
        print('usage: push-loop.py [--check <revision> | --push <revision>]', file=sys.stderr)
        return 2
    root = Path(git(Path.cwd(), 'rev-parse', '--show-toplevel'))
    if len(sys.argv) == 3 and sys.argv[1] == '--check':
        tip = git(root, 'rev-parse', sys.argv[2])
        result = check_committed(root, git(root, 'merge-base', 'origin/main', tip), tip, time.monotonic() + PUSH_GATE_SECONDS)
        print(json.dumps(result))
        return 0 if result['ok'] else 1
    folder = root / 'tmp/push-loop'
    folder.mkdir(parents=True, exist_ok=True)
    common = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
    # Serialize upload ticks; Simulator markers do not pause publication.
    with (common / 'push-loop.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'busy'}))
            return 0
        # --push publishes one gated ancestor of main, not whatever landed since.
        result = tick(root, revision=sys.argv[2] if len(sys.argv) == 3 else 'main')
        result.setdefault('steps', [])
    (folder / 'current.log').write_text(result.pop('output', '') + '\n' + json.dumps(result) + '\n')
    with (common / 'push.log').open('a') as log:
        log.write(time.strftime('%Y-%m-%dT%H:%M:%S%z ') + json.dumps(result) + '\n')
    print(json.dumps(result))
    return 0 if result['status'] in ('idle', 'pushed', 'quiet', 'held', 'split') else 1


if __name__ == '__main__':
    raise SystemExit(main())
