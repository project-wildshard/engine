"""Real Git prefix uploads, bounded children and live-check refusal paths."""
import json
import fcntl
import hashlib
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TOOL_ROOT = Path(os.environ.get('WS_PUSH_TOOL_ROOT', ROOT / 'scripts'))
PUSH = {'__file__': str(TOOL_ROOT / 'push-loop.py'), '__name__': 'push_loop_fixture'}
if '--candidate-stdin' in sys.argv:
    sys.argv.remove('--candidate-stdin')
    candidate_source = sys.stdin.read()
else:
    candidate_source = Path(os.environ.get('WS_SW8_CANDIDATE', TOOL_ROOT / 'push-loop.py')).read_text()
exec(compile(candidate_source, str(TOOL_ROOT / 'push-loop.py'), 'exec'), PUSH)
SOURCE = runpy.run_path(str(TOOL_ROOT / 'push-source.py'))
LIVE = PUSH['LIVE']
RESTORE_RUNTIME = runpy.run_path(str(TOOL_ROOT / 'runtime_input_copies.py'))['restore_runtime_inputs']
CACHE = runpy.run_path(str(TOOL_ROOT / 'push_input_cache.py'))
TOOLS = runpy.run_path(str(ROOT / 'scripts/sp-tools.py'))


class PushLoop(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tmp').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='push-loop-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'core.hooksPath', '/dev/null')
        self.put('.oxlintrc.json', '{"ignorePatterns":[]}')
        self.put('.gitignore', 'tmp/\n')
        self.put('scripts/push-inputs.mjs', 'console.log(JSON.stringify(process.argv.slice(2)));')
        self.base = self.commit('src/base.ts')
        self.git('update-ref', 'refs/remotes/origin/main', self.base)

    def git(self, *args):
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        return subprocess.check_output(['git', *args], cwd=self.root, env=env, text=True, stderr=subprocess.DEVNULL).strip()

    def put(self, file, value):
        path = self.root / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def commit(self, file):
        self.put(file, 'export const value = 1;\n')
        self.git('add', '--', '.')
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def test_lane_routes_only_builders_and_defaults_to_ci(self):
        self.assertEqual(PUSH['lane'](self.root, [self.base]), 'sp-ci-deploy')
        for recorded, expected in [('sp-x6', 'sp-x6'), ('sp-o2', 'sp-o2'),
                                   ('sp-ci-deploy', 'sp-ci-deploy'),
                                   ('wildshard-new', 'sp-ci-deploy'),
                                   ('wildshard-v', 'sp-ci-deploy')]:
            with self.subTest(recorded=recorded):
                self.put('.git/commit-lanes.jsonl', json.dumps({'sha': self.base, 'lane': recorded}))
                self.assertEqual(PUSH['lane'](self.root, [self.base]), expected)
        self.put('.git/commit-lanes.jsonl', json.dumps({'sha': self.base, 'pane': 'w1:p1'}))
        check_output = subprocess.check_output
        for resolved, expected in [('sp-x6', 'sp-x6'), ('sp-ci-deploy', 'sp-ci-deploy'),
                                   ('wildshard-new', 'sp-ci-deploy'),
                                   ('wildshard-v', 'sp-ci-deploy')]:
            def inventory(command, *args, **kwargs):
                if command[0] == 'herdr':
                    return json.dumps({'result': {'agents': [{'pane_id': 'w1:p1', 'name': resolved}]}})
                return check_output(command, *args, **kwargs)
            with self.subTest(resolved=resolved), patch.object(subprocess, 'check_output', side_effect=inventory):
                self.assertEqual(PUSH['lane'](self.root, [self.base]), expected)

    def test_pane_environment_drops_ephemeral_codex_path_and_keeps_session(self):
        context = {'HERDR_ENV': '1', 'HERDR_SESSION': 'fixture',
                   'HERDR_SOCKET_PATH': '/fixture/herdr.sock', 'HERDR_PANE_ID': 'w1:p1',
                   'PATH': '/Users/me/.codex/packages/standalone/releases/old/codex-path:/bin:/Users/me/.codex/tmp/arg0/tool:/usr/local/bin:/bin'}
        cleaned = TOOLS['environment'](context)
        self.assertEqual(cleaned['PATH'], '/bin:/usr/local/bin')
        self.assertEqual(cleaned['HERDR_SESSION'], 'fixture')
        self.assertEqual(cleaned['HERDR_SOCKET_PATH'], '/fixture/herdr.sock')
        self.assertEqual(context['PATH'].split(':')[0], '/Users/me/.codex/packages/standalone/releases/old/codex-path')

    def test_cli_defers_overlap_and_observes_quiet_after_the_activity_lock(self):
        self.put('.git/quiet', '{"owner":"fixture-sample"}')
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        command = [sys.executable, str(ROOT / 'scripts/push-loop.py')]
        with (self.root / '.git/push-loop.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            busy = subprocess.run(command, cwd=self.root, env=env, capture_output=True, text=True, timeout=3)
            self.assertEqual(busy.returncode, 0, busy.stderr)
            self.assertEqual(json.loads(busy.stdout)['status'], 'busy')
        resumed = subprocess.run(command, cwd=self.root, env=env, capture_output=True, text=True, timeout=3)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(json.loads(resumed.stdout)['status'], 'idle')
        self.assertEqual(self.git('rev-parse', 'origin/main'), self.base)

    def test_cli_refuses_unknown_arguments_before_any_tick(self):
        tip = self.commit('src/good.ts')
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        for arguments in (['--help'], ['--check'], ['--push'], ['--dry-run'], ['--check', 'HEAD', 'extra']):
            refused = subprocess.run([sys.executable, str(ROOT / 'scripts/push-loop.py'), *arguments],
                                     cwd=self.root, env=env, capture_output=True, text=True, timeout=3)
            self.assertEqual(refused.returncode, 2, refused.stdout)
            self.assertEqual(refused.stdout, '')
            self.assertIn('usage: push-loop.py', refused.stderr)
        self.assertEqual(self.git('rev-parse', 'origin/main'), self.base)
        self.assertEqual(self.git('rev-parse', 'main'), tip)

    def test_a_named_revision_publishes_only_that_ancestor_of_main(self):
        gated = self.commit('src/gated.ts')
        later = self.commit('src/later.ts')
        checks, uploads = [], []
        def checker(root, base, tip, deadline):
            checks.append(tip)
            return {'ok': True, 'output': ''}
        def upload(revision, environment):
            uploads.append(revision)
            return 0
        result = PUSH['tick'](self.root, checker=checker, uploader=upload, revision=gated)
        self.assertEqual((result['status'], result['tip']), ('pushed', gated))
        self.assertEqual((checks, uploads), ([gated], [gated]))
        self.assertEqual(self.git('rev-parse', 'main'), later)

    def test_a_named_revision_off_main_is_refused(self):
        self.commit('src/good.ts')
        self.git('checkout', '-qb', 'side', self.base)
        side = self.commit('src/side.ts')
        self.git('checkout', '-q', 'main')
        def never(*args):
            raise AssertionError('no check or upload')
        result = PUSH['tick'](self.root, checker=never, uploader=never, revision=side)
        self.assertEqual((result['status'], result['tip']), ('diverged', side))

    def test_quiet_sample_never_defers_checks_or_upload(self):
        tip = self.commit('src/good.ts')
        self.put('.git/quiet', json.dumps({'schema':1,'kind':'simulator-reading','script':'scripts/sim-grid-entry.mjs','owner':'fixture-sample','pid':os.getpid()}))
        checks, uploads = [], []
        def checker(*args):
            checks.append(args)
            return {'ok': True, 'output': ''}
        def upload(*args):
            uploads.append(args)
            return 0
        result = PUSH['tick'](self.root, checker=checker, uploader=upload)
        self.assertEqual(result['status'], 'pushed')
        self.assertEqual(result['tip'], tip)
        self.assertEqual(len(checks), 1)
        self.assertEqual(len(uploads), 1)
        (self.root / '.git/quiet').unlink()
        self.assertEqual(PUSH['tick'](self.root, checker=checker, uploader=upload)['status'], 'pushed')
        self.assertEqual(len(checks), 2)
        self.assertEqual(len(uploads), 2)


    def test_stale_legacy_quiet_no_longer_stops_pushes(self):
        self.commit('src/after-stale-owner.ts')
        self.put('.git/quiet', '{"owner":"fixture-sample"}')
        path = self.root / '.git/quiet'
        os.utime(path, (time.time() - 601, time.time() - 601))
        result = PUSH['tick'](self.root, checker=lambda *_: {'ok': True, 'output': ''}, uploader=lambda *_: 0)
        self.assertEqual(result['status'], 'pushed')

    def test_push_prioritizes_fast_lint_guards_related_then_importer_lint(self):
        tip = self.commit('src/good.ts')
        commands = []
        def runner(command, *_):
            commands.append(command)
            if '--live' in command:
                return 0, '["test/unit.test.ts"]'
            if 'importers' in command:
                return 0, '["src/good.ts"]'
            return 0, ''
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner)
        self.assertTrue(result['ok'])
        self.assertEqual([command[0] for command in commands], ['node', 'pnpm', 'node', 'pnpm', 'node', 'pnpm'])
        self.assertEqual(commands[0], ['node', str(self.root / 'scripts/lint-fast.mjs')])
        self.assertIn('scripts/vitest-push-guards.config.ts', commands[1])
        self.assertIn('scripts/vitest-push.config.ts', commands[3])
        self.assertIn('oxlint', commands[-1])
        self.assertEqual(result['types'], 'pre-commit+importers')

    def test_real_selector_emits_payload_when_console_info_is_muted(self):
        self.put('vitest.config.mjs', "export default {test:{include:['test/*.test.ts'],setupFiles:[]}};")
        self.put('test/consumer.test.ts', "import {test} from 'vitest'; import '../src/base'; test('unit',()=>{});")
        self.put('changed.json', '["src/base.ts"]')
        self.put('mute-console.mjs', 'console.info = () => {};')
        subprocess.run(['node', str(TOOL_ROOT / 'link-node-modules.mjs'), str(ROOT), str(self.root)], check=True)
        process = subprocess.run(['node', '--import', './mute-console.mjs', str(TOOL_ROOT / 'gate-related-tests.mjs'),
                                  'changed.json', '--live', '--budget=10', '--output=selected.json'], cwd=self.root,
                                 capture_output=True, text=True, timeout=20)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout, '')
        self.assertEqual(json.loads((self.root / 'selected.json').read_text()), ['test/consumer.test.ts'])

    def test_file_results_survive_json_spliced_inside_stderr_lines(self):
        tip = self.commit('src/good.ts')
        commands = []
        def runner(command, *_):
            commands.append(command)
            if '--live' in command or 'importers' in command:
                target = next(value[9:] for value in command if value.startswith('--output='))
                rows = ['test/unit.test.ts'] if '--live' in command else ['src/good.ts']
                Path(target).write_text(json.dumps(rows))
                # Retained real output put JSON inside a partial stderr line,
                # at byte65597: ... (job driftwo["test/..." ... ]\nod-zipline...
                return 0, 'stderr prefix (job driftwo["test/unit.test.ts"]\nod-zipline diagnostic\n'
            return 0, ''
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner)
        self.assertTrue(result['ok'], result)
        self.assertTrue(any('test/unit.test.ts' in command for command in commands))
        self.assertTrue(any('oxlint' in command and 'src/good.ts' in command for command in commands))
        target = self.root / 'malformed-selection.json'
        target.write_text('[1]')
        with self.assertRaises(ValueError):
            LIVE['selection_paths'](target, '["test/fallback.test.ts"]')

    def test_selector_diagnostics_after_json_do_not_crash_or_skip_tests(self):
        tip = self.commit('src/good.ts')
        commands = []
        def runner(command, *_):
            commands.append(command)
            if '--live' in command:
                # rc=0 with a diagnostic after JSON matches the observed crash:
                # merged stderr can arrive after the selector writes its array.
                return 0, 'selection complete\n["test/unit.test.ts"]\n\x1b[33mVite warning after shutdown\x1b[0m\n'
            if 'importers' in command:
                return 0, '["src/good.ts"]\nNode diagnostic after stdout\n'
            return 0, ''
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner)
        self.assertTrue(result['ok'], result)
        self.assertTrue(any('test/unit.test.ts' in command for command in commands))
        self.assertTrue(any('oxlint' in command and 'src/good.ts' in command for command in commands))
        self.assertEqual(LIVE['json_path_list']('[]\ntrailing warning'), [])

    def test_invalid_selector_output_refuses_with_diagnostics_without_exception(self):
        tip = self.commit('src/good.ts')
        for payload in ['', 'not JSON', '{}', '[1]', '["test/unit.test.ts"']:
            with self.subTest(payload=payload):
                def runner(command, *_):
                    return (0, payload) if '--live' in command else (0, '')
                result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner)
                self.assertFalse(result['ok'])
                self.assertEqual(result['phase'], 'selection')
                self.assertEqual(result['files'], [])
                self.assertIn('Invalid related selector output', result['output'])
        def malformed_importers(command, *_):
            return (0, '[]') if '--live' in command else (0, 'not JSON')
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, malformed_importers)
        self.assertFalse(result['ok'], result)
        self.assertEqual(result['phase'], 'importers')
        self.assertIn('Invalid importer selector output', result['output'])

    def test_edit_during_tests_cannot_earn_a_pass(self):
        tip = self.commit('src/good.ts')
        def runner(command, *_):
            self.put('src/good.ts', 'half written')
            return 0, '[]'
        self.assertFalse(LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner)['ok'])

    def test_deadline_reaps_owned_process(self):
        start = time.monotonic()
        rc, _ = LIVE['run']([sys.executable, '-c', 'import signal; signal.pause()'], self.root, start + .15)
        self.assertEqual(rc, 124)
        self.assertLess(time.monotonic() - start, 2)

    def test_committed_source_ignores_working_and_index_edits(self):
        for name in [*SOURCE['TOOLS'], *SOURCE.get('CONFIGS', []), 'link-node-modules.mjs']:
            self.put('scripts/' + name, '// committed tool\n')
        self.put('scripts/runtime_input_copies.py', (TOOL_ROOT / 'runtime_input_copies.py').read_text())
        self.put('scripts/copied-runtime-inputs.json', '{"version":1,"copies":[]}')
        self.put('package.json', '{}')
        self.put('src/data.json', '{"state":"committed"}')
        self.put('src/other.ts', 'export const original = true;')
        self.put('src/asset.ts', "import image from './image.png'; export {image};")
        self.put('src/image.png', 'committed-binary')
        self.put('test/native-input.test.ts', """
import {readFileSync} from 'node:fs';
readFileSync(new URL('../public/assets/baked/example/terrain.bin', import.meta.url));
readFileSync('public/assets/native/rows.dat');
readFileSync(`../public/assets/native/template.bin`);
const url = '/assets/native/image.png';
readFileSync('../public/assets/native/untracked.bin');
""")
        native = {
            'public/assets/baked/example/terrain.bin': b'\x00committed-terrain\xff',
            'public/assets/native/rows.dat': b'\x01committed-rows',
            'public/assets/native/template.bin': b'\x02committed-template',
            'public/assets/native/image.png': b'\x03committed-image',
        }
        for name, data in native.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.put('public/assets/native/unrelated.bin', 'unrelated tracked input')
        tip = self.commit('src/client/app/entry.ts')
        for name in native:
            (self.root / name).write_bytes(b'foreign working input')
        self.put('public/assets/native/untracked.bin', 'untracked input')
        self.put('src/other.ts', 'half written foreign WIP')
        self.put('src/data.json', '{"state":"staged WIP"}')
        self.git('add', '--', 'src/data.json')
        index = (self.root / '.git/index').read_bytes()
        load_tool = runpy.run_path
        def older_generation(path):
            tool = load_tool(path)
            if Path(path).name == 'push_input_cache.py':
                restore = tool['restore_tests']
                def stale_inputs(repo, tree, records, deadline):
                    revision = restore(repo, tree, records, deadline)
                    for name in native:
                        target = tree / name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(b'older verified generated asset')
                    return revision
                tool['restore_tests'] = stale_inputs
            return tool
        with patch.object(runpy, 'run_path', side_effect=older_generation), \
                SOURCE['committed_source'](self.root, tip, tip, time.monotonic() + 10) as (tree, tools):
            self.assertEqual((tree / 'src/other.ts').read_text(), 'export const original = true;')
            self.assertEqual((tree / 'src/data.json').read_text(), '{"state":"committed"}')
            self.assertEqual((tools / 'push-inputs.mjs').read_text(), '// committed tool\n')
            self.assertEqual((tree / 'src/image.png').read_text(), 'committed-binary')
            for name, data in native.items():
                self.assertEqual((tree / name).read_bytes(), data)
            self.assertFalse((tree / 'public/assets/native/unrelated.bin').exists())
            self.assertFalse((tree / 'public/assets/native/untracked.bin').exists())
        self.assertEqual((self.root / 'src/other.ts').read_text(), 'half written foreign WIP')
        for name in native:
            self.assertEqual((self.root / name).read_bytes(), b'foreign working input')
        self.assertEqual((self.root / '.git/index').read_bytes(), index)

    def test_copied_fast_lint_executes_exact_committed_tool_dependencies(self):
        for name in [*SOURCE['TOOLS'], *SOURCE['CONFIGS']]:
            self.put('scripts/' + name, '// unused copied tool\n')
        exact = {}
        for name in [*SOURCE['FAST_LINT_TOOLS'], 'link-node-modules.mjs']:
            exact[name] = ((TOOL_ROOT / name).read_text() if name == 'lint-fast.mjs' else
                           subprocess.check_output(['git', 'show', 'HEAD:scripts/' + name], cwd=ROOT, text=True))
            self.put('scripts/' + name, exact[name])
        self.put('lint/layer-exports.mjs', subprocess.check_output(['git', 'show', 'HEAD:lint/layer-exports.mjs'], cwd=ROOT, text=True))
        self.put('scripts/runtime_input_copies.py', (TOOL_ROOT / 'runtime_input_copies.py').read_text())
        self.put('scripts/copied-runtime-inputs.json', '{"version":1,"copies":[]}')
        self.put('package.json', '{}')
        self.put('.oxlintrc.json', json.dumps({'ignorePatterns': ['scripts/**', '.push-tools/**', '**/*.generated.*'], 'rules': {'no-eval': 'error'}}))
        self.put('src/unchanged.ts', 'eval("1");\n')
        self.put('src/ignored.generated.ts', 'eval("2");\n')
        tip = self.commit('src/changed.ts')
        self.put('scripts/lint-fast.mjs', 'throw Error("foreign working tool");\n')
        subprocess.run(['node', str(TOOL_ROOT / 'link-node-modules.mjs'), str(ROOT), str(self.root)], check=True)
        with SOURCE['committed_source'](self.root, tip, tip, time.monotonic() + 30) as (tree, tools):
            for name, source in exact.items():
                self.assertEqual((tools / name).read_text(), source)
            result = subprocess.run(['node', str(tools / 'lint-fast.mjs')], cwd=tree,
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn('no-eval', result.stdout + result.stderr)
            self.assertNotIn('ignored.generated.ts', result.stdout + result.stderr)
            self.assertNotIn('MODULE_NOT_FOUND', result.stdout + result.stderr)
            self.assertNotIn('foreign working tool', result.stdout + result.stderr)

    def test_binary_json_git_guard_precedes_source_preparation(self):
        self.put('scripts/no-binary-json.mjs', (TOOL_ROOT / 'no-binary-json.mjs').read_text())
        self.put('scripts/generated-source.mjs', (TOOL_ROOT / 'generated-source.mjs').read_text())
        self.put('lint/no-binary-json.json', json.dumps({'schema': 'no-binary-json/1', 'source': self.base, 'files': {}}))
        baseline = self.commit('src/policy.ts')
        path = 'public/assets/example/rows.json'
        self.put(path, json.dumps({'data': 'a' * 1024}))
        bad = self.commit('src/binary.ts')
        self.put(path, '{}')  # A dirty working file cannot hide a committed asset.
        with patch.dict(PUSH, fast_tools=lambda *_: self.fail('tools read before binary refusal')):
            result = PUSH['check_committed'](self.root, baseline, bad, time.monotonic() + 45)
        self.assertFalse(result['ok'])
        self.assertEqual(result['phase'], 'binary-json')
        self.assertEqual(result['files'], [path])
        self.assertEqual((self.root / path).read_text(), '{}')
        # G768 checks net committed bytes; a removed transient blob does not block.
        (self.root / path).unlink()
        self.git('add', '-u', '--', path)
        clean = self.commit('src/clean.ts')
        self.assertTrue(PUSH['check_binary_json'](self.root, baseline, clean, time.monotonic() + 45)['ok'])

    def test_generated_source_guard_uses_committed_helper_and_debt_before_preparation(self):
        source_directory = 'src'
        self.put('scripts/no-binary-json.mjs', (TOOL_ROOT / 'no-binary-json.mjs').read_text())
        self.put('scripts/generated-source.mjs', (TOOL_ROOT / 'generated-source.mjs').read_text())
        self.put('lint/no-binary-json.json', json.dumps({'schema': 'no-binary-json/1', 'source': self.base, 'files': {}}))
        policy = 'lint/generated-source-debt.json'
        self.put(policy, json.dumps({'schema': 'generated-source/1', 'source': self.base, 'files': []}))
        baseline = self.commit(f'{source_directory}/policy.ts')
        path = f'{source_directory}/new.generated.ts'
        bad = self.commit(path)
        self.put(path, '')
        self.put(policy, json.dumps({'schema': 'generated-source/1', 'source': self.base, 'files': [path]}))
        self.put('scripts/generated-source.mjs', 'throw Error("foreign working guard");')
        with patch.dict(PUSH, fast_tools=lambda *_: self.fail('tools read before generated-source refusal')):
            result = PUSH['check_committed'](self.root, baseline, bad, time.monotonic() + 45)
        self.assertFalse(result['ok'])
        self.assertEqual(result['files'], [path])
        self.assertIn('GENERATED-SOURCE', result['output'])
        self.assertNotIn('foreign working guard', result['output'])
        self.assertEqual((self.root / path).read_text(), '')

    def test_binary_json_budget_refuses_and_preserves_observed_refusal(self):
        self.put('scripts/no-binary-json.mjs', (TOOL_ROOT / 'no-binary-json.mjs').read_text())
        self.put('scripts/generated-source.mjs', (TOOL_ROOT / 'generated-source.mjs').read_text())
        self.put('lint/no-binary-json.json', json.dumps({'schema': 'no-binary-json/1', 'source': self.base, 'files': {}}))
        tip = self.commit('src/policy.ts')
        generated_path = '/'.join(('src', 'new.generated.ts'))
        for output, accepted in [('still running', False), ('BINARY-JSON public/new.json: binary', False),
                                 (f'GENERATED-SOURCE {generated_path}: new output', False)]:
            with patch.dict(LIVE, run=lambda *_: (124, output)):
                result = PUSH['check_binary_json'](self.root, self.base, tip, time.monotonic() + 45)
            self.assertEqual(result['ok'], accepted)
        self.git('rm', 'scripts/no-binary-json.mjs')
        deleted = self.commit('src/deleted-checker.ts')
        self.assertFalse(PUSH['check_binary_json'](self.root, tip, deleted, time.monotonic() + 45)['ok'])

    def test_source_command_accepts_soft_preparation_deadline(self):
        result = SOURCE['command'](self.root, [sys.executable, '-c', 'print("exact")'],
                                           float('inf'), capture_output=True, text=True)
        self.assertEqual(result.stdout.strip(), 'exact')

    def test_gate_uses_committed_fast_checks_without_subset(self):
        tip = self.commit('src/good.ts')
        calls, cleanups = [], []
        @contextmanager
        def prepared(root, revision, deadline):
            self.assertEqual(revision, tip)
            try:
                yield self.root / 'scripts'
            finally:
                cleanups.append(revision)
        def runner(command, root, deadline, env):
            calls.append(command[-2])
            if command[-2] == 'fast-lint':
                self.assertEqual(Path(command[1]), self.root / 'scripts/committed-fast-checks.mjs')
            self.assertEqual(root, self.root)
            self.assertGreater(deadline, time.monotonic())
            self.assertIn('WS_GIT_CHECK_DEADLINE', env)
            return 0, 'passed'
        with patch.dict(PUSH, fast_tools=prepared), patch.dict(LIVE, run=runner):
            result = PUSH['check_committed'](self.root, self.base, tip, time.monotonic() + 45)
        self.assertTrue(result['ok'])
        self.assertEqual(result['types'], 'ci')
        self.assertEqual(calls, ['storage', 'ratchet', 'guards', 'fast-lint', 'census'])
        self.assertEqual(cleanups, [tip])
        steps = {row['step']: row for row in result['steps']}
        self.assertNotIn('source-prepare', steps)
        self.assertNotIn('source-cleanup', steps)
        self.assertEqual(steps['fast-lint']['status'], 'passed')
        self.assertNotIn('ci-subset', steps)
        self.assertNotIn('ci-G675', str(steps))
        self.assertEqual(steps['deleted-paths']['reason'], 'no-deletions')


    def test_step_timings_cover_policy_recent_related_and_typed_work_once(self):
        tip = self.commit('src/timed.ts')
        self.put('test/recent.test.ts', '')
        clock = [100.0]
        def runner(command, *_):
            clock[0] += 1.25
            if '--recent-only' in command:
                return 0, '["test/recent.test.ts"]'
            if '--live' in command:
                return 0, '["test/related.test.ts"]'
            if 'importers' in command:
                return 0, '["src/timed.ts"]'
            return 0, ''
        with patch.object(time, 'monotonic', side_effect=lambda: clock[0]):
            result = LIVE['check'](self.root, self.base, tip, 143, runner=runner,
                                   policy_checks=True, deleted=['src/old.ts'],
                                   recent_tests=['test/recent.test.ts'])
        self.assertTrue(result['ok'], result)
        self.assertEqual([row['step'] for row in result['steps']], list(LIVE['CHECK_STEPS']))
        self.assertTrue(all(row['seconds'] == 1.25 and row['status'] == 'passed' and row['rc'] == 0
                            for row in result['steps']))
        self.assertEqual(sum(row['seconds'] for row in result['steps']), clock[0]-100)

    def test_step_timings_distinguish_budget_inputs_and_no_work(self):
        tip = self.commit('src/timed.ts')
        clock = [100.0]
        def timed_out(*_):
            clock[0] += 43
            return 124, 'still running'
        with patch.object(time, 'monotonic', side_effect=lambda: clock[0]):
            result = LIVE['check'](self.root, self.base, tip, 143, runner=timed_out)
        self.assertTrue(result['ok'], result)
        steps = {row['step']: row for row in result['steps']}
        self.assertEqual(steps['fast-lint']['seconds'], 43)
        self.assertEqual(steps['fast-lint']['status'], 'budget')
        self.assertEqual(steps['guards']['reason'], 'budget')
        self.assertEqual(steps['deleted-paths']['reason'], 'no-deletions')
        self.assertEqual(steps['ratchet']['reason'], 'not-requested')
        result = LIVE['check'](self.root, self.base, tip, time.monotonic()+45,
                               runner=lambda *_: (0, ''), types_available=False)
        steps = {row['step']: row for row in result['steps']}
        self.assertEqual(steps['related-tests']['reason'], 'generated-inputs')
        self.assertEqual(steps['typed-lint']['reason'], 'generated-inputs')

    def test_push_batch_uses_the_G768_45_second_cap(self):
        tip = self.commit('src/good.ts')
        deadlines = []
        def checker(root, base, candidate, deadline):
            deadlines.append(deadline - time.monotonic())
            return {'ok': True, 'phase': 'passed', 'files': [], 'output': '', 'types': 'checked'}
        result = PUSH['tick'](self.root, checker=checker, uploader=lambda *_: 0)
        self.assertEqual(result['status'], 'pushed')
        self.assertEqual(result['tip'], tip)
        self.assertEqual(len(deadlines), 1)
        self.assertGreater(deadlines[0], 44)
        self.assertLessEqual(deadlines[0], 45)


    def test_unfinished_gate_and_unverified_inputs_go_to_ci(self):
        tip = self.commit('src/good.ts')
        cases = [(phase, 'budget') for phase in
                 ('binary-json', 'tool-inputs', 'storage', 'ratchet', 'guards', 'fast-lint', 'census')]
        cases.append(('fast-lint', 'unverified-inputs'))
        for phase, cause in cases:
            with self.subTest(phase=phase, cause=cause):
                uploads = []
                @contextmanager
                def prepared(*_):
                    if phase == 'tool-inputs':
                        raise TimeoutError('exact checker inputs exhausted')
                    yield self.root / 'scripts'
                def binary(*_):
                    return {'ok': phase != 'binary-json', 'budget': phase == 'binary-json',
                            'files': [], 'output': 'policy result'}
                def runner(command, *_):
                    if command[-2] != phase:
                        return 0, 'passed'
                    return (0, 'DEFERRED TO CI fast-lint src/good.ts') if cause == 'unverified-inputs' else (124, 'still running')
                with patch.dict(PUSH, fast_tools=prepared, check_binary_json=binary), patch.dict(LIVE, run=runner):
                    result = PUSH['tick'](self.root, checker=PUSH['check_committed'],
                                          uploader=lambda *args: uploads.append(args) or 0, notify=lambda *_: True)
                self.assertEqual(result['tip'], tip)
                self.assertEqual(result['status'], 'pushed')
                self.assertEqual(len(uploads), 1)
                self.assertIsNone(result['bad'])
                steps = {row['step']: row for row in result['steps'] if row['step'] != 'attribution'}
                self.assertEqual(steps[phase]['status'], 'failed' if cause == 'budget' else 'skipped')
                self.assertEqual(steps[phase]['reason'], 'budget' if cause == 'budget' else 'CI')

    def test_guard_budget_defers_only_without_observed_failures(self):
        tip = self.commit('src/good.ts')
        for deleted in [(), ('src/gone.ts',)]:
            for output, accepted in [('still running', True), ('FAIL test/guard.test.ts assertion', False),
                                     ('CLOSED C1 regrew', False), ('src/a.ts: deleted path src/gone.ts', False)]:
                with self.subTest(deleted=deleted, output=output):
                    result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45,
                                           runner=lambda *_: (124, output), deleted=deleted)
                    self.assertEqual(result['ok'], accepted)
                    if accepted:
                        self.assertEqual(result['types'], 'ci-budget')
                        self.assertIn('defer to full CI', result['output'])

    def test_fast_lint_covers_whole_tree_without_generated_inputs(self):
        tip = self.commit('src/changed.ts')
        calls = []
        def runner(command, root, *_):
            self.assertEqual(root, self.root)
            calls.append(command)
            return 0, ''
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45,
                               runner=runner, types_available=False, tests_available=False)
        self.assertTrue(result['ok'])
        self.assertEqual(calls[0], ['node', str(self.root / 'scripts/lint-fast.mjs')])
        self.assertIn('scripts/vitest-push-guards.config.ts', calls[1])
        self.assertIn('Whole-repo fast lint passed', result['output'])
        self.assertFalse(any('--live' in command or 'importers' in command for command in calls))

    def test_fast_lint_refuses_unchanged_file_before_any_test(self):
        tip = self.commit('src/changed.ts')
        for rc in (1, 124):
            calls = []
            def runner(command, *_):
                calls.append(command)
                return rc, 'src/unchanged.ts:2:1 error eslint(no-eval): refused'
            result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner=runner)
            self.assertFalse(result['ok'])
            self.assertEqual(result['phase'], 'fast-lint')
            self.assertEqual(result['files'], ['src/unchanged.ts'])
            self.assertEqual(calls, [['node', str(self.root / 'scripts/lint-fast.mjs')]])

    def test_checker_input_errors_defer_to_full_ci(self):
        tip = self.commit('src/good.ts')
        @contextmanager
        def invalid(*_):
            raise OSError('Missing committed checker blob')
            yield
        with patch.dict(PUSH, fast_tools=invalid):
            result = PUSH['check_committed'](self.root, self.base, tip, time.monotonic() + 45)
        self.assertTrue(result['ok'])
        self.assertEqual(result['phase'], 'tool-inputs')
        self.assertIn('Missing committed checker blob', result['output'])

    def test_timed_out_tests_defer_but_observed_failures_stay_red(self):
        tip = self.commit('src/good.ts')
        for output, expected in [('still running', True), ('FAIL test/unit.test.ts > broken', False)]:
            def runner(command, *_):
                if '--live' in command:
                    return 0, '["test/unit.test.ts"]'
                if 'importers' in command:
                    return 0, '[]'
                return (124, output) if 'scripts/vitest-push.config.ts' in command else (0, '')
            self.assertEqual(LIVE['check'](self.root, self.base, tip, time.monotonic() + 45, runner)['ok'], expected)

    def test_prefix_upload_keeps_red_suffix_main_and_index(self):
        good = self.commit('src/good.ts')
        bad = self.commit('src/bad.ts')
        tip = self.commit('src/later.ts')
        index = (self.root / '.git/index').read_bytes()
        remote = self.root / 'tmp/remote.git'
        subprocess.run(['git', 'init', '--bare', '-q', str(remote)], check=True)
        self.git('remote', 'add', 'origin', str(remote))
        self.git('push', '-q', 'origin', self.base + ':refs/heads/main')
        notices = []

        def checker(root, base, candidate, deadline):
            return {'ok': candidate == good, 'phase': 'lint', 'files': ['src/bad.ts'], 'output': 'bad',
                    'steps': [{'step': 'fast-lint', 'seconds': 0.01,
                               'status': 'passed' if candidate == good else 'failed'}]}

        def notify(*args):
            self.assertEqual(self.git('rev-parse', 'origin/main'), good)
            log = (self.root / 'tmp/push-loop/current.log').read_text()
            self.assertEqual(log.splitlines()[0], 'bad')
            detail = json.loads(log.splitlines()[-1])
            self.assertEqual(detail['bad'], bad)
            self.assertEqual(detail['tip'], good)
            notices.append(args)
            return True

        result = PUSH['tick'](self.root, checker=checker, notify=notify)
        self.assertEqual(result['status'], 'pushed')
        self.assertEqual(result['tip'], good)
        self.assertEqual(result['bad'], bad)
        self.assertEqual(self.git('rev-parse', 'origin/main'), good)
        self.assertEqual(self.git('rev-parse', 'main'), tip)
        self.assertEqual((self.root / '.git/index').read_bytes(), index)
        self.assertEqual(len(notices), 1)
        checks = [row for row in result['steps'] if row['step'] == 'fast-lint']
        self.assertEqual([(row['candidate'], row['status']) for row in checks], [(tip, 'failed'), (good, 'passed')])
        self.assertGreaterEqual(result['uploadSeconds'], 0)

    def test_unknown_live_refusal_pings_only_on_third_repeat(self):
        self.commit('src/good.ts')
        notices = []
        checker = lambda *_: {'ok': False, 'phase': 'working-tree', 'files': [], 'output': 'live edit'}
        notify = lambda *args: notices.append(args) or True
        for _ in range(4):
            self.assertEqual(PUSH['tick'](self.root, checker=checker, uploader=lambda *_: 0, notify=notify)['status'], 'pushed')
        self.assertEqual(len(notices), 1)

    def test_snapshot_names_do_not_reset_the_same_refusal(self):
        first = '/repo/tmp/push-source-abcd_01/src/client/app/entry.ts: refusal in 8.2s'
        second = '/repo/tmp/push-source-other-02/src/client/app/entry.ts: refusal in 9.3s'
        self.assertEqual(PUSH['refusal_signature'](first), PUSH['refusal_signature'](second))
        self.assertNotEqual(PUSH['refusal_signature'](first), PUSH['refusal_signature'](first.replace('entry.ts', 'other.ts')))
        self.assertEqual(LIVE['failure_paths']('file:///repo/tmp/push-source-abcd/src/client/app/entry.ts:2:1'), ['src/client/app/entry.ts'])
        # A lock-only commit can be attributed, and refused, only if the lock itself is named.
        self.assertEqual(LIVE['failure_paths']('pnpm-lock.yaml: row, package.json: pins, src/game/package.json: pin'),
                         ['package.json', 'pnpm-lock.yaml', 'src/game/package.json'])

    def test_source_type_cache_binds_contents_and_inventory(self):
        records = [b'100644 blob aaa\tsrc/author.ts', b'100644 blob bbb\tsrc/data.json']
        key = CACHE['source_key'](records, ['src'])
        self.assertEqual(key, CACHE['source_key']([*records, b'100644 blob ccc\tdocs/note.md'], ['src']))
        self.assertNotEqual(key, CACHE['source_key']([b'100644 blob ddd\tsrc/author.ts', records[1]], ['src']))
        self.assertNotEqual(key, CACHE['source_key']([*records, b'100644 blob eee\tsrc/new.ts'], ['src']))


    def test_deferred_types_stay_in_ci_even_with_generated_cache(self):
        tip = self.commit('src/good.ts')
        blob = self.git('rev-parse', tip + ':src/good.ts')
        self.put('.git/push-deferred-types.json', json.dumps({'src/good.ts': [blob]}))
        self.put('.push-types.json', '{"available":true}')
        @contextmanager
        def prepared(*_):
            yield self.root / 'scripts'
        calls = []
        with patch.dict(PUSH, fast_tools=prepared), patch.dict(LIVE, run=lambda *args: calls.append(args[0]) or (0, '')):
            result = PUSH['check_committed'](self.root, self.base, tip, time.monotonic() + 45)
        self.assertTrue(result['ok'])
        self.assertEqual(result['types'], 'ci')
        self.assertEqual([command[5] for command in calls], ['storage', 'ratchet', 'guards', 'fast-lint', 'census'])
        self.assertFalse(any('oxlint' in command or 'vitest' in command for command in calls))

    def test_policy_guards_refuse_before_ratchet_or_upload(self):
        tip = self.commit('lint/ratchet.json')
        self.put('lint/ratchet.json', 'foreign WIP')
        @contextmanager
        def prepared(*_):
            yield self.root / 'scripts'
        calls = []
        def runner(command, *_):
            calls.append(command[5])
            return (1, 'lint/ratchet.json:1:1 error: CLOSED C9 has custom lines') if command[5] == 'guards' else (0, '')
        with patch.dict(PUSH, fast_tools=prepared), patch.dict(LIVE, run=runner):
            result = PUSH['check_committed'](self.root, self.base, tip, time.monotonic() + 45)
        self.assertFalse(result['ok'])
        self.assertEqual(result['phase'], 'guards')
        self.assertEqual(calls, ['storage', 'ratchet', 'guards'])
        self.assertEqual(next(row for row in result['steps'] if row['step']=='ratchet')['status'], 'passed')
        self.assertEqual(next(row for row in result['steps'] if row['step']=='fast-lint')['reason'], 'prior-refusal')

    def test_ratchet_deferral_preserves_a_refusal_at_the_budget(self):
        def runner(command, *_):
            return (124, 'Ratchet rose:\ncustom debt') if command[1].endswith('ratchet.mjs') else (0, '')
        result = LIVE['check'](self.root, self.base, self.base, time.monotonic() + 45,
                              runner=runner, files=[], policy_checks=True)
        self.assertFalse(result['ok'])
        self.assertEqual(result['phase'], 'ratchet')

    def test_each_budget_defers_but_real_refusals_stay_red(self):
        self.git('rm', 'src/base.ts')
        tip = self.commit('src/good.ts')
        @contextmanager
        def prepared(*_):
            yield self.root / 'scripts'
        phases = ['storage', 'deleted-paths', 'ratchet', 'guards', 'fast-lint', 'census']
        for phase in phases:
            for code, text in [(124, 'pre-push budget exhausted'), (1, 'src/good.ts:1:1 error: observed policy refusal')]:
                calls = []
                def runner(command, *_):
                    calls.append(command[5])
                    return (code, text) if command[5] == phase else (0, '')
                with patch.dict(PUSH, fast_tools=prepared), patch.dict(LIVE, run=runner):
                    result = PUSH['check_committed'](self.root, self.base, tip, time.monotonic() + 45)
                self.assertEqual(result['ok'], code == 124, (phase, text))
                self.assertEqual(calls, phases[:phases.index(phase)+1])
                rows = {row['step']:row for row in result['steps']}
                self.assertEqual(result['phase'], phase)
                self.assertEqual(rows[phase]['status'], 'failed')
                if code == 124:
                    self.assertEqual(rows[phase]['reason'], 'budget')
                for completed in phases[:phases.index(phase)]:
                    self.assertEqual(rows[completed]['status'], 'passed')

    def test_missing_discovery_prevents_a_partial_cache_from_enabling_types(self):
        self.put('src/shards/fixture/world/build.ts', "import manifest from '../discovery.generated';\nexport const seed = manifest.seed;\n")
        missing = SOURCE['missing_generated'](self.root)
        self.assertEqual(missing, ['src/shards/fixture/discovery.generated'])
        self.put('src/shards/fixture/discovery.generated.ts', 'export default {seed: 42};\n')
        self.assertEqual(SOURCE['missing_generated'](self.root), [])

    def test_generation_phase_cache_rejects_changed_inputs_and_corrupt_outputs(self):
        tip = self.git('rev-parse', 'HEAD')
        records = [row for row in subprocess.check_output(['git', 'ls-tree', '-rz', tip], cwd=self.root).split(b'\0') if row]
        generated = self.root / 'completed/tree'
        generated.mkdir(parents=True)
        (generated.parent / 'HEAD').write_text(tip)
        source = self.git('show', tip + ':src/base.ts') + '\n'
        output = b'{"value":1}'
        digest = hashlib.sha256(output).hexdigest()
        saved = {'schema': 'generation-phase/1', 'root': str(generated), 'identity': '0' * 64,
                 'inputs': {'src/base.ts': hashlib.sha256(source.encode()).hexdigest()},
                 'trees': {'src': ['src/base.ts']}, 'outputs': {'src/value.generated.json': digest}}
        discovery = b'export default {seed:42};\n'
        saved['inputs']['src/shards/fixture/discovery.generated.ts'] = hashlib.sha256(discovery).hexdigest()
        phase = generated / '.cache/generation-phase.json'
        phase.parent.mkdir()
        encoded = json.dumps(saved, ensure_ascii=False, separators=(',', ':'))
        phase.write_text(json.dumps({**saved, 'seal': hashlib.sha256(encoded.encode()).hexdigest()}))
        (generated / 'src').mkdir()
        (generated / 'src/value.generated.json').write_bytes(output)
        discovery_path = generated / 'src/shards/fixture/discovery.generated.ts'
        discovery_path.parent.mkdir(parents=True)
        discovery_path.write_bytes(discovery)
        self.assertEqual(CACHE['publish'](self.root, tip, generated), 2)
        target = self.root / 'checked'
        target.mkdir()
        self.assertTrue(CACHE['restore'](self.root, target, records, time.monotonic() + 5))
        self.assertEqual((target / 'src/value.generated.json').read_bytes(), output)
        self.assertEqual((target / 'src/shards/fixture/discovery.generated.ts').read_bytes(), discovery)
        self.assertFalse(CACHE['restore'](self.root, target, [*records, b'100644 blob new\tsrc/new.ts'], time.monotonic() + 5))
        (self.root / 'tmp/push-input-cache/blobs' / digest).write_text('corrupt')
        clean = self.root / 'another-check'
        clean.mkdir()
        self.assertFalse(CACHE['restore'](self.root, clean, records, time.monotonic() + 5))
        saved['inputs']['src/base.ts'] = 'f' * 64
        encoded = json.dumps(saved, ensure_ascii=False, separators=(',', ':'))
        phase.write_text(json.dumps({**saved, 'seal': hashlib.sha256(encoded.encode()).hexdigest()}))
        with self.assertRaisesRegex(ValueError, 'source differs'):
            CACHE['publish'](self.root, tip, generated)

    def test_missing_generated_test_inputs_defer_without_repeating_typed_lint(self):
        tip = self.commit('src/good.ts')
        commands = []
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45,
                               lambda *args: commands.append(args) or (0, ''), types_available=False)
        self.assertTrue(result['ok'])
        self.assertEqual(result['types'], 'pre-commit')
        self.assertIn('related tests defer', result['output'])
        self.assertEqual(len(commands), 2)
        self.assertEqual(commands[0][0], ['node', str(self.root / 'scripts/lint-fast.mjs')])
        self.assertIn('scripts/vitest-push-guards.config.ts', commands[1][0])

    def test_prior_verified_inputs_enable_tests_but_never_typed_lint(self):
        tip = self.commit('src/good.ts')
        commands = []
        def runner(command, *_):
            commands.append(command)
            return 0, '["test/unit.test.ts"]' if '--live' in command else ''
        result = LIVE['check'](self.root, self.base, tip, time.monotonic() + 45,
                               runner=runner, types_available=False, tests_available=True, test_revision=self.base)
        self.assertTrue(result['ok'])
        self.assertEqual([command[0] for command in commands], ['node', 'pnpm', 'node', 'pnpm'])
        self.assertIn('previous generation; not current type proof', result['output'])
        self.assertIn('Typed importers require exact', result['output'])

    def test_shared_budget_reaches_importer_lint_and_reports_unfinished_files(self):
        tip = self.commit('src/good.ts')
        clock = [100.0]
        commands = []
        def runner(command, root, deadline, env):
            self.assertEqual(deadline, 145)
            self.assertLess(clock[0], deadline)
            commands.append(command)
            if 'scripts/vitest-push-guards.config.ts' in command:
                clock[0] += 7
            elif '--live' in command:
                clock[0] += 3
                return 0, '["test/unit.test.ts"]'
            elif 'scripts/vitest-push.config.ts' in command:
                clock[0] += 20
            elif 'importers' in command:
                clock[0] += 1
                return 0, '["src/good.ts", "src/importer.ts"]'
            elif 'oxlint' in command:
                clock[0] = deadline
                return 124, 'unfinished typed check'
            return 0, ''
        with patch.object(time, 'monotonic', side_effect=lambda: clock[0]):
            result = LIVE['check'](self.root, self.base, tip, 145, runner=runner)
        self.assertTrue(result['ok'])
        self.assertEqual(clock[0], 145)
        self.assertIn('CI owns: src/good.ts, src/importer.ts', result['output'])
        self.assertIn('oxlint', commands[-1])


    def test_recent_phase_precedes_related_and_does_not_repeat_successes(self):
        self.put('test/recent.test.ts','export {}')
        tip=self.commit('src/new.ts')
        calls=[]
        def runner(command, *_):
            calls.append(command)
            if '--recent-only' in command:
                return 0,'["test/recent.test.ts"]'
            if any('gate-related-tests.mjs' in value for value in command):
                return 0,'["test/recent.test.ts","test/related.test.ts"]'
            return 0,'[]'
        result=LIVE['check'](self.root,self.base,tip,time.monotonic()+45,runner=runner,recent_tests=['test/recent.test.ts'])
        self.assertTrue(result['ok'],result)
        tests=[command for command in calls if command[:4]==['pnpm','exec','vitest','run']]
        self.assertIn('test/recent.test.ts',tests[1]);self.assertNotIn('test/related.test.ts',tests[1])
        self.assertIn('test/related.test.ts',tests[2]);self.assertNotIn('test/recent.test.ts',tests[2])

    def test_recent_failure_blocks_before_related_and_refuses_path_drift(self):
        self.put('test/recent.test.ts','export {}');tip=self.commit('src/new.ts')
        for drift in (False,True):
            calls=[]
            def runner(command,*_):
                calls.append(command)
                if '--recent-only' in command:
                    return 0,'["test/foreign.test.ts"]' if drift else '["test/recent.test.ts"]'
                if 'test/recent.test.ts' in command:
                    return 1,'FAIL test/recent.test.ts > actual'
                return 0,'[]'
            result=LIVE['check'](self.root,self.base,tip,time.monotonic()+45,runner=runner,recent_tests=['test/recent.test.ts'])
            self.assertFalse(result['ok']);self.assertEqual(result['phase'],'recent-selection' if drift else 'recent-tests')
            self.assertEqual(sum(any('gate-related-tests.mjs' in value for value in command) for command in calls),1)


