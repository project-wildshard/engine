import importlib.util
import hashlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prebuilt', Path(__file__).with_name('prebuilt-output.py'))
prebuilt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prebuilt)
SHA = 'a' * 40


class PrebuiltTests(unittest.TestCase):
    def setUp(self):
        Path('tmp').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir='tmp')
        self.root = Path(self.temporary.name)
        self.source, self.target, self.packet = [self.root / name for name in ('source', 'target', 'packet')]
        self.target.mkdir()
        version = json.dumps({'build': SHA[:9] + '-fixture'})
        # OFF-VERCEL OV3: the archive is dist/, the Workers asset directory: no .vercel, no functions.
        self.files = {
            'dist/index.html': '<html>actual shell</html>',
            'dist/sw.js': 'const BUILD="fixture";',
            'dist/version.json': version,
            'dist/_headers': '/sw.js\n  Cache-Control: no-cache\n',
            'dist/.vite/chunk-modules.json': '{"chunks":[]}',
            'dist/assets/main.js': 'export {};',
            'dist/assets/main.js.map': '{"private":true}',
        }
        for name, body in self.files.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body)
        prebuilt.pack(self.source, self.packet, SHA, '123')

    def tearDown(self):
        self.temporary.cleanup()

    def proof(self, change):
        path = self.packet / 'proof.json'
        value = json.loads(path.read_text())
        change(value)
        path.write_text(json.dumps(value))

    def test_complete_page_and_private_maps_restore_exactly(self):
        prebuilt.restore(self.target, self.packet, SHA, '123')
        self.assertEqual({p.relative_to(self.target).as_posix(): p.read_text()
                          for p in self.target.rglob('*') if p.is_file()}, self.files)

    def test_report_only_clocks_split_real_restore_and_keep_exact_bytes(self):
        output = io.StringIO()
        with patch.object(prebuilt.time, 'monotonic', side_effect=[10, 12, 15, 20, 21]), \
                patch.dict(os.environ, {'PREBUILT_DOWNLOAD_MODE': 'gh-run-download',
                                        'PREBUILT_DOWNLOAD_SECONDS': '73'}), \
                patch('sys.stdout', output):
            prebuilt.restore(self.target, self.packet, SHA, '123', timings=True)
        proof = json.loads((self.packet / 'proof.json').read_text())
        receipt, timing = map(json.loads, output.getvalue().splitlines())
        self.assertEqual(receipt['archiveHash'], proof['archiveHash'])
        self.assertEqual((timing['downloadSeconds'], timing['transportCheckSeconds'],
                          timing['decodeSeconds'], timing['extractSeconds'], timing['restoreSeconds']),
                         (73, 2, 3, 5, 11))
        self.assertEqual(timing['compressedBytes'], (self.packet / 'prebuilt.tar.zst').stat().st_size)
        self.assertEqual(timing['archiveBytes'], len(subprocess.check_output(
            ['zstd', '-q', '-dc', str(self.packet / 'prebuilt.tar.zst')])))
        self.assertEqual(timing['memberBytes'], sum(row['bytes'] for row in proof['files']))
        self.assertTrue(timing['complete'])
        self.assertEqual({p.relative_to(self.target).as_posix(): p.read_text()
                          for p in self.target.rglob('*') if p.is_file()}, self.files)

    def test_absent_backward_or_broken_clocks_cannot_claim_elapsed_time(self):
        for name, clocks in [('backward', [10, 9, 8, 7, 6]),
                             ('unavailable', OSError('clock unavailable'))]:
            output = io.StringIO()
            with patch.object(prebuilt.time, 'monotonic', side_effect=clocks), \
                    patch.dict(os.environ, {'PREBUILT_DOWNLOAD_MODE': 'provided',
                                            'PREBUILT_DOWNLOAD_SECONDS': 'untrusted'}), \
                    patch('sys.stdout', output):
                prebuilt.restore(self.root / name, self.packet, SHA, '123', timings=True)
            row = json.loads(output.getvalue().splitlines()[-1])
            self.assertTrue(row['complete'])
            for field in ('downloadSeconds', 'transportCheckSeconds', 'decodeSeconds',
                          'extractSeconds', 'restoreSeconds'):
                self.assertIsNone(row[field])

    def test_failed_diagnostic_sink_preserves_success_and_original_refusal(self):
        original_print = print
        def sink(value):
            if json.loads(value).get('report') == 'ci2-prebuilt-restore':
                raise OSError('diagnostic output unavailable')
            return original_print(value)
        with patch('builtins.print', sink):
            self.assertIsNone(prebuilt.restore(self.target, self.packet, SHA, '123', timings=True))
            with self.assertRaisesRegex(ValueError, 'source SHA/run'):
                prebuilt.restore(self.root / 'foreign', self.packet, 'b' * 40, '123', timings=True)
        self.assertFalse((self.root / 'foreign').exists())

    def workflow_restore(self, mode='download', failure='0'):
        workflow = Path('.github/workflows/deploy.yml').read_text()
        step = workflow.split('      - name: Restore the exact successful push artifact\n', 1)[1]
        script = re.search(r'        run: \|\n((?:          .*\n|\n)+)', step).group(1)
        script = '\n'.join(line[10:] if line.startswith('          ') else line
                           for line in script.splitlines())
        runner = self.root / ('runner with spaces ' + mode + failure)
        runner.mkdir()
        binary = runner / 'bin'
        binary.mkdir()
        controller = runner / 'controller'
        controller.mkdir()
        for name in ('prebuilt-output.py', 'staged-deployment.py'):
            shutil.copyfile(Path('scripts') / name, controller / name)
        gh = binary / 'gh'
        gh.write_text('#!' + shutil.which('python3') + '\n' +
            'import json,os,pathlib,shutil,sys\n' +
            'log=pathlib.Path("download-call.json")\n' +
            'calls=json.loads(log.read_text()) if log.exists() else []\n' +
            'calls.append(sys.argv[1:]);log.write_text(json.dumps(calls))\n' +
            'code=int(os.environ["DOWNLOAD_EXIT"])\n' +
            'if code: sys.exit(code)\n' +
            'shutil.copytree(os.environ["FIXTURE_PACKET"],sys.argv[sys.argv.index("--dir")+1])\n')
        gh.chmod(0o755)
        npm = binary / 'npm'
        npm.write_text('#!' + shutil.which('python3') + '\n' +
            'import json,pathlib,sys\n' +
            'log=pathlib.Path("install-call.json")\n' +
            'calls=json.loads(log.read_text()) if log.exists() else []\n' +
            'calls.append(sys.argv[1:]);log.write_text(json.dumps(calls))\n' +
            'pathlib.Path("npm-called").touch()\n')
        npm.chmod(0o755)
        env = {**os.environ, 'PATH': str(binary.resolve()) + os.pathsep + os.environ['PATH'],
               'SOURCE_RUN': '123', 'SOURCE_ATTEMPT': '1', 'DEPLOY_SHA': SHA, 'GITHUB_REPOSITORY': 'owner/repo',
               'PREBUILT_ARCHIVE': str(self.packet.resolve()) if mode == 'provided' else '',
               'RUNNER_TEMP': str(controller.resolve()), 'VERCEL_PROJECT_ID': 'prj_FIXTURE',
               'VERCEL_ORG_ID': 'team_FIXTURE', 'VERCEL_BUILD_TOKEN': '', 'FIXTURE_PACKET': str(self.packet.resolve()),
               'DOWNLOAD_EXIT': failure}
        binding = subprocess.run(['bash', '-e', '-c', 'command -v gh; command -v npm'],
                                 cwd=runner, env=env, capture_output=True, text=True)
        self.assertEqual(binding.returncode, 0, binding.stderr)
        self.assertEqual(binding.stdout.splitlines(), [str(gh.resolve()), str(npm.resolve())])
        result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script], cwd=runner,
                                env=env, capture_output=True, text=True)
        return result, runner

    def restore_report(self, result):
        reports = [json.loads(line) for line in result.stdout.splitlines()]
        restore = [row for row in reports if row.get('report') == 'ci2-prebuilt-restore']
        self.assertEqual(len(restore), 1, result.stdout)
        return restore[0]

    def assert_single_owned_install(self, runner):
        self.assertEqual(json.loads((runner / 'install-call.json').read_text()),
                         [['install', '--global', 'vercel@59.11.2']])

    def test_real_workflow_glue_downloads_once_and_reports_the_native_restore(self):
        result, runner = self.workflow_restore()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((runner / 'download-call.json').read_text()),
            [['run', 'download', '123', '--repo', 'owner/repo', '--name', 'vercel-prebuilt',
              '--dir', 'prebuilt-output']])
        row = self.restore_report(result)
        self.assertEqual(row['report'], 'ci2-prebuilt-restore')
        self.assertEqual(row['downloadMode'], 'gh-run-download')
        self.assertGreaterEqual(row['downloadSeconds'], 0)
        self.assertTrue(row['complete'])
        for name, body in self.files.items():
            self.assertEqual((runner / name).read_text(), body)
        self.assertTrue((runner / 'npm-called').exists())
        self.assert_single_owned_install(runner)

    def test_provided_archive_has_no_download_call_or_invented_network_seconds(self):
        result, runner = self.workflow_restore(mode='provided')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((runner / 'download-call.json').exists())
        row = self.restore_report(result)
        self.assertEqual(row['downloadMode'], 'provided')
        self.assertIsNone(row['downloadSeconds'])
        self.assertTrue(row['complete'])
        self.assert_single_owned_install(runner)

    def test_real_download_error_refuses_restore_and_preserves_native_code(self):
        result, runner = self.workflow_restore(failure='23')
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        self.assertEqual(len(json.loads((runner / 'download-call.json').read_text())), 1)
        self.assert_single_owned_install(runner)
        self.assertFalse((runner / '.vercel').exists())
        self.assertNotIn('ci2-prebuilt-restore', result.stdout)

    def test_stream_retains_the_original_tar_headers_order_and_padding(self):
        long_name = self.source / ('dist/assets/' + 'long-name-' * 14 + 'é.js.map')
        long_name.write_bytes(b'private source map with a PAX header')
        prebuilt.pack(self.source, self.packet, SHA, '123')
        proof = json.loads((self.packet / 'proof.json').read_text())
        expected = io.BytesIO()
        with tarfile.open(fileobj=expected, mode='w', dereference=False) as output:
            for row in proof['files']:
                path = self.source / row['path']
                info = output.gettarinfo(str(path.resolve()), arcname=row['path'])
                info.type, info.linkname, info.size = tarfile.REGTYPE, '', row['bytes']
                with path.open('rb') as content:
                    output.addfile(info, content)
        actual = subprocess.check_output(['zstd', '-q', '-dc', str(self.packet / 'prebuilt.tar.zst')])
        self.assertEqual(actual, expected.getvalue())
        self.assertEqual(proof['archiveBytes'], len(actual))
        self.assertEqual(proof['archiveHash'], hashlib.sha256(actual).hexdigest())
        self.assertFalse((self.packet / 'prebuilt.tar').exists())

    def test_failed_encoder_is_drained_and_cannot_leave_a_partial_transport(self):
        directory = self.root / 'failed-encoder'
        original = subprocess.Popen
        children = []

        def failed(*args, **kwargs):
            child = original(['sh', '-c', 'exit 23'], **kwargs)
            children.append(child)
            return child

        with patch.object(prebuilt.subprocess, 'Popen', failed):
            with self.assertRaises((BrokenPipeError, subprocess.CalledProcessError)):
                prebuilt.pack(self.source, directory, SHA, '123')
        self.assertTrue(children)
        self.assertTrue(all(child.poll() is not None for child in children))
        self.assertFalse((directory / 'prebuilt.tar.zst').exists())
        self.assertFalse((directory / 'prebuilt.tar').exists())
        self.assertFalse((directory / 'proof.json').exists())

    def test_links_are_materialized_and_a_link_row_never_restores(self):
        (self.source / 'dist/assets/alias.js').symlink_to('main.js')
        shared = self.root / 'shared'
        shared.mkdir()
        (shared / 'chunk.js').write_text('shared chunk')
        (self.source / 'dist/b').symlink_to(shared, target_is_directory=True)
        packet = self.root / 'links'
        prebuilt.pack(self.source, packet, SHA, '123')
        proof = json.loads((packet / 'proof.json').read_text())
        self.assertFalse(any('link' in row for row in proof['files']))
        prebuilt.restore(self.target, packet, SHA, '123')
        self.assertFalse((self.target / 'dist/assets/alias.js').is_symlink())
        self.assertEqual((self.target / 'dist/assets/alias.js').read_text(), 'export {};')
        self.assertEqual((self.target / 'dist/b/chunk.js').read_text(), 'shared chunk')
        name, target = 'dist/assets/escape.js', '../../../outside'
        member = tarfile.TarInfo(name)
        member.type, member.linkname, member.mode = tarfile.SYMTYPE, target, 0o777
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as output:
            output.addfile(member)
        archive.seek(0)
        rows = {'files': [{'path': name, 'link': target, 'bytes': len(target), 'mode': member.mode,
                           'hash': hashlib.sha256(target.encode()).hexdigest()}], 'run': '123'}
        empty = self.root / 'empty'
        empty.mkdir()
        with self.assertRaisesRegex(ValueError, 'Invalid prebuilt member'):
            prebuilt.extract(empty, archive, rows, SHA)
        self.assertEqual(list(empty.iterdir()), [])

    def test_only_dist_is_a_prebuilt_root(self):
        for name in ('.vercel/output/static/index.html', 'functions/api/errors.js', 'dist/../x'):
            with self.assertRaises(ValueError):
                prebuilt.safe(name)

    def test_the_page_files_a_worker_serves_are_required(self):
        for name in ('dist/index.html', 'dist/sw.js', 'dist/_headers', 'dist/.vite/chunk-modules.json'):
            path = self.source / name
            body = path.read_bytes()
            path.unlink()
            with self.assertRaisesRegex(ValueError, 'Incomplete prebuilt output: ' + re.escape(name)):
                prebuilt.pack(self.source, self.root / 'incomplete', SHA, '123')
            path.write_bytes(body)

    def test_workers_asset_limits_refuse_the_pack(self):
        big = self.source / 'dist/assets/huge.bin'
        with big.open('wb') as stream:
            stream.truncate(prebuilt.MAX_ASSET_BYTES + 1)
        with self.assertRaisesRegex(ValueError, 'over 25 MiB: dist/assets/huge.bin'):
            prebuilt.pack(self.source, self.root / 'huge', SHA, '123')
        big.unlink()
        # A private source map is never uploaded, so its size does not count.
        with (self.source / 'dist/assets/huge.js.map').open('wb') as stream:
            stream.truncate(prebuilt.MAX_ASSET_BYTES + 1)
        prebuilt.pack(self.source, self.root / 'big-map', SHA, '123')
        rows = [{'path': f'dist/f{i}', 'bytes': 1} for i in range(prebuilt.MAX_ASSET_FILES - 4)]
        with self.assertRaisesRegex(ValueError, 'over 90000'):
            prebuilt.required(json.loads((self.packet / 'proof.json').read_text())['files'] + rows, SHA, self.source)

    def test_a_release_build_named_by_its_full_sha_binds_the_source(self):
        (self.source / 'dist/version.json').write_text(json.dumps({'build': SHA}))
        prebuilt.pack(self.source, self.root / 'release', SHA, '123')
        with self.assertRaisesRegex(ValueError, 'version differs'):
            prebuilt.pack(self.source, self.root / 'foreign-release', 'b' * 40, '123')

    def test_emitted_seven_character_env_stamp_and_git_abbreviation_both_bind_the_full_source(self):
        for width in (7, 9):
            version = json.dumps({'build': SHA[:width] + '-fixture'})
            (self.source / 'dist/version.json').write_text(version)
            packet = self.root / ('stamp-' + str(width))
            target = self.root / ('restored-' + str(width))
            target.mkdir()
            prebuilt.pack(self.source, packet, SHA, '123')
            prebuilt.restore(target, packet, SHA, '123')
            self.assertEqual((target / 'dist/version.json').read_text(), version)
            with self.assertRaisesRegex(ValueError, 'source SHA/run'):
                prebuilt.restore(self.root / 'foreign', packet, SHA[:7] + 'b' * 33, '123')

    def test_wrong_source_or_producer_refuses_before_writes(self):
        for sha, run in [('b' * 40, '123'), (SHA, '124')]:
            with self.assertRaisesRegex(ValueError, 'source SHA/run'):
                prebuilt.restore(self.target, self.packet, sha, run)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_truncated_transport_refuses_before_writes(self):
        path = self.packet / 'prebuilt.tar.zst'
        path.write_bytes(path.read_bytes()[:-1])
        with self.assertRaisesRegex(ValueError, 'transport checksum'):
            prebuilt.restore(self.target, self.packet, SHA, '123')
        self.assertEqual(list(self.target.iterdir()), [])

    def test_wrong_member_hash_and_missing_or_duplicate_inventory_refuse(self):
        original = (self.packet / 'proof.json').read_text()
        for change in (lambda p: p['files'][0].update(hash='0' * 64),
                       lambda p: p['files'].pop(),
                       lambda p: p['files'].append(p['files'][0])):
            self.proof(change)
            with self.assertRaises(ValueError):
                prebuilt.restore(self.target, self.packet, SHA, '123')
            self.assertEqual(list(self.target.iterdir()), [])
            (self.packet / 'proof.json').write_text(original)

    def test_destination_symlink_is_never_followed(self):
        (self.target / 'dist').symlink_to(self.source / 'dist', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'destination'):
            prebuilt.restore(self.target, self.packet, SHA, '123')
        self.assertEqual((self.source / 'dist/index.html').read_text(), self.files['dist/index.html'])

    def test_version_must_belong_to_tested_source(self):
        (self.source / 'dist/version.json').write_text('{"build":"wrong"}')
        with self.assertRaisesRegex(ValueError, 'version differs'):
            prebuilt.pack(self.source, self.root / 'bad', SHA, '123')


if __name__ == '__main__':
    unittest.main()
