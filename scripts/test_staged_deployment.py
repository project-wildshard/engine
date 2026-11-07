import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest

HELPER = Path(os.environ.get('STAGE_HELPER', Path(__file__).with_name('staged-deployment.py'))).resolve()
spec = importlib.util.spec_from_file_location('staged_deployment_controls', HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = 'a' * 40
URL = 'https://wildshard-singleplayer-abc123-raynos-projects.vercel.app'


@contextlib.contextmanager
def environment(values):
    old = {key: os.environ.get(key) for key in values}
    try:
        for key, value in values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class ProtectedStage(unittest.TestCase):
    def setUp(self):
        self.original = Path.cwd()
        self.root = Path(tempfile.mkdtemp(prefix='stage-control-', dir=self.original / 'tmp')).resolve()
        self.addCleanup(shutil.rmtree, self.root)
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.original)
        for folder in ('dist/.vite', '.vercel/output/static', 'prebuilt-output'):
            Path(folder).mkdir(parents=True)
        self.build = SHA[:7] + '-immutable'
        version = json.dumps({'build': self.build, 'time': 'original'})
        Path('dist/version.json').write_text(version)
        Path('.vercel/output/static/version.json').write_text(version)
        Path('dist/.vite/chunk-modules.json').write_text('{"original":true}')
        Path('dist/core.js.map').write_text('{"sources":["original.ts"]}')
        Path('prebuilt-output/proof.json').write_text(json.dumps({'sha': SHA, 'run': '123', 'archiveHash': 'b' * 64}))
        self.args = SimpleNamespace(sha=SHA, run='123', attempt='1', project='prj_OWNED', team='team_OWNED',
                                    token='fixture-only', proof='prebuilt-output/proof.json')
        self.inventory = module.map_inventory()
        self.receipt = {'version': 1, 'sha': SHA, 'run': '123', 'attempt': '1',
                        'deployment': 'dpl_EXACT',
                        'url': URL, 'build': self.build, 'archiveHash': 'b' * 64,
                        'privateMapPath': '/core.js.map',
                        'probes': [{'path': '/', 'status': 302, 'challenge': 'vercel-sso'},
                                   {'path': '/core.js.map', 'status': 401, 'challenge': 'http-auth'}],
                        'maps': dict(self.inventory, artifactId='987', artifactDigest='sha256:' + 'c' * 64)}
        self.record = {'id': 'dpl_EXACT', 'url': URL.removeprefix('https://'), 'projectId': 'prj_OWNED', 'ownerId': 'team_OWNED',
                       'target': 'production', 'readyState': 'READY', 'meta': {
                           'ciStageSha': SHA, 'ciStageRun': '123', 'ciStageAttempt': '1',
                           'ciStageBuild': self.build, 'ciStageArchive': 'b' * 64,
                           'ciStageMaps': self.inventory['manifestHash']}}
        self.artifact = {'id': 987, 'name': 'production-source-maps-' + SHA, 'expired': False,
                         'size_in_bytes': 456, 'digest': 'sha256:' + 'c' * 64,
                         'workflow_run': {'id': 123, 'head_sha': SHA, 'head_branch': 'main'}}
        self.stage_jobs = {'total_count': 1, 'jobs': [{'name': 'stage-prebuilt', 'run_id': 123, 'run_attempt': 1,
                                                     'head_sha': SHA, 'status': 'completed', 'conclusion': 'success'}]}

    def test_only_exact_auth_challenges_are_allowed(self):
        for code, location in [(401, None), (403, None), (302, 'https://vercel.com/sso-api?nonce=owned')]:
            self.assertTrue(module.protected_status(code, location))
        for code, location in [(200, None), (404, None), (301, 'https://vercel.com/sso-api'), (307, 'https://vercel.com/sso-api'),
                               (302, None), (302, '/sso-api'), (302, 'http://vercel.com/sso-api'),
                               (302, 'https://vercel.com.evil.test/sso-api'), (302, 'https://evil@vercel.com/sso-api'),
                               (302, 'https://vercel.com:443/sso-api'), (302, 'https://vercel.com/other'),
                               (302, 'https://[broken')]:
            with self.subTest(code=code, location=location):
                self.assertFalse(module.protected_status(code, location))

    def test_url_never_accepts_arbitrary_hosts_paths_or_credentials(self):
        self.assertEqual(module.unique_url(URL), URL)
        for value in ['http://example.vercel.app', 'https://vercel.app', 'https://example.vercel.app.evil.test',
                      'https://user@example.vercel.app', 'https://example.vercel.app:443', URL + '?x=1', URL + '/path']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.unique_url(value)

    def test_staged_build_keeps_original_variable_length_sha_abbreviations(self):
        for size in [7, 8, 12, 40]:
            self.assertTrue(module.build_matches(SHA[:size] + '-original', SHA))
        for value in ['aaaaaa-short', SHA[:39] + 'b-original', 'aaaaaaa-', 'wrong-original', None]:
            self.assertFalse(module.build_matches(value, SHA))

    def test_final_receipt_rejects_missing_foreign_or_unbounded_identities(self):
        self.assertEqual(module.receipt_value(json.dumps(self.receipt), SHA, '123', '1', 'prj_OWNED', 'team_OWNED'), self.receipt)
        for key, value in [('sha', 'd' * 40), ('run', '124'), ('attempt', '2'), ('project', 'prj_FOREIGN'),
                           ('team', 'team_FOREIGN'), ('deployment', URL), ('url', 'https://evil.test'),
                           ('archiveHash', 'short'), ('build', 'bbbbbbb-other'), ('probes', []),
                           ('probes', [0, None]), ('version', True)]:
            candidate = dict(self.receipt, **{key: value})
            with self.subTest(key=key), self.assertRaises((ValueError, TypeError, KeyError)):
                module.receipt_value(json.dumps(candidate), SHA, '123', '1', 'prj_OWNED', 'team_OWNED')
        for key in self.receipt['maps']:
            candidate = copy.deepcopy(self.receipt)
            candidate['maps'].pop(key)
            with self.subTest(missing=key), self.assertRaises(ValueError):
                module.receipt_value(json.dumps(candidate), SHA, '123', '1', 'prj_OWNED', 'team_OWNED')

    def test_exact_project_target_ready_source_and_map_digest_are_mandatory(self):
        module.admitted(self.record, self.receipt, self.args.project, self.args.team)
        for key, value in [('id', 'dpl_OTHER'), ('projectId', 'prj_OTHER'), ('ownerId', 'team_OTHER'), ('target', 'preview'),
                           ('readyState', 'BUILDING'), ('url', 'foreign.vercel.app')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.admitted(dict(self.record, **{key: value}), self.receipt, self.args.project, self.args.team)
        for key in self.record['meta']:
            record = copy.deepcopy(self.record)
            record['meta'][key] = 'foreign'
            with self.subTest(metadata=key), self.assertRaises(ValueError):
                module.admitted(record, self.receipt, self.args.project, self.args.team)

    def test_map_artifact_must_remain_finalized_existing_and_exact(self):
        module.admitted_artifact(self.artifact, self.receipt)
        for key, value in [('id', 988), ('name', 'foreign'), ('expired', True), ('size_in_bytes', 0),
                           ('digest', 'sha256:' + 'd' * 64), ('digest', None)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.admitted_artifact(dict(self.artifact, **{key: value}), self.receipt)
        for key, value in [('id', 124), ('head_sha', 'f' * 40), ('head_branch', 'other')]:
            record = copy.deepcopy(self.artifact)
            record['workflow_run'][key] = value
            with self.subTest(run=key), self.assertRaises(ValueError):
                module.admitted_artifact(record, self.receipt)

    def test_stage_is_prebuilt_skip_domain_and_never_promotes(self):
        calls = []
        def run(args):
            calls.append(args)
            if args[:2] == ['vercel', 'deploy']:
                return URL
            if args[:2] == ['vercel', 'inspect']:
                return json.dumps({'id': 'dpl_EXACT'})
            self.assertEqual(args, ['node', 'scripts/deploy-source-maps.mjs', '.vercel/output/static'])
            return ''
        output = self.root / 'output'
        with environment({'GITHUB_OUTPUT': str(output)}), contextlib.redirect_stdout(io.StringIO()):
            module.stage(self.args, run=run, read=lambda *_: self.record,
                         check=lambda _url, path: {'path': path, 'status': 401, 'challenge': 'http-auth'})
        self.assertEqual(calls[0][0], 'node')
        self.assertIn('--prebuilt', calls[1])
        self.assertIn('--target=production', calls[1])
        self.assertIn('--skip-domain', calls[1])
        self.assertFalse(any('promote' in call for call in calls))
        partial = json.loads(output.read_text().split('=', 1)[1])
        self.assertNotIn('project', partial)
        self.assertNotIn('team', partial)
        self.assertNotIn(self.args.project, output.read_text())
        self.assertNotIn(self.args.team, output.read_text())
        self.assertNotIn('artifactId', partial['maps'])
        with self.assertRaises(ValueError):
            module.receipt_value(json.dumps(partial), SHA, '123', '1', 'prj_OWNED', 'team_OWNED')
        output.unlink()
        with environment({'GITHUB_OUTPUT': str(output), 'STAGED_RECEIPT': json.dumps(partial),
                          'MAP_ARTIFACT_ID': '987', 'MAP_ARTIFACT_DIGEST': 'c' * 64}):
            module.complete(self.args, read_artifact=lambda _: self.artifact)
        finalized = module.receipt_value(output.read_text().split('=', 1)[1], SHA, '123', '1', 'prj_OWNED', 'team_OWNED')
        self.assertEqual(finalized['maps']['artifactId'], '987')

    def test_selection_rechecks_both_protected_paths_and_final_map_artifact(self):
        probes = []
        def check(url, path):
            self.assertEqual(url, URL)
            probes.append(path)
            return {'path': path, 'status': 302}
        with environment({'STAGED_RECEIPT': json.dumps(self.receipt), 'STAGE_RESULT': 'success'}):
            self.assertEqual(module.select(self.args, read=lambda *_: self.record, check=check,
                                           read_artifact=lambda _: self.artifact, read_stage=lambda _: self.stage_jobs), self.receipt)
            self.assertEqual(probes, ['/', '/core.js.map'])
            with self.assertRaises(ValueError):
                module.select(self.args, read=lambda *_: self.record, check=check,
                              read_artifact=lambda _: dict(self.artifact, expired=True), read_stage=lambda _: self.stage_jobs)

    def test_partial_map_mutation_cannot_complete_a_stage(self):
        partial = copy.deepcopy(self.receipt)
        partial['maps'] = self.inventory
        Path('dist/core.js.map').write_text('changed')
        with environment({'STAGED_RECEIPT': json.dumps(partial)}), self.assertRaises(ValueError):
            module.complete(self.args, read_artifact=lambda _: self.artifact)

    def test_real_unknown_receipt_selects_fallback_without_any_native_call(self):
        output = self.root / 'fallback-output'
        env = dict(os.environ, VERCEL_PROJECT_ID='prj_OWNED', VERCEL_ORG_ID='team_OWNED',
                   VERCEL_BUILD_TOKEN='fixture-only', STAGED_RECEIPT='', GITHUB_OUTPUT=str(output))
        result = subprocess.run([sys.executable, str(HELPER), 'select', '--sha', SHA, '--run', '123', '--attempt', '1'],
                                env=env, capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(output.read_text(), 'promote=false\n')

    def test_red_foreign_or_unadmitted_publisher_never_calls_promote(self):
        base = dict(os.environ, VERCEL_PROJECT_ID='prj_OWNED', VERCEL_ORG_ID='team_OWNED',
                    VERCEL_BUILD_TOKEN='fixture-only', STAGED_RECEIPT=json.dumps(self.receipt),
                    GITHUB_EVENT_NAME='push', GITHUB_REF='refs/heads/main', GITHUB_SHA=SHA,
                    GITHUB_RUN_ID='123', GITHUB_REPOSITORY=module.REPOSITORY, RELEASE_ALLOWED='true')
        base.update(STAGE_RESULT='success', STAGED_SELECTED='true')
        for key, value in [('RELEASE_ALLOWED', 'false'), ('GITHUB_EVENT_NAME', 'pull_request'),
                           ('GITHUB_REF', 'refs/heads/other'), ('GITHUB_SHA', 'f' * 40),
                           ('GITHUB_RUN_ID', '124'), ('GITHUB_REPOSITORY', 'foreign/repo'),
                           ('STAGE_RESULT', 'failure'), ('STAGED_SELECTED', 'false')]:
            result = subprocess.run([sys.executable, str(HELPER), 'promote', '--sha', SHA, '--run', '123', '--attempt', '1'],
                                    env=dict(base, **{key: value}), capture_output=True, text=True, timeout=2)
            self.assertEqual(result.returncode, 1, (key, result.stdout + result.stderr))
            self.assertIn('ValueError', result.stderr)

    def test_original_restore_and_pinned_install_overlap_with_native_failure_precedence(self):
        for download, restore, install in [(0, 0, 0), (23, 0, 1), (0, 75, 1), (0, 0, 23)]:
            calls, installed, downloading = [], threading.Event(), threading.Event()
            def run(args, **kwargs):
                calls.append(args)
                if args[0] == 'npm':
                    self.assertEqual(args, ['npm', 'install', '--global', 'vercel@59.11.2'])
                    installed.set()
                    self.assertTrue(downloading.wait(1), 'install must overlap download')
                    return SimpleNamespace(returncode=install)
                if args[0] == 'gh':
                    downloading.set()
                    self.assertTrue(installed.wait(1), 'download must overlap install')
                    self.assertEqual(args, ['gh', 'run', 'download', '123', '--repo', module.REPOSITORY,
                                            '--name', 'vercel-prebuilt', '--dir', 'prebuilt-output'])
                    return SimpleNamespace(returncode=download)
                self.assertEqual(args[2:], ['restore', '--sha', SHA, '--run', '123', '--directory', 'prebuilt-output', '--timings'])
                self.assertEqual(kwargs['env']['PREBUILT_DOWNLOAD_MODE'], 'gh-run-download')
                return SimpleNamespace(returncode=restore)
            with environment({'PREBUILT_ARCHIVE': '', 'GITHUB_REPOSITORY': module.REPOSITORY}), contextlib.redirect_stdout(io.StringIO()):
                if download or restore or install:
                    with self.assertRaises(module.NativeFailure) as raised:
                        module.restore_and_install(self.args, run=run)
                    self.assertEqual(raised.exception.code, download or restore or install)
                else:
                    module.restore_and_install(self.args, run=run)
            self.assertEqual(sum(call[0] == 'gh' for call in calls), 1)
            self.assertEqual(sum(call[0] == 'npm' for call in calls), 1)
            self.assertEqual(sum(call[0] == 'python3' for call in calls), 0 if download else 1)

    def test_provided_recovery_archive_is_always_strictly_restored_without_a_second_download(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            self.assertNotEqual(args[0], 'gh')
            if args[0] == 'python3':
                self.assertEqual(args[2:], ['restore', '--sha', SHA, '--run', '123', '--directory',
                                            'owned-recovery-archive', '--timings'])
                self.assertEqual(kwargs['env']['PREBUILT_DOWNLOAD_MODE'], 'provided')
            return SimpleNamespace(returncode=0)
        with environment({'PREBUILT_ARCHIVE': 'owned-recovery-archive'}), contextlib.redirect_stdout(io.StringIO()):
            module.restore_and_install(self.args, run=run)
        self.assertEqual(len(calls), 2)

    def test_actual_owned_promote_command_preserves_native_failure_without_fallback_or_retry(self):
        binary = self.root / 'bin'
        binary.mkdir()
        stub = binary / 'vercel'
        stub.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$OWNED_CALLS"\nexit 23\n')
        stub.chmod(0o755)
        path = str(binary) + ':/usr/bin:/bin'
        self.assertEqual(shutil.which('vercel', path=path), str(stub))
        calls = self.root / 'native-args'
        env = dict(os.environ, PATH=path, OWNED_CALLS=str(calls),
                   VERCEL_PROJECT_ID='prj_OWNED', VERCEL_ORG_ID='team_OWNED', VERCEL_BUILD_TOKEN='fixture-only',
                   STAGED_RECEIPT=json.dumps(self.receipt), GITHUB_EVENT_NAME='push', GITHUB_REF='refs/heads/main',
                   GITHUB_SHA=SHA, GITHUB_RUN_ID='123', GITHUB_REPOSITORY=module.REPOSITORY, RELEASE_ALLOWED='true')
        env.update(STAGE_RESULT='success', STAGED_SELECTED='true')
        result = subprocess.run([sys.executable, str(HELPER), 'promote', '--sha', SHA, '--run', '123', '--attempt', '1'],
                                env=env, capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        self.assertEqual(calls.read_text().splitlines(), ['promote', 'dpl_EXACT', '--yes', '--scope',
                                                         'raynos-projects', '--token', 'fixture-only'])
        self.assertNotIn('fixture-only', result.stdout + result.stderr)

    def test_passive_io_failure_cannot_replace_actual_native_error(self):
        class RefusedSink:
            def write(self, _value):
                raise OSError('Owned diagnostic sink refusal')
        with contextlib.redirect_stderr(RefusedSink()), self.assertRaises(module.NativeFailure) as raised:
            module.native([sys.executable, '-c', 'import sys;sys.stderr.write("owned error");sys.exit(23)'])
        self.assertEqual(raised.exception.code, 23)
        module.report('native result diagnostic', stream=RefusedSink())

    def test_failed_cancelled_or_skipped_stage_with_valid_receipt_always_uses_fallback(self):
        for result in ['failure', 'cancelled', 'skipped', 'in_progress', '']:
            def unreachable(*_args):
                self.fail('Non-successful stage may not inspect or select promotion')
            with environment({'STAGED_RECEIPT': json.dumps(self.receipt), 'STAGE_RESULT': result}), self.assertRaises(ValueError):
                module.select(self.args, read=unreachable, check=unreachable, read_artifact=unreachable)
            output = self.root / ('failed-stage-' + (result or 'empty'))
            env = dict(os.environ, VERCEL_PROJECT_ID='prj_OWNED', VERCEL_ORG_ID='team_OWNED',
                       VERCEL_BUILD_TOKEN='fixture-only', STAGED_RECEIPT=json.dumps(self.receipt),
                       STAGE_RESULT=result, GITHUB_OUTPUT=str(output))
            run = subprocess.run([sys.executable, str(HELPER), 'select', '--sha', SHA, '--run', '123', '--attempt', '1'],
                                 env=env, capture_output=True, text=True, timeout=2)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertEqual(output.read_text(), 'promote=false\n')

    def test_masked_needs_success_cannot_override_actual_failed_or_foreign_stage_job(self):
        variants = []
        for key, value in [('conclusion', 'failure'), ('conclusion', 'cancelled'), ('status', 'in_progress'),
                           ('run_id', 124), ('run_attempt', 2), ('head_sha', 'b' * 40)]:
            body = copy.deepcopy(self.stage_jobs)
            body['jobs'][0][key] = value
            variants.append(body)
        variants += [{'total_count': 0, 'jobs': []}, {'total_count': 2, 'jobs': self.stage_jobs['jobs']},
                     {'total_count': 2, 'jobs': self.stage_jobs['jobs'] * 2}]
        for body in variants:
            def unreachable(*_args):
                self.fail('A failed actual stage cannot reach deployment or promotion admission')
            with environment({'STAGED_RECEIPT': json.dumps(self.receipt), 'STAGE_RESULT': 'success'}), self.assertRaises(ValueError):
                module.select(self.args, read=unreachable, check=unreachable, read_artifact=unreachable,
                              read_stage=lambda _: body)


if __name__ == '__main__':
    unittest.main()
