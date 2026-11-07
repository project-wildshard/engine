"""Bash 3 preview reservation and post-build port conflict regressions."""
import contextlib
import fcntl
import importlib.util
import io
import os
import json
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get('X15_TEST_ROOT', Path(__file__).resolve().parent.parent))
HELPER = ROOT / 'scripts/serve-port-lease.py'


class PortLeaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='serve-port-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.processes = []
        self.addCleanup(self.stop_processes)

    def stop_processes(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=5)

    def lease(self):
        channel = self.root / f'channel-{len(self.processes)}'
        channel.mkdir()
        for name in ('commands', 'replies'):
            os.mkfifo(channel / name)
        process = subprocess.Popen([sys.executable, str(HELPER), 'hold', str(self.root), str(channel), str(os.getpid())])
        self.processes.append(process)
        return channel, process

    def request(self, channel, *command):
        return subprocess.check_output([sys.executable, str(HELPER), 'request', str(channel), *command], text=True).strip()

    def test_lock_survives_registry_reaping_and_moves(self):
        first, process = self.lease()
        second, _ = self.lease()
        self.assertEqual(self.request(first, 'take', '4501'), 'ok')
        row = self.root / '4501'
        row.write_text('temporary registry row')
        row.unlink()
        self.assertEqual(self.request(second, 'take', '4501'), 'busy')
        self.assertEqual(self.request(first, 'take', '4502'), 'ok')
        self.assertEqual(self.request(second, 'take', '4501'), 'ok')
        self.assertEqual(self.request(first, 'close'), 'ok')
        process.wait(timeout=5)
        self.assertEqual(self.request(second, 'take', '4502'), 'ok')
        self.assertEqual(self.request(second, 'close'), 'ok')

    def test_owner_death_releases_lock(self):
        channel = self.root / 'orphan'
        channel.mkdir()
        for name in ('commands', 'replies'):
            os.mkfifo(channel / name)
        owner = subprocess.Popen([sys.executable, '-c',
            'import os,subprocess,sys,time; subprocess.Popen([sys.executable,sys.argv[1],"hold",sys.argv[2],sys.argv[3],str(os.getpid())]); time.sleep(30)',
            str(HELPER), str(self.root), str(channel)])
        self.processes.append(owner)
        self.assertEqual(self.request(channel, 'take', '4503'), 'ok')
        owner.terminate()
        owner.wait(timeout=5)
        deadline = time.monotonic() + 5
        while channel.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(channel.exists())
        next_channel, _ = self.lease()
        self.assertEqual(self.request(next_channel, 'take', '4503'), 'ok')
        self.assertEqual(self.request(next_channel, 'close'), 'ok')


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='serve-preview-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.groups = set()
        self.launches = []
        self.port_locks = []
        self.addCleanup(self.release_ports)
        self.addCleanup(self.stop_previews)
        (self.root / 'scripts').mkdir()
        (self.root / 'public').mkdir()
        source = Path(os.environ.get('X15_TEST_SCRIPT', ROOT / 'scripts/serve-build.sh'))
        shutil.copyfile(source, self.root / 'scripts/serve-build.sh')
        shutil.copyfile(HELPER, self.root / 'scripts/serve-port-lease.py')
        shutil.copyfile(os.environ.get('X15_TEST_SHARED', ROOT / 'scripts/serve-shared-preview.py'), self.root / 'scripts/serve-shared-preview.py')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / 'source').write_text('pinned fixture')
        subprocess.run(['git', '-C', str(self.root), 'add', 'source'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
        self.sha = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD'], text=True).strip()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        # Only generator/build work is stubbed. Bash, Node's detached spawn,
        # listener ownership, registry publication and HTTP readiness are real.
        self.command('python3', f'''#!{sys.executable}
import os,sys
if sys.argv[1].endswith('/heavy-lane.py'):
    os.execvp(sys.argv[4], sys.argv[4:])
os.execv({sys.executable!r}, [{sys.executable!r}, *sys.argv[1:]])
''')
        node = shutil.which('node')
        if node is None:
            self.fail('Node is required for the detached preview regression')
        self.command('node', f'''#!{sys.executable}
import os,sys
if sys.argv[1] in ('scripts/gen.mjs','scripts/build-shardfiles.mjs'):
    if os.environ.get('FIXTURE_SOURCE_ONLY') and sys.argv[1]=='scripts/gen.mjs':
        assert '--inputs-only' in sys.argv or '--proof' in sys.argv, 'duplicate product phase: '+str(sys.argv)
    if os.environ.get('SERVE_SHARED_SHA') and sys.argv[1]=='scripts/build-shardfiles.mjs':
        assert not any(arg.startswith('--shard') for arg in sys.argv), sys.argv
    sys.exit(0)
if sys.argv[1]=='scripts/build-app.mjs':
    os.execvp('pnpm',['pnpm','exec','vite','build',*sys.argv[2:]]) # the app build script wraps the fixture's build
if sys.argv[1].endswith('/preview-server.mjs'):
    import http.server,pathlib
    args=sys.argv[2:]
    port=int(args[args.index('--port')+1])
    out=args[args.index('--outDir')+1]
    root=pathlib.Path(os.environ['FIXTURE_ROOT'])
    with (root/'preview-pids').open('a') as f: f.write(str(os.getpid())+'\\n')
    os.chdir(out)
    try: server=http.server.HTTPServer(('127.0.0.1',port),http.server.SimpleHTTPRequestHandler)
    except OSError:
        print('preview-server: listen EADDRINUSE',flush=True); sys.exit(1)
    server.serve_forever()
if sys.argv[1].endswith('/build-mirror.mjs'):
    import pathlib,re
    if sys.argv[2]=='authorize':
        assert len(sys.argv)==4 and re.fullmatch('[0-9a-f]{{40}}',sys.argv[3]), sys.argv
        sys.exit(0) # Admission has no slot/reservation; the real guard has its own tests.
    root=pathlib.Path(os.environ['FIXTURE_ROOT'])
    rows=list((root/'registry').glob('[0-9]*'))
    assert len(rows)==1 and rows[0].read_text().split()[0]==str(os.getppid()), rows
    assert '--slot' not in sys.argv
    (root/'mirror-entered').touch()
    if os.environ.get('FIXTURE_MIRROR_FAIL'): sys.exit(124)
    command=sys.argv[sys.argv.index('--')+1:]
    os.execvp(command[0],command)
os.execv({node!r}, [{node!r}, *sys.argv[1:]])
''')
        self.command('pnpm', f'''#!{sys.executable}
import http.server,json,os,pathlib,re,sys,time
args=sys.argv[1:]
root=pathlib.Path(os.environ['FIXTURE_ROOT'])
if args[:3] == ['exec','vite','build']:
    config=pathlib.Path(args[args.index('--config')+1]).read_text()
    out=pathlib.Path(re.search(r"outDir: '([^']+)'",config)[1])
    out.mkdir(parents=True)
    (out/'index.html').write_text('finished dist')
    (out/'version.json').write_text(json.dumps({{'build':os.environ.get('SERVE_SHARED_SHA','working')[:7]+'-fixture'}}))
    with (root/'build-count').open('a') as f: f.write('build\\n')
    (root/'building').touch()
    while (root/'hold-build').exists(): time.sleep(0.02)
else:
    sys.exit('unexpected pnpm call: '+str(args))
''')
        self.env = {**os.environ, 'PATH': f'{self.bin}:{os.environ["PATH"]}',
            'FIXTURE_ROOT': str(self.root), 'SERVE_REG_DIR': str(self.root / 'registry'),
            'SERVE_BUILD_DIR': str(self.root / 'builds'), 'SERVE_OWNER': 'serve-port-test'}

    def command(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def stop_previews(self):
        for launch in self.launches:
            if launch.poll() is None:
                launch.terminate()
            launch.wait(timeout=5)
        pids = self.root / 'preview-pids'
        if pids.exists():
            self.groups.update(int(pid) for pid in pids.read_text().split())
        for group in self.groups:
            try:
                os.killpg(group, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def release_ports(self):
        for lock in self.port_locks:
            lock.close()

    def port(self):
        # Hold the probe-to-bind range across concurrently scheduled fixtures.
        # The real listeners still bind/check conflicts; no listener is mocked.
        leases = ROOT / 'tmp/serve-test-port-leases'
        leases.mkdir(parents=True, exist_ok=True)
        for port in range(19000, 29000, 5):
            sockets = []
            lock = (leases / str(port)).open('a+')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                for candidate in range(port, port + 3):
                    connection = socket.socket()
                    sockets.append(connection)
                    connection.bind(('127.0.0.1', candidate))
                self.port_locks.append(lock)
                return port
            except OSError:
                lock.close()
                continue
            finally:
                for connection in sockets:
                    connection.close()
        self.fail('No adjacent test ports')

    def launch(self, port, *extra, owner=None):
        process = subprocess.Popen(['/bin/bash', str(self.root / 'scripts/serve-build.sh'), '--port', str(port), *extra],
            env={**self.env, **({'SERVE_OWNER':owner} if owner else {})}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.launches.append(process)
        return process

    def finish(self, process):
        stdout, stderr = process.communicate(timeout=20)
        self.assertEqual(process.returncode, 0, stderr)
        match = re.search(r'http://127.0.0.1:(\d+)/', stdout)
        self.assertIsNotNone(match, stdout)
        port = int(match[1])
        row = (self.root / f'registry/{port}').read_text().split()
        self.groups.add(int(row[0]))
        self.assertNotEqual(int(row[0]), process.pid)
        self.assertEqual((Path(row[2]) / 'dist/index.html').read_text(), 'finished dist')
        return port, row, stderr

    def test_mac_bash_syntax(self):
        subprocess.run(['/bin/bash', '-n', str(self.root / 'scripts/serve-build.sh')], check=True)

    def shorten_admission_clock(self):
        script = self.root / 'scripts/serve-build.sh'
        source = script.read_text()
        self.assertIn('ROOM_WAIT_SECONDS=300', source)
        script.write_text(source.replace('ROOM_WAIT_SECONDS=300', 'ROOM_WAIT_SECONDS=1'))

    def test_full_preview_registry_times_out_before_mirror_admission(self):
        self.shorten_admission_clock()
        registry = self.root / 'registry'
        registry.mkdir()
        row = registry / '4400'
        foreign = f'{os.getpid()} {int(time.time()) + 3600} /fixture foreign-owner young-preview\n'
        row.write_text(foreign)
        self.env.update(SERVE_MAX_LIVE='1', SERVE_RECYCLE_MIN='999999')
        process = self.launch(self.port(), '--head')
        _, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 124, stderr)
        self.assertIn('timed out after 5 min waiting for preview room', stderr)
        self.assertIn('slot=preview:4400 pid=' + str(os.getpid()), stderr)
        self.assertFalse((self.root / 'mirror-entered').exists())
        self.assertFalse((self.root / 'build-count').exists())
        self.assertEqual(row.read_text(), foreign)
        self.assertEqual(list(registry.glob('.port-lease-*')), [])

    def test_registry_lock_timeout_preserves_foreign_lock_before_mirror(self):
        self.shorten_admission_clock()
        lock = self.root / 'registry/.lock'
        lock.mkdir(parents=True)
        owner = f'pid={os.getpid()} command=fixture start=now slot=preview-registry\n'
        (lock / 'owner').write_text(owner)
        process = self.launch(self.port(), '--head')
        _, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 124, stderr)
        self.assertIn('waiting for preview registry lock', stderr)
        self.assertIn(owner.strip(), stderr)
        self.assertEqual((lock / 'owner').read_text(), owner)
        self.assertFalse((self.root / 'mirror-entered').exists())

    def test_head_reserves_once_before_mirror_and_releases_parent_lease(self):
        _, row, _ = self.finish(self.launch(self.port(), '--head'))
        self.assertTrue((self.root / 'mirror-entered').exists())
        self.assertEqual(len(list((self.root / 'registry').glob('[0-9]*'))), 1)
        self.assertEqual(list((self.root / 'registry').glob('.port-lease-*')), [])
        self.assertNotIn('(building)', row[-1])

    def test_full_preview_prepares_inputs_before_its_single_explicit_product_phase(self):
        self.env['FIXTURE_SOURCE_ONLY'] = '1'
        self.finish(self.launch(self.port(), '--full'))

    def test_mirror_timeout_fails_once_and_releases_preview_reservation(self):
        self.env['FIXTURE_MIRROR_FAIL'] = '1'
        process = self.launch(self.port(), '--head')
        _, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 124, stderr)
        self.assertTrue((self.root / 'mirror-entered').exists())
        self.assertEqual(list((self.root / 'registry').glob('[0-9]*')), [])
        self.assertEqual(list((self.root / 'registry').glob('.port-lease-*')), [])

    def test_concurrent_starts_use_distinct_ports(self):
        port = self.port()
        first = self.launch(port)
        second = self.launch(port)
        first_port, _, _ = self.finish(first)
        second_port, _, _ = self.finish(second)
        self.assertNotEqual(first_port, second_port)
        self.assertEqual(len((self.root / 'build-count').read_text().splitlines()), 2)

    def test_pinned_lanes_share_one_build_and_release_only_their_use(self):
        port = self.port()
        first = self.launch(port, '--head', owner='lane-a')
        second = self.launch(port + 1, '--rev', self.sha, owner='lane-b')
        first_port, row, _ = self.finish(first)
        second_port, _, _ = self.finish(second)
        self.assertEqual(first_port, second_port)
        self.assertEqual((self.root / 'build-count').read_text().splitlines(), ['build'])
        subset_port, _, _ = self.finish(self.launch(port + 2, '--head', '--shard', 'fixture-a', owner='lane-b'))
        self.assertEqual(subset_port, first_port)
        state = json.loads((self.root / f'registry/.shared/{self.sha}.json').read_text())
        self.assertEqual(state['owners'], ['lane-a', 'lane-b'])
        def stop(owner, target):
            return subprocess.run(['/bin/bash', str(self.root / 'scripts/serve-build.sh'), 'stop', target],
                env={**self.env, 'SERVE_OWNER':owner}, capture_output=True, text=True, timeout=8)
        foreign = stop('lane-c', str(first_port))
        self.assertNotEqual(foreign.returncode, 0)
        self.assertTrue(os.kill(int(row[0]), 0) is None)
        released = stop('lane-a', 'all-mine')
        self.assertEqual(released.returncode, 0, released.stderr)
        self.assertIn('retained by lane-b', released.stdout)
        self.assertTrue((self.root / f'registry/{first_port}').exists())
        stopped = stop('lane-b', str(first_port))
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertFalse((self.root / f'registry/{first_port}').exists())
        self.assertFalse((self.root / f'registry/.shared/{self.sha}.json').exists())

    def test_failed_shared_build_is_not_retried_by_a_waiter(self):
        self.env['FIXTURE_MIRROR_FAIL'] = '1'
        first = self.launch(self.port(), '--head', owner='lane-a')
        first.communicate(timeout=5)
        self.assertEqual(first.returncode, 124)
        second = self.launch(self.port(), '--head', owner='lane-b')
        _, stderr = second.communicate(timeout=5)
        self.assertNotEqual(second.returncode, 0)
        self.assertIn('no automatic retry', stderr)
        self.assertFalse((self.root / 'build-count').exists())

    def test_pinned_reuse_covers_every_subset_and_refuses_wrong_mode_or_version(self):
        port, row, _ = self.finish(self.launch(self.port(), '--head', '--shard', 'fixture-a'))
        for extra in [('--shard', 'fixture-a'), ('--shard', 'fixture-b'), ()]:
            reused, _, _ = self.finish(self.launch(port + 1, '--head', *extra))
            self.assertEqual(reused, port)
        for extra in [('--devserver', '--shard', 'fixture-a')]:
            process = self.launch(port + 1, '--head', *extra)
            _, stderr = process.communicate(timeout=5)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn('incompatible mode/coverage', stderr)
        (Path(row[2]) / 'dist/version.json').write_text('{"build":"wrong-fixture"}')
        process = self.launch(port + 1, '--head', '--shard', 'fixture-a')
        _, stderr = process.communicate(timeout=5)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('does not match pinned SHA', stderr)
        self.assertEqual((self.root / 'build-count').read_text().splitlines(), ['build'])

    def test_shared_wait_cap_names_holder_and_never_builds_again(self):
        script = self.root / 'scripts/serve-shared-preview.py'
        script.write_text(script.read_text().replace('WAIT_SECONDS = 300', 'WAIT_SECONDS = 1'))
        (self.root / 'hold-build').touch()
        first = self.launch(self.port(), '--head', owner='lane-holder')
        deadline = time.monotonic() + 10
        while not (self.root / 'building').exists():
            if time.monotonic() > deadline: self.fail('Build fixture did not start')
            time.sleep(.02)
        second = self.launch(self.port() + 1, '--head', owner='lane-waiter')
        _, stderr = second.communicate(timeout=5)
        self.assertEqual(second.returncode, 124, stderr)
        for value in ('5 min', 'lane=lane-holder', 'slot=preview:' + self.sha, 'pid=', 'age=', 'start=', 'command='):
            self.assertIn(value, stderr)
        self.assertEqual((self.root / 'build-count').read_text().splitlines(), ['build'])
        (self.root / 'hold-build').unlink()
        self.finish(first)

    def test_shared_marker_protects_the_building_reservation(self):
        (self.root / 'hold-build').touch()
        process = self.launch(self.port(), '--head')
        deadline = time.monotonic() + 10
        while not (self.root / 'building').exists():
            if time.monotonic() > deadline: self.fail('Build fixture did not start')
            time.sleep(.02)
        row = next((self.root / 'registry').glob('[0-9]*')).read_text().split()
        self.assertEqual((Path(row[2]) / '.shared-preview').read_text().strip(), self.sha)
        self.assertFalse((Path(row[2]) / 'dist/version.json').exists() and process.poll() is not None)
        (self.root / 'hold-build').unlink()
        self.finish(process)

    def test_initial_busy_port_keeps_foreign_listener(self):
        port = self.port()
        with socket.socket() as occupier:
            occupier.bind(('127.0.0.1', port))
            occupier.listen()
            actual, _, _ = self.finish(self.launch(port))
            self.assertEqual(actual, port + 1)
            self.assertEqual(occupier.getsockname()[1], port)
        self.assertEqual((self.root / 'build-count').read_text(), 'build\n')

    def test_build_failure_releases_reservation(self):
        port = self.port()
        self.command('pnpm', '#!/bin/sh\nexit 1\n')
        process = self.launch(port)
        _, stderr = process.communicate(timeout=10)
        self.assertNotEqual(process.returncode, 0, stderr)
        self.assertEqual(list((self.root / 'registry').glob('[0-9]*')), [])
        self.assertEqual(list((self.root / 'registry').glob('.port-lease-*')), [])

    def test_post_build_conflict_reuses_finished_dist(self):
        port = self.port()
        hold = self.root / 'hold-build'
        hold.touch()
        process = self.launch(port)
        deadline = time.monotonic() + 10
        while not (self.root / 'building').exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue((self.root / 'building').exists())
        placeholder = (self.root / f'registry/{port}').read_text().split()
        with socket.socket() as occupier:
            occupier.bind(('127.0.0.1', port))
            occupier.listen()
            hold.unlink()
            actual, row, stderr = self.finish(process)
            self.assertEqual(actual, port + 1)
            self.assertEqual(row[2], placeholder[2])
            self.assertIn('reusing finished dist', stderr)
            self.assertFalse((self.root / f'registry/{port}').exists())
            self.assertEqual(occupier.getsockname()[1], port)
        self.assertEqual((self.root / 'build-count').read_text(), 'build\n')


class SharedReleaseTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('shared_preview', os.environ.get('X15_TEST_SHARED', ROOT / 'scripts/serve-shared-preview.py'))
        self.module = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='shared-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.registry = Path(self.temp.name)
        self.out = self.registry / 'out'; self.out.mkdir()
        self.port = '24001'; self.sha = 'a' * 40
        self.row = f'{os.getpid()} 9999999999 {self.out} lane-a fixture\n'
        (self.registry / self.port).write_text(self.row)
        (self.registry / '.shared').mkdir()
        self.path = self.registry / '.shared' / (self.sha + '.json')

    def shared(self):
        (self.out / '.shared-preview').write_text(self.sha)
        self.module.write(self.path, dict(status='ready', port=int(self.port), owners=['lane-a'],
            owner='lane-a', pid=os.getpid(), out=str(self.out), sha=self.sha, started=time.time()))

    def test_failure_forwards_both_streams_and_reprints_the_stderr_tail(self):
        stdout = io.StringIO(); stderr = io.StringIO()
        command = [sys.executable, '-c', 'import sys;print("source failure stdout");print("compiler diagnostic stderr",file=sys.stderr);sys.exit(7)']
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(self.module.run(self.registry, self.sha, 'production', 'lane-a', command), 7)
        self.assertIn('source failure stdout', stderr.getvalue())
        self.assertIn('compiler diagnostic stderr', stderr.getvalue())
        self.assertIn('child failed (7); stderr tail:', stderr.getvalue())
        self.assertEqual(self.module.read(self.path)['status'], 'failed')

    def test_stop_is_bound_to_the_row_bash_observed_even_for_the_same_lane(self):
        self.shared()
        with patch.dict(os.environ, {'SERVE_STOP_OBSERVED_PID': '12345', 'SERVE_STOP_OBSERVED_OUT': str(self.out)}), patch.object(self.module.subprocess, 'run') as child:
            self.assertEqual(self.module.release(self.registry, self.port, 'lane-a', False, ['unused']), 0)
            child.assert_not_called()
        self.assertEqual((self.registry / self.port).read_text(), self.row)
        self.assertTrue(self.path.exists())

    def test_reaper_preserves_replaced_rows_and_active_build_leases(self):
        with patch.object(self.module.subprocess, 'run') as child:
            self.assertEqual(self.module.reap_entry(self.registry, self.port, '12345', str(self.out), ['unused']), 0)
            with (self.registry / ('.port-' + self.port + '.lock')).open('a+') as lease:
                self.module.fcntl.flock(lease, self.module.fcntl.LOCK_EX)
                self.assertEqual(self.module.reap_entry(self.registry, self.port, str(os.getpid()), str(self.out), ['unused']), 0)
            child.assert_not_called()
        self.assertEqual((self.registry / self.port).read_text(), self.row)
        self.assertTrue(self.out.exists())

    def test_orphan_reaper_rechecks_registry_and_preserves_dry_run(self):
        output = self.registry / ('20261025-120000-' + self.port)
        output.mkdir()
        entry = self.registry / self.port
        entry.write_text(self.row.replace(str(self.out), str(output)))
        self.assertEqual(self.module.reap_output(self.registry, self.registry, str(output)), 0)
        self.assertTrue(output.exists())
        entry.unlink()
        self.assertEqual(self.module.reap_output(self.registry, self.registry, str(output), dry=True), 0)
        self.assertTrue(output.exists())
        self.assertEqual(self.module.reap_output(self.registry, self.registry, str(output)), 0)
        self.assertFalse(output.exists())

    def test_orphan_reaper_never_follows_an_output_symlink(self):
        output = self.registry / ('20261025-120000-' + self.port)
        output.symlink_to(self.out, target_is_directory=True)
        self.assertEqual(self.module.reap_output(self.registry, self.registry, str(output)), 0)
        self.assertTrue(output.is_symlink())
        self.assertTrue(self.out.exists())

    def test_orphan_reaper_matches_relative_and_absolute_registry_paths(self):
        output = self.registry / ('20261025-120000-' + self.port)
        output.mkdir()
        (self.registry / self.port).write_text(self.row.replace(str(self.out), str(output)))
        self.assertEqual(self.module.reap_output(self.registry, os.path.relpath(self.registry), os.path.relpath(output)), 0)
        self.assertTrue(output.exists())

    def test_official_reader_release_keeps_its_parent_preview(self):
        command = "import {compiledPreviewEnvironment} from './scripts/loading-benchmark/sim-shard.mjs'; process.stdout.write(compiledPreviewEnvironment({SERVE_OWNER:'lane-a'},123).SERVE_OWNER);"
        borrower = subprocess.check_output(['node', '--input-type=module', '-e', command], cwd=ROOT, text=True)
        self.assertNotEqual(borrower, 'lane-a')
        self.shared()
        state = self.module.read(self.path)
        state['owners'] = sorted({'lane-a', borrower})
        self.module.write(self.path, state)
        with patch.object(self.module.subprocess, 'run') as child:
            self.assertEqual(self.module.release(self.registry, self.port, borrower, False, ['unused']), 0)
            child.assert_not_called()
        self.assertEqual(self.module.read(self.path)['owners'], ['lane-a'])
        self.assertTrue((self.registry / self.port).exists())
        self.assertTrue(self.out.exists())

    def test_changed_shared_state_never_falls_back_to_legacy_teardown(self):
        self.shared()
        @contextlib.contextmanager
        def changed(_path):
            state = self.module.read(self.path); state['port'] = 24002
            self.module.write(self.path, state)
            yield
        with patch.object(self.module, 'lock', changed), patch.object(self.module.subprocess, 'run') as child:
            self.assertEqual(self.module.release(self.registry, self.port, 'lane-a', False, ['unused']), 0)
            child.assert_not_called()
        self.assertEqual((self.registry / self.port).read_text(), self.row)

    def test_missing_output_ignores_old_shared_records_for_the_same_port(self):
        stale = self.registry / '.shared' / ('b' * 40 + '.json')
        old = dict(status='ready', port=int(self.port), owners=['foreign-lane'],
            owner='foreign-lane', pid=12345, out=str(self.registry / 'old-output'))
        self.module.write(stale, old)
        self.shared()
        (self.out / '.shared-preview').unlink()
        self.out.rmdir()
        with patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as child:
            self.assertEqual(self.module.release(self.registry, self.port, 'lane-a', False, ['unused']), 0)
            child.assert_called_once()
            self.assertEqual(child.call_args.kwargs['env']['SERVE_STOP_PID'], str(os.getpid()))
            self.assertEqual(child.call_args.kwargs['env']['SERVE_STOP_OUT'], str(self.out))
        self.assertFalse(self.path.exists())
        self.assertEqual(self.module.read(stale), old)

    def test_stale_shared_port_without_matching_identity_refuses_teardown(self):
        self.shared()
        (self.out / '.shared-preview').unlink()
        state = self.module.read(self.path)
        state['pid'] = 12345
        self.module.write(self.path, state)
        with patch.object(self.module.subprocess, 'run') as child:
            with self.assertRaisesRegex(ValueError, 'No matching shared preview identity'):
                self.module.release(self.registry, self.port, 'lane-a', False, ['unused'])
            child.assert_not_called()
        self.assertEqual((self.registry / self.port).read_text(), self.row)
        self.assertEqual(self.module.read(self.path), state)

    def test_owned_ordinary_preview_releases_a_reused_shared_port(self):
        state = dict(status='ready', port=int(self.port), owners=['foreign-lane'],
            owner='foreign-lane', pid=12345, out=str(self.registry / 'old-output'))
        self.module.write(self.path, state)
        observed = {'SERVE_STOP_OBSERVED_PID': str(os.getpid()), 'SERVE_STOP_OBSERVED_OUT': str(self.out)}
        with patch.dict(os.environ, observed), patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as child:
            self.assertEqual(self.module.release(self.registry, self.port, 'lane-a', False, ['unused']), 0)
            child.assert_called_once()
        self.assertEqual(self.module.read(self.path), state)

    def test_reused_port_does_not_allow_a_foreign_ordinary_owner(self):
        state = dict(status='ready', port=int(self.port), owners=['old-lane'],
            owner='old-lane', pid=12345, out=str(self.registry / 'old-output'))
        self.module.write(self.path, state)
        observed = {'SERVE_STOP_OBSERVED_PID': str(os.getpid()), 'SERVE_STOP_OBSERVED_OUT': str(self.out)}
        with patch.dict(os.environ, observed), patch.object(self.module.subprocess, 'run') as child:
            with self.assertRaisesRegex(ValueError, 'No matching shared preview identity'):
                self.module.release(self.registry, self.port, 'foreign-lane', False, ['unused'])
            child.assert_not_called()
        self.assertEqual((self.registry / self.port).read_text(), self.row)

    def test_reused_port_with_a_partial_process_identity_still_refuses(self):
        state = dict(status='ready', port=int(self.port), owners=['lane-a'],
            owner='lane-a', pid=os.getpid(), out=str(self.registry / 'old-output'))
        self.module.write(self.path, state)
        observed = {'SERVE_STOP_OBSERVED_PID': str(os.getpid()), 'SERVE_STOP_OBSERVED_OUT': str(self.out)}
        with patch.dict(os.environ, observed), patch.object(self.module.subprocess, 'run') as child:
            with self.assertRaisesRegex(ValueError, 'No matching shared preview identity'):
                self.module.release(self.registry, self.port, 'lane-a', False, ['unused'])
            child.assert_not_called()
        self.assertEqual((self.registry / self.port).read_text(), self.row)

    def test_teardown_holds_port_lease_and_passes_exact_registry_identity(self):
        self.shared()
        def stopped(_command, **kwargs):
            self.assertEqual(kwargs['env']['SERVE_STOP_PID'], str(os.getpid()))
            self.assertEqual(kwargs['env']['SERVE_STOP_OUT'], str(self.out))
            with (self.registry / ('.port-' + self.port + '.lock')).open('a+') as lease:
                with self.assertRaises(BlockingIOError):
                    self.module.fcntl.flock(lease, self.module.fcntl.LOCK_EX | self.module.fcntl.LOCK_NB)
            return subprocess.CompletedProcess([], 0)
        with patch.object(self.module.subprocess, 'run', stopped):
            self.assertEqual(self.module.release(self.registry, self.port, 'lane-a', False, ['unused']), 0)
        self.assertFalse(self.path.exists())

    def test_busy_build_reservation_and_missing_shared_record_refuse_teardown(self):
        self.shared()
        with (self.registry / ('.port-' + self.port + '.lock')).open('a+') as lease:
            self.module.fcntl.flock(lease, self.module.fcntl.LOCK_EX)
            with patch.object(self.module.subprocess, 'run') as child:
                with self.assertRaisesRegex(ValueError, 'reservation still owns'):
                    self.module.release(self.registry, self.port, 'lane-a', False, ['unused'])
                child.assert_not_called()
        self.path.unlink()
        with self.assertRaisesRegex(ValueError, 'not ready for release'):
            self.module.release(self.registry, self.port, 'lane-a', False, ['unused'])

    def test_foreign_borrower_and_replaced_registry_cannot_stop_the_preview(self):
        self.shared()
        with patch.object(self.module.subprocess, 'run') as child:
            with self.assertRaisesRegex(ValueError, 'Caller lane-b.*borrowers=lane-a'):
                self.module.release(self.registry, self.port, 'lane-b', False, ['unused'])
            (self.registry / self.port).write_text(self.row.replace(str(os.getpid()), '12345', 1))
            with self.assertRaisesRegex(ValueError, 'replaced shared preview'):
                self.module.release(self.registry, self.port, 'lane-a', False, ['unused'])
            child.assert_not_called()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--partition':
        from test_partition import run_partition
        run_partition(sys.modules[__name__], sys.argv[2])
    unittest.main()
