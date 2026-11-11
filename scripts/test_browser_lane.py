"""Admission deadlines against isolated process/device fixtures; no browsers."""
import os
import fcntl
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import select
import signal

ROOT = Path(__file__).resolve().parent.parent


class BrowserAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='browser-admission-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.root / 'builds').mkdir()
        self.env = {**os.environ, 'HOME': str(self.root),
                    'PATH': f'{self.bin}:{os.environ["PATH"]}',
                    'SIM_LANE_DIR': str(self.root / 'sim'),
                    'SERVE_BUILD_DIR': str(self.root / 'builds'),
                    'SERVE_REG_DIR': str(self.root / 'servers'),
                    'BROWSER_LANES': '1', 'BROWSER_LANE_WAIT_SECONDS': '1'}
        # The timed saturation case repeatedly inventories the same holders.
        # Keep the exact responses without paying interpreter startup per scan.
        self.shell_command('ps', r"""printf '%s\n' \
    '100 00:01 bash scripts/browser-lane.sh _slot 0 marker 60 fixture' \
    '101 00:01 bash scripts/browser-lane.sh _slot 1 marker 60 fixture'
""")
        self.shell_command('pgrep', 'exit 1\n')
        self.shell_command('xcrun', "printf '%s\\n' '{\"devices\":{}}'\n")
        self.command('osascript', "raise RuntimeError('No app should be touched')\n")

    def command(self, name, code):
        path = self.bin / name
        path.write_text(f'#!{sys.executable}\n' + code)
        path.chmod(0o755)

    def shell_command(self, name, code):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + code)
        path.chmod(0o755)

    def lane(self, *args, **extra):
        return subprocess.run(['/bin/bash', str(ROOT / 'scripts/browser-lane.sh'), *args],
                              env={**self.env, **extra}, capture_output=True,
                              text=True, timeout=6, check=False)

    def processes(self, rows):
        self.command('ps', f"import sys\n"
                     f"if sys.argv[1:] == ['-Ao', 'pid=,ppid=,command=']: print({rows!r})\n"
                     "elif 'ppid=' in sys.argv: print('1')\n"
                     "elif 'etime=' in sys.argv: print('00:01')\n")

    def portable_environment(self):
        # This fake reports no processes. Avoid starting Python for every
        # empty ps scan while four real kernel-lease supervisors are held.
        self.shell_command('ps', 'exit 0\n')
        # Model a host without BSD lockf, while using real kernel flock locks.
        shell = self.root / 'bash-env'
        shell.write_text('''command() {
  if [ "$#" -eq 2 ] && [ "$1" = -v ] && [ "$2" = lockf ]; then return 1; fi
  builtin command "$@"
}
''')
        return {**self.env, 'BASH_ENV': str(shell), 'BROWSER_LANES': '4'}

    def owned_process(self, args, env):
        child = subprocess.Popen(args, env=env, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, start_new_session=True)
        def cleanup():
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.communicate(timeout=3)
        self.addCleanup(cleanup)
        return child

    def entered(self, child):
        self.assertTrue(select.select([child.stdout], [], [], 3)[0], 'owned child did not enter')
        self.assertEqual(child.stdout.readline().strip(), 'entered')

    def test_portable_slots_admit_four_exclude_a_fifth_and_release_for_reuse(self):
        env = self.portable_environment()
        command = [sys.executable, '-u', '-c', '''import os,sys
assert 'BROWSER_SLOT_LOCK_FD' not in os.environ
try: os.fstat(8)
except OSError: pass
else: raise RuntimeError('Browser inherited a slot lease')
print('entered',flush=True);sys.stdin.read(1);sys.exit(7)
''']
        children = []
        for _ in range(4):
            child = self.owned_process(['/bin/bash', str(ROOT/'scripts/browser-lane.sh'), '--max', '1', *command], env)
            children.append(child)
            self.entered(child)
        refused = subprocess.run(['/bin/bash', str(ROOT/'scripts/browser-lane.sh'),
                                  'touch', str(self.root/'fifth-entered')],
                                 env=env, capture_output=True, text=True, timeout=4, check=False)
        self.assertEqual(refused.returncode, 75, refused.stderr)
        self.assertFalse((self.root/'fifth-entered').exists())
        children[0].communicate(input='x', timeout=3)
        self.assertEqual(children[0].returncode, 7)
        replacement = self.owned_process(['/bin/bash', str(ROOT/'scripts/browser-lane.sh'), '--max', '1', *command], env)
        self.entered(replacement)
        for child in [*children[1:], replacement]:
            child.communicate(input='x', timeout=3)
            self.assertEqual(child.returncode, 7)

    def test_portable_kernel_lease_is_nonblocking_and_follows_child_exit(self):
        lock = self.root/'native-slot.lock'
        helper = [sys.executable, str(ROOT/'scripts/browser-slot-lock.py'), str(lock)]
        with lock.open('a+') as owned:
            fcntl.flock(owned, fcntl.LOCK_EX | fcntl.LOCK_NB)
            refused = subprocess.run([*helper, 'touch', str(self.root/'locked-child')],
                                     capture_output=True, text=True, timeout=2, check=False)
            self.assertEqual(refused.returncode, 75, refused.stderr)
            self.assertFalse((self.root/'locked-child').exists())
        child = self.owned_process([*helper, sys.executable, '-u', '-c',
                                    "import sys;print('entered',flush=True);sys.stdin.read(1)"], self.env)
        self.entered(child)
        child.send_signal(signal.SIGTERM)
        # Keep stdin open until the forwarded signal ends the command. Closing
        # it in communicate() can instead let the blocked reader exit zero.
        child.wait(timeout=3)
        self.assertEqual(child.returncode, 128 + signal.SIGTERM)
        after = subprocess.run([*helper, sys.executable, '-c', 'raise SystemExit(9)'],
                               capture_output=True, text=True, timeout=2, check=False)
        self.assertEqual(after.returncode, 9, after.stderr)

    def test_broken_portable_lock_fails_without_waiting_or_starting_a_child(self):
        # TEST-SPEED TS11: "without waiting" is proved by the admission wait, not the wall clock. The wait is the
        # 300 s maximum, so a run that waited for a slot could never finish inside the 12 s bound, while a loaded
        # machine (bash, the lock helper and four kernel-lease probes starting slowly) still can.
        env = {**self.portable_environment(), 'BROWSER_LANE_WAIT_SECONDS': '300'}
        (self.root/'.browser-lane'/'slot-0.lock').mkdir(parents=True)
        result = subprocess.run(['/bin/bash', str(ROOT/'scripts/browser-lane.sh'),
                                 'touch', str(self.root/'broken-child')],
                                env=env, capture_output=True, text=True, timeout=12, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('slot lock failed', result.stderr)
        self.assertFalse((self.root/'broken-child').exists())

    def test_supervisor_death_does_not_release_a_live_commands_kernel_lease(self):
        lock, pid = self.root/'surviving-slot.lock', self.root/'command.pid'
        helper = [sys.executable, str(ROOT/'scripts/browser-slot-lock.py'), str(lock)]
        command = ('import os,pathlib,sys;'
                   f'pathlib.Path({str(pid)!r}).write_text(str(os.getpid()));'
                   "print('entered',flush=True);sys.stdin.read(1)")
        child = self.owned_process([*helper, sys.executable, '-u', '-c', command], self.env)
        self.entered(child)
        child.kill()
        child.wait(timeout=2)
        os.kill(int(pid.read_text()), 0)
        refused = subprocess.run([*helper, 'touch', str(self.root/'early-release')],
                                 capture_output=True, text=True, timeout=2, check=False)
        self.assertEqual(refused.returncode, 75, refused.stderr)
        self.assertFalse((self.root/'early-release').exists())
        child.communicate(input='x', timeout=3)
        after = subprocess.run([*helper, sys.executable, '-c', 'raise SystemExit(9)'],
                               capture_output=True, text=True, timeout=2, check=False)
        self.assertEqual(after.returncode, 9, after.stderr)

    def test_crashpad_framework_paths_are_not_browser_roots(self):
        bundle = '/Users/fixture/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/'
        browser = bundle + 'MacOS/Google Chrome for Testing'
        crashpad = bundle + 'Frameworks/Google Chrome for Testing Framework.framework/Versions/153/Helpers/chrome_crashpad_handler'
        self.processes('\n'.join([
            f'201 1 {browser} --remote-debugging-pipe',
            f'202 1 {crashpad} --monitor-self --annotation=prod=Google Chrome for Testing_Mac',
            f'203 1 {crashpad} --no-periodic-tasks',
            f'204 1 {browser} --type=renderer',
            f'205 1 /usr/bin/node launch.js {browser}',
        ]))
        self.assertEqual(self.lane('capacity', BROWSER_LANES='4').stdout, '4 3\n')
        self.assertEqual(self.lane('free', BROWSER_LANES='4').returncode, 0)

    def test_all_four_actual_browser_roots_still_fill_the_cap(self):
        self.processes('\n'.join([
            '301 1 /cache/ms-playwright/chromium-1/chrome-linux/chrome --headless',
            '302 1 /cache/ms-playwright/chromium-2/chrome-mac/Chromium.app/Contents/MacOS/Chromium --headless',
            '303 1 /cache/ms-playwright/chromium_headless_shell-3/chrome-linux/headless/chrome-headless-shell --headless',
            '304 1 /Users/fixture/.agent-browser/browsers/chrome-4/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --headless',
        ]))
        self.assertEqual(self.lane('capacity', BROWSER_LANES='4').stdout, '4 0\n')
        self.assertEqual(self.lane('free', BROWSER_LANES='4').returncode, 1)

    def test_wait_and_command_fail_without_running_child_when_full(self):
        for args in [('wait',), ('touch', str(self.root / 'child-ran'))]:
            started = time.monotonic()
            result = self.lane(*args)
            self.assertEqual(result.returncode, 75, result.stderr)
            self.assertIn('admission timed out after 1s', result.stderr)
            self.assertIn('holder 100', result.stderr)
            self.assertIn('holder 101', result.stderr)
            self.assertLess(time.monotonic() - started, 5)
            self.assertFalse((self.root / 'child-ran').exists())

    def test_immediate_capacity_succeeds_and_wait_limit_cannot_be_extended(self):
        self.command('ps', 'pass\n')
        self.assertEqual(self.lane('wait').returncode, 0)
        self.assertEqual(self.lane('wait', BROWSER_LANE_WAIT_SECONDS='301').returncode, 64)

    def test_admission_fixture_never_scans_shared_preview_outputs(self):
        self.command('ps', 'pass\n')
        # Record the reaper's scan root without listing or deleting anything.
        observed = self.root / 'scan-root'
        self.command('find', f"import pathlib, sys\npathlib.Path({str(observed)!r}).write_text(sys.argv[1])\n")
        result = self.lane('reap')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(observed.read_text()).resolve(), (self.root / 'builds').resolve())

    def test_reaper_preserves_build_output_during_registry_handoff(self):
        builds = self.root / 'builds'
        with tempfile.TemporaryDirectory(dir=builds, prefix='reaper-fixture-') as fixture:
            output = Path(fixture) / '20261025-120000-45001'
            output.mkdir()
            log = output / 'build.log'
            log.write_text('active build')
            registry = self.root / 'registry'
            registry.mkdir()
            with (registry / '.port-45001.lock').open('a+') as lease:
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = self.lane('reap', SERVE_BUILD_DIR=fixture, SERVE_REG_DIR=str(registry))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(log.exists(), 'active port lease must protect an output without its registry row')
            result = self.lane('reap', SERVE_BUILD_DIR=fixture, SERVE_REG_DIR=str(registry))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(output.exists(), 'an unleased orphan must still be cleaned')


if __name__ == '__main__':
    unittest.main()