class RuntimeCopies(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tmp').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='runtime-copies-')
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.tree = self.repo / 'candidate'
        self.tree.mkdir()
        self.package = self.repo / 'node_modules/@fixture/native'
        self.package.mkdir(parents=True)
        self.data = b'\x00asm-real-installed-payload'
        (self.package / 'native.wasm').write_bytes(self.data)
        (self.package / 'package.json').write_text('{"name":"@fixture/native","version":"1.0.0"}')
        (self.tree / 'package.json').write_text('{"dependencies":{"@fixture/native":"1.0.0"}}')
        self.row = dict(source='node_modules/@fixture/native/native.wasm', target='public/native.wasm',
                        package='@fixture/native', version='1.0.0', bytes=len(self.data),
                        sha256=hashlib.sha256(self.data).hexdigest())

    def restore(self, rows=None):
        return RESTORE_RUNTIME(self.repo, self.tree, dict(version=1, copies=rows or [self.row]), time.monotonic() + 5)

    def test_installed_bytes_replace_no_working_asset(self):
        (self.repo / 'public').mkdir()
        (self.repo / 'public/native.wasm').write_bytes(b'untrusted working build')
        self.assertEqual(self.restore(), 1)
        self.assertEqual((self.tree / 'public/native.wasm').read_bytes(), self.data)
        self.assertEqual(self.restore(), 1)

    def test_corruption_and_candidate_version_fail_before_any_write(self):
        bad = {**self.row, 'target': 'public/bad.wasm', 'sha256': '0' * 64}
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.restore([self.row, bad])
        self.assertFalse((self.tree / 'public').exists())
        (self.tree / 'package.json').write_text('{"dependencies":{"@fixture/native":"2.0.0"}}')
        with self.assertRaisesRegex(ValueError, 'candidate dependency'):
            self.restore()

    def test_symlinks_traversal_duplicates_and_existing_mismatch_refuse(self):
        outside = self.repo / 'outside'; outside.mkdir()
        (self.tree / 'public').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.restore()
        (self.tree / 'public').unlink()
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.restore([{**self.row, 'target': 'public/../escaped'}])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.restore([self.row, self.row])
        (self.tree / 'public').mkdir(); (self.tree / 'public/native.wasm').write_bytes(b'other')
        with self.assertRaisesRegex(ValueError, 'Existing'):
            self.restore()


if __name__ == '__main__':
    unittest.main()
