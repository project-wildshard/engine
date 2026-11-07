"""Exercise the real packaging entry with isolated, observable tool processes."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = Path(sys.argv.pop()).resolve()


class ReleasePacks(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(dir=Path.cwd() / 'tmp', prefix='release-packs-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        for folder in ['scripts', 'bin', 'dist']:
            (self.root / folder).mkdir()
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / 'source.txt').write_text('exact source fixture')
        subprocess.run(['git', '-C', str(self.root), 'add', 'source.txt'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Fixture',
                        '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture'], check=True)
        self.sha = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD'], text=True).strip()
        self.env = {**os.environ, 'PATH': str(self.root / 'bin') + os.pathsep + os.environ['PATH'],
                    'GITHUB_SHA': self.sha, 'GITHUB_RUN_ID': '123'}
        for key in ['VERCEL_BUILD_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID']:
            self.env.pop(key, None)
        self.put('scripts/boot-dist-plan.mjs', 'console.log(JSON.stringify({plan:"exact"}));')
        self.put('scripts/boot-dist.py', '''import json,sys,os,urllib.request
from pathlib import Path
assert json.loads(Path('boot-dist-plan.json').read_text()) == {'plan':'exact'}
assert sys.argv[1:] == ['pack','--sha',os.environ['GITHUB_SHA'],'--run','123']
Path('boot-start').touch()
if 'BARRIER' in os.environ: urllib.request.urlopen(os.environ['BARRIER']+'/boot',timeout=3).read()
if os.environ.get('FAIL_BOOT_LATE'): raise SystemExit(25)
if os.environ.get('FAIL_BOOT'): raise SystemExit(23)
Path('boot-done').touch()
print('original boot pack')
''')
        self.put('scripts/build-vercel-output.mjs', '''import{existsSync,writeFileSync}from'node:fs';
if(!existsSync('pull-done'))throw Error('packaging raced Vercel setup');
if(process.env.BOOT_BUILD_BARRIER)await fetch(process.env.BARRIER+'/vercel-build');
writeFileSync('vercel-built','exact dist');console.log('original Vercel build');''')
        self.put('scripts/prebuilt-output.py', '''import os,sys
from pathlib import Path
assert sys.argv[1:] == ['pack','--sha',os.environ['GITHUB_SHA'],'--run','123']
assert Path('vercel-built').read_text() == 'exact dist'
Path('prebuilt-done').touch()
print('original prebuilt pack')
''')
        self.put('bin/npm', '''#!/usr/bin/env python3
import os,sys,urllib.request
from pathlib import Path
assert sys.argv[1:] == ['install','--global','vercel@59.11.2']
Path('npm-start').touch()
count=Path('npm-count');count.write_text(str(int(count.read_text())+1 if count.exists() else 1))
if 'BARRIER' in os.environ and not os.environ.get('BOOT_BUILD_BARRIER'): urllib.request.urlopen(os.environ['BARRIER']+'/npm',timeout=3).read()
if os.environ.get('FAIL_NPM'): raise SystemExit(24)
if os.environ.get('WAIT_NPM'):
 import time
 time.sleep(2)
Path('npm-done').touch()
Path('cli-version').write_text(os.environ.get('INSTALLED_CLI_VERSION','59.11.2'))
''', executable=True)
        self.put('bin/vercel', '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
if sys.argv[1:] == ['--version']:
 print(Path('cli-version').read_text() if Path('cli-version').exists() else 'missing')
 raise SystemExit(0 if Path('cli-version').exists() else 1)
assert sys.argv[1:] == ['pull','--yes','--environment','production','--scope','raynos-projects','--token',os.environ['VERCEL_BUILD_TOKEN']]
assert json.loads(Path('.vercel/project.json').read_text()) == {'projectId':'fixture-project','orgId':'fixture-org'}
Path('pull-done').touch()
''', executable=True)

    def put(self, name, text, executable=False):
        path = self.root / name
        path.write_text(text)
        if executable:
            path.chmod(0o755)

    def credentials(self):
        self.env.update(VERCEL_BUILD_TOKEN='fixture-token',
                        VERCEL_PROJECT_ID='fixture-project', VERCEL_ORG_ID='fixture-org')

    def barrier(self):
        arrived = set()
        condition = threading.Condition()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                with condition:
                    arrived.add(self.path)
                    condition.notify_all()
                    ready = condition.wait_for(lambda: len(arrived) == 2, timeout=3)
                self.send_response(200 if ready else 500)
                self.end_headers()
                self.wfile.write(b'paired' if ready else b'not concurrent')

            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.env['BARRIER'] = f'http://127.0.0.1:{server.server_port}'
        return arrived

    def run_pack(self, *args):
        result = subprocess.run(['node', str(SCRIPT), '--sha', self.sha, '--run', '123', *args],
                                cwd=self.root, env=self.env, capture_output=True, text=True, timeout=12)
        self.assertNotIn('fixture-token', result.stdout + result.stderr)
        return result

    def test_early_install_needs_no_credentials_and_final_pack_reuses_it(self):
        receipt = str(self.root / 'ready.txt')
        result = self.run_pack('--install-cli', '--cli-ready', receipt)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / 'boot-start').exists())
        self.assertFalse((self.root / 'pull-done').exists())
        self.assertEqual(Path(receipt).read_text(), self.sha+'\n123\nvercel@59.11.2\n')
        self.credentials()
        result = self.run_pack('--vercel', '--cli-ready', receipt)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'npm-count').read_text(), '1')
        self.assertTrue((self.root / 'prebuilt-done').exists())

    def test_unqualified_receipt_or_cli_keeps_original_install(self):
        self.credentials()
        for state in ['missing', 'foreign-source', 'foreign-run', 'foreign-version', 'wrong-installed-cli', 'linked', 'oversize']:
            with self.subTest(state=state):
                receipt = self.root / 'ready.txt'
                receipt.unlink(missing_ok=True)
                (self.root / 'npm-count').unlink(missing_ok=True)
                (self.root / 'cli-version').write_text('59.11.2')
                if state != 'missing':
                    receipt.write_text(('0'*40 if state == 'foreign-source' else self.sha)+'\n'
                                      +('999' if state == 'foreign-run' else '123')+'\nvercel@'
                                      +('58.0.0' if state == 'foreign-version' else '59.11.2')+'\n')
                if state == 'linked':
                    receipt.unlink(); target = self.root / 'linked-target.txt'
                    target.write_text(self.sha+'\n123\nvercel@59.11.2\n'); receipt.symlink_to(target)
                if state == 'oversize': receipt.write_text('x'*257)
                if state == 'wrong-installed-cli':
                    (self.root / 'cli-version').write_text('58.0.0')
                result = self.run_pack('--vercel', '--cli-ready', str(receipt))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((self.root / 'npm-count').read_text(), '1')
                self.assertTrue((self.root / 'prebuilt-done').exists())

    def test_failed_or_wrong_early_install_never_admits_a_receipt(self):
        for state in ['failure', 'wrong-version']:
            with self.subTest(state=state):
                receipt = self.root / 'ready.txt'
                receipt.unlink(missing_ok=True)
                self.env.pop('FAIL_NPM', None)
                self.env.pop('INSTALLED_CLI_VERSION', None)
                self.env.update({'FAIL_NPM':'1'} if state == 'failure' else {'INSTALLED_CLI_VERSION':'58.0.0'})
                result = self.run_pack('--install-cli', '--cli-ready', str(receipt))
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(receipt.exists())
                self.assertFalse((self.root / 'boot-start').exists())

    def test_pr_needs_no_credentials_and_runs_only_the_original_boot_pack(self):
        result = self.run_pack()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'boot-done').exists())
        self.assertFalse((self.root / 'npm-start').exists())
        self.assertFalse((self.root / '.vercel').exists())
        self.assertFalse((self.root / 'prebuilt-done').exists())

    def test_requested_vercel_is_mandatory_and_follows_both_concurrent_prerequisites(self):
        self.credentials()
        arrived = self.barrier()
        result = self.run_pack('--vercel')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(arrived, {'/boot', '/npm'})
        self.assertTrue((self.root / 'prebuilt-done').exists())

    def test_vercel_build_can_finish_setup_while_the_independent_boot_pack_waits(self):
        self.credentials()
        arrived = self.barrier()
        self.env['BOOT_BUILD_BARRIER'] = '1'
        result = self.run_pack('--vercel')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(arrived, {'/boot', '/vercel-build'})
        self.assertTrue((self.root / 'boot-done').exists())
        self.assertTrue((self.root / 'prebuilt-done').exists())

    def test_late_boot_refusal_still_fails_the_whole_concurrent_producer(self):
        self.credentials()
        arrived = self.barrier()
        self.env.update(BOOT_BUILD_BARRIER='1', FAIL_BOOT_LATE='1')
        result = self.run_pack('--vercel')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(arrived, {'/boot', '/vercel-build'})
        self.assertFalse((self.root / 'boot-done').exists())

    def test_missing_credentials_and_foreign_identity_refuse_before_work(self):
        result = self.run_pack('--vercel')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires deployment credentials', result.stderr)
        self.assertFalse((self.root / 'boot-start').exists())
        self.env['GITHUB_RUN_ID'] = 'other'
        result = self.run_pack()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('differs from the checkout or CI run', result.stderr)
        self.assertFalse((self.root / 'boot-start').exists())

    def test_boot_failure_drains_setup_and_never_packages_vercel(self):
        self.credentials()
        self.barrier()
        self.env.update(FAIL_BOOT='1', WAIT_NPM='1')
        result = self.run_pack('--vercel')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.root / 'npm-start').exists())
        self.assertFalse((self.root / 'npm-done').exists())
        self.assertFalse((self.root / 'prebuilt-done').exists())

    def test_setup_failure_cannot_publish_a_vercel_package(self):
        self.credentials()
        self.barrier()
        self.env['FAIL_NPM'] = '1'
        result = self.run_pack('--vercel')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'prebuilt-done').exists())


unittest.main()
