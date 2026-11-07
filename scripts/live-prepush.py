#!/usr/bin/env python3
"""D9: related tests in one 45-second budget; CI owns complete checks."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

LIMIT = 45
ANSI = re.compile(r'\x1b\[[0-9;]*m')


class GateSteps:
    """Per-step wall time, including explicit reasons for work not attempted."""
    def __init__(self, names):
        self.rows = [{'step': name, 'seconds': 0.0, 'status': 'skipped', 'reason': 'not-reached'}
                     for name in names]

    def row(self, name):
        return next(row for row in self.rows if row['step'] == name)

    @contextmanager
    def measure(self, name):
        row = self.row(name)
        started = time.monotonic()
        row.update(status='passed')
        row.pop('reason', None)
        try:
            yield row
        except BaseException:
            row['status'] = 'error'
            raise
        finally:
            row['seconds'] = round(row['seconds'] + time.monotonic() - started, 4)

    def run(self, name, runner, *args):
        with self.measure(name) as row:
            rc, output = runner(*args)
            row['status'] = 'budget' if rc == 124 else 'failed' if rc else 'passed'
            row['rc'] = rc
            return rc, output

    def skip(self, names, reason):
        for name in names:
            row = self.row(name)
            if row['status'] == 'skipped' and row['reason'] == 'not-reached':
                row['reason'] = reason


CHECK_STEPS = ('closed-components', 'ratchet', 'deleted-paths', 'fast-lint', 'guards', 'recent-selection', 'recent-tests',
               'related-selection', 'related-tests', 'importer-selection', 'typed-lint')


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, timeout=10).strip()


def changed(root, base, tip):
    return git(root, 'diff', '--name-only', '--no-renames', base, tip).splitlines()


def snapshot(root, files):
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            if (root / name).is_file() else None for name in files}


def matches(root, tip, files):
    # A later landing or half edit cannot stand in for a prefix's source.
    return not files or not git(root, 'diff', '--name-only', tip, '--', *files)


def run(command, root, deadline, env=None):
    """Reap the entire owned command group at the shared deadline."""
    left = deadline - time.monotonic()
    if left <= 0:
        return 124, 'pre-push budget exhausted'
    with subprocess.Popen(command, cwd=root, env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, start_new_session=True) as child:
        try:
            output, _ = child.communicate(timeout=left)
            return child.returncode, output
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            output, _ = child.communicate()
            return 124, output + '\npre-push budget exhausted'


def failure_paths(output):
    plain = ANSI.sub('', output)
    # TS, oxlint and Vitest diagnostics. Unknown errors never guess a prefix.
    return sorted(set(re.findall(r'((?<![\w])(?:src|scripts|test|admin|api|drafts|lint|vite)/[^\s():\x1b]+\.(?:json|[cm]?[jt]sx?|py|sh)|(?<![\w/.-])(?:pnpm-lock\.yaml|package\.json))\b', plain)))


def json_path_list(output):
    """Read the last JSON payload despite merged, trailing tool diagnostics."""
    for line in reversed(ANSI.sub('', output).splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, list) and all(isinstance(path, str) for path in value):
            return value
        raise ValueError('Expected a JSON array of paths')
    raise ValueError('Missing JSON array of paths')


def selection_paths(path, output):
    # The CLI writes its result separately: stdout/stderr can interleave inside
    # an arbitrarily long JSON line on the merged diagnostics pipe.
    if not path.exists():
        return json_path_list(output)  # Older tooling may still use stdout.
    value = json.loads(path.read_text())
    if not isinstance(value, list) or not all(isinstance(name, str) for name in value):
        raise ValueError('Expected a JSON array of paths in selector result')
    return value


def check(root, base, tip, deadline, runner=run, files=None, tools=None, types_available=True,
          tests_available=None, test_revision=None, deleted=(), typed_files=(), recent_tests=(), policy_checks=False):
    files = changed(root, base, tip) if files is None else files
    tools = root / 'scripts' if tools is None else tools
    steps = GateSteps(CHECK_STEPS)
    result = {'ok': False, 'phase': 'working-tree', 'files': [], 'output': '', 'steps': steps.rows}
    result['types'] = 'pre-commit'
    tests_available = types_available if tests_available is None else tests_available
    if not tests_available:
        steps.skip(('recent-selection', 'recent-tests', 'related-selection', 'related-tests'), 'generated-inputs')
    if not types_available:
        steps.skip(('importer-selection', 'typed-lint'), 'generated-inputs')
    if test_revision:
        result['output'] = 'Verified generated test inputs: ' + test_revision
        if not types_available:
            result['output'] += ' (previous generation; not current type proof)'
    if not tests_available:
        result['output'] += '\nNo verified generated test inputs: related tests defer to the full CI gate.'
    before = snapshot(root, files)
    (root / 'tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='live-prepush-', dir=root / 'tmp') as temporary:
        listing = Path(temporary) / 'changed.json'
        listing.write_text(json.dumps(files))
        env = dict(os.environ, WS_VITEST_MAX_WORKERS='4', WS_LIVE_PREPUSH='1', NO_COLOR='1')
        def refused(rc, output):
            failed = re.search(r'(?:FAIL\s+|failed\s*\(|Tests\s+\d+ failed|Test Files\s+\d+ failed|error\[|\berror [\w-]+[(/]|CLOSED |SHRINK-ONLY |Ratchet rose:|deleted path)', ANSI.sub('', output))
            return rc != 0 and (rc != 124 or failed)

        def budget_deferred(rc, output):
            if rc != 124 or refused(rc, output):
                return False
            result.update(ok=True, phase='done', types='ci-budget', output=result['output'] + '\n' + output +
                          '\nLocal check budget exhausted; remaining guards, related tests and typed checks defer to full CI.')
            steps.skip(CHECK_STEPS, 'budget')
            return True

        # Exact pre-commit policy timeouts run even when no source was staged.
        # Keep the normal soft budget and observed-refusal handling, with an
        # explicit gate/CI handoff instead of losing the empty typed-file case.
        if policy_checks:
            for phase, command in [
                ('closed-components', ['node', str(tools / 'check-closed-components.mjs'), '--source-only']),
                ('ratchet', ['node', str(root / 'lint/ratchet.mjs'), '--defer-reductions']),
            ]:
                rc, output = steps.run(phase, runner, command, root, deadline, env)
                if rc:
                    if budget_deferred(rc, output):
                        return result
                    result.update(phase=phase, output=output, files=failure_paths(output))
                    return result
                result['output'] += '\nDeferred policy passed: ' + phase
        else:
            steps.skip(('closed-components', 'ratchet'), 'not-requested')
        # Mandatory cheap guards precede optional related tests, including when
        # current generated declarations are unavailable. No app setup runs.
        removed = Path(temporary) / 'deleted.json'
        removed.write_text(json.dumps(list(deleted)))
        if deleted:
            rc, output = steps.run('deleted-paths', runner, ['node', str(tools / 'push-checks.mjs'), 'deleted', str(removed)], root, deadline, env)
            if rc:
                if budget_deferred(rc, output):
                    return result
                result.update(phase='deleted-paths', output=output, files=failure_paths(output))
                return result
        else:
            steps.skip(('deleted-paths',), 'no-deletions')
        # G655 LD2: lint the entire committed snapshot, including files outside
        # this prefix's changed/importer selection. No generated types needed.
        rc, output = steps.run('fast-lint', runner, ['node', str(tools / 'lint-fast.mjs')], root, deadline, env)
        if rc:
            if budget_deferred(rc, output):
                return result
            result.update(phase='fast-lint', output=output, files=failure_paths(output))
            return result
        result['output'] += '\nWhole-repo fast lint passed'
        guards = ['test/host-callbacks.test.ts', 'test/shardfile-boundaries.test.ts',
                  'test/platform-chargebacks.test.ts', 'test/manifest-declarations.test.ts']
        if any(name.startswith(('src/sdk/', 'src/sharddev/')) or name == 'pnpm-lock.yaml' for name in files):
            guards.insert(0, 'test/schema-reference.test.ts')
        rc, output = steps.run('guards', runner, ['pnpm', 'exec', 'vitest', 'run', '--config',
                             'scripts/vitest-push-guards.config.ts', *guards], root, deadline, env)
        if rc:
            if budget_deferred(rc, output):
                return result
            # An observed failure stays red even when its child hits the cap.
            result.update(phase='guards', output=output, files=failure_paths(output))
            return result
        result['output'] += '\nRequired guards passed: ' + ', '.join(guards)
        recent_done = []
        recent = [name for name in dict.fromkeys(recent_tests) if name not in guards
                  and '..' not in name.split('/') and re.fullmatch(r'(?:src/|(?:admin/|drafts/)?test/)[\w./-]+\.test\.ts',name)
                  and (root/name).is_file()]
        if tests_available and recent and deadline-time.monotonic()>2:
            recent_listing = Path(temporary)/'recent.json'
            recent_listing.write_text(json.dumps(recent))
            recent_selected = Path(temporary)/'recent-selected.json'
            rc, output = steps.run('recent-selection', runner, ['node',str(tools/'gate-related-tests.mjs'),str(recent_listing),
                '--live','--recent-only','--budget='+str(max(0,deadline-time.monotonic()-2)),
                '--output='+str(recent_selected)],root,deadline,env)
            if rc not in (0,124):
                result.update(phase='recent-selection',output=output,files=failure_paths(output));return result
            if rc==0:
                try:
                    selected_recent=selection_paths(recent_selected,output)
                except (ValueError,OSError) as error:
                    result.update(phase='recent-selection',output='Invalid recent selector output: '+str(error),files=[]);return result
                # Refuse selector drift rather than running any arbitrary path.
                if any(name not in recent for name in selected_recent):
                    result.update(phase='recent-selection',output='Foreign recent selector path',files=[]);return result
                if selected_recent:
                    rc, output=steps.run('recent-tests', runner, ['pnpm','exec','vitest','run','--config','scripts/vitest-push.config.ts',
                                      *selected_recent],root,deadline,env)
                    if refused(rc,output):
                        result.update(phase='recent-tests',output=output,files=failure_paths(output));return result
                    if rc==0:
                        recent_done=selected_recent
                        result['output']+='\nRecently red tests passed before related: '+', '.join(recent_done)
                    else:
                        result['output']+='\nRecently red tests reached the ceiling; CI owns unfinished tests'
                else:
                    steps.skip(('recent-tests',), 'no-tests')
            else:
                steps.skip(('recent-tests',), 'budget')
                result['output']+='\nRecently red selection reached the ceiling; CI owns unfinished selection'
        elif recent:
            if tests_available:
                steps.skip(('recent-selection', 'recent-tests'), 'budget')
            result['output']+='\nRecently red tests need verified inputs/budget; CI owns: '+', '.join(recent)
        else:
            steps.skip(('recent-selection', 'recent-tests'), 'no-recent-tests')
        left = deadline - time.monotonic()
        if tests_available and left > 2:
            selected = Path(temporary) / 'selected.json'
            rc, output = steps.run('related-selection', runner, ['node', str(tools / 'gate-related-tests.mjs'), str(listing),
                                 '--live', '--budget=' + str(max(0, left - 2)), '--output=' + str(selected)], root, deadline, env)
            if rc not in (0, 124):
                result.update(phase='selection', output=output, files=failure_paths(output))
                return result
            if rc == 0:
                try:
                    tests = selection_paths(selected, output)
                except (ValueError, OSError) as error:
                    result.update(phase='selection', output=f'Invalid related selector output: {error}\n{output}', files=[])
                    return result
                tests = [test for test in tests if test not in guards and test not in recent_done]
                result['output'] += '\n' + output
                if tests:
                    rc, output = steps.run('related-tests', runner, ['pnpm', 'exec', 'vitest', 'run', '--config',
                                         'scripts/vitest-push.config.ts', *tests], root, deadline, env)
                    # An actual refusal remains red, even if the clock then expires.
                    if refused(rc, output):
                        result.update(phase='tests', output=output, files=failure_paths(output))
                        return result
                    if rc == 124:
                        result['output'] += '\nRelated tests reached the ceiling; CI owns unfinished work from: ' + ', '.join(tests)
                    else:
                        result['output'] += '\nRelated tests passed: ' + ', '.join(tests)
                else:
                    steps.skip(('related-tests',), 'no-tests')
            else:
                steps.skip(('related-tests',), 'budget')
                result['output'] += '\nRelated selection reached the ceiling; remaining related tests run in CI'
        elif tests_available:
            steps.skip(('related-selection', 'related-tests'), 'budget')
        # Spend the remaining budget on changed source and its typed importers.
        # Previous generated inputs are deliberately insufficient for this step.
        if types_available and deadline - time.monotonic() > 1:
            imported = Path(temporary) / 'importers.json'
            rc, output = steps.run('importer-selection', runner, ['node', str(tools / 'push-checks.mjs'), 'importers', str(listing),
                                 '--output=' + str(imported)], root, deadline, env)
            if rc not in (0, 124):
                result.update(phase='importers', output=output, files=failure_paths(output))
                return result
            lint = list(typed_files)
            if rc == 0:
                try:
                    lint = list(dict.fromkeys([*lint, *selection_paths(imported, output)]))
                except (ValueError, OSError) as error:
                    result.update(phase='importers', output=f'Invalid importer selector output: {error}\n{output}', files=[])
                    return result
            else:
                result['output'] += '\nImporter selection reached the ceiling; typed importers run in CI'
            if lint and deadline - time.monotonic() > 1:
                for start in range(0, len(lint), 16):
                    remainder = lint[start:]
                    rc, output = steps.run('typed-lint', runner, ['pnpm', 'exec', 'oxlint', '--type-aware',
                                         '-c', '.oxlintrc.json', *remainder[:16]], root, deadline, env)
                    if refused(rc, output):
                        result.update(phase='typed-check', output=output,
                                      files=failure_paths(output) or remainder[:16])
                        return result
                    if rc == 124:
                        result['output'] += '\nTyped lint reached the ceiling; CI owns: ' + ', '.join(remainder)
                        break
                else:
                    result['output'] += '\nTyped importer lint passed: ' + ', '.join(lint)
                    result['types'] = 'pre-commit+importers'
            elif lint:
                steps.skip(('typed-lint',), 'budget')
                result['output'] += '\nPush budget exhausted; typed lint runs in CI: ' + ', '.join(lint)
            else:
                steps.skip(('typed-lint',), 'budget' if rc == 124 else 'no-importers')
        elif not types_available:
            result['output'] += '\nTyped importers require exact generated inputs; CI owns this remainder'
        else:
            steps.skip(('importer-selection', 'typed-lint'), 'budget')
            result['output'] += '\nPush budget exhausted before typed importer selection; CI owns importers of: ' + ', '.join(files)
        if before != snapshot(root, files):
            result.update(phase='working-tree', output='Inputs changed during checks; retry next minute')
            return result
    result.update(ok=True, phase='passed')
    return result


def main():
    root = Path(git(Path.cwd(), 'rev-parse', '--show-toplevel'))
    tip = sys.argv[1] if len(sys.argv) > 1 else 'main'
    tip = git(root, 'rev-parse', tip)
    base = git(root, 'merge-base', 'origin/main', tip)
    result = check(root, base, tip, time.monotonic() + LIMIT)
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
