"""G670 quiet admission and ownership, using private files and no Simulator."""
import fcntl
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
API = runpy.run_path(str(ROOT / 'scripts/sim-quiet.py'))


class SimQuietTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='sim-quiet-test-')
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.common = self.repo / '.git'
        self.common.mkdir()

    def info(self, script=None, cwd=None, parent=1):
        return {'args': ['node', str(script or self.repo / API['READER'])],
                'cwd': cwd or self.repo, 'parent': parent}

    def test_only_official_node_reader_is_eligible(self):
        function = API['official_simulator']
        for script in [self.repo / 'scripts/probe.mjs', self.repo / 'tmp/probe.mjs']:
            with patch.dict(function.__globals__, {'process_info': lambda pid: self.info(script)}):
                self.assertFalse(function(10, self.repo))
        with patch.dict(function.__globals__, {'process_info': lambda pid: self.info()}):
            self.assertTrue(function(10, self.repo))
            for pid in [None, True, 0, -1, '10']:
                self.assertFalse(function(pid, self.repo))

    def test_temporary_cwd_and_temporary_ancestor_refuse(self):
        function = API['official_simulator']
        with patch.dict(function.__globals__, {'process_info': lambda pid: self.info(cwd=self.repo / 'tmp')}):
            self.assertFalse(function(10, self.repo))
        def info(pid):
            return self.info(parent=11) if pid == 10 else self.info(script=self.repo / 'tmp/wrapper.mjs')
        with patch.dict(function.__globals__, {'process_info': info}):
            self.assertFalse(function(10, self.repo))

    def test_floor_quiet_requires_the_explicit_simulator_worker(self):
        function = API['official_simulator']
        flags = ['--worker', '--surface=sim', '--quiet']
        def info(selected):
            row = self.info(script=self.repo / API['FLOOR_READER'])
            row['args'].extend(selected)
            return row
        with patch.dict(function.__globals__, {'process_info': lambda pid: info(flags)}):
            self.assertTrue(function(10, self.repo, API['FLOOR_READER']))
            self.assertFalse(function(10, self.repo))
        for selected in [flags[:i] + flags[i+1:] for i in range(len(flags))] + [
                ['--worker', '--surface=desktop', '--quiet'], flags + ['--surface=desktop']]:
            with patch.dict(function.__globals__, {'process_info': lambda pid: info(selected)}):
                self.assertFalse(function(10, self.repo, API['FLOOR_READER']))

    def test_real_floor_worker_marker_uses_its_own_identity_and_expires(self):
        script = self.repo / API['FLOOR_READER']
        script.parent.mkdir(parents=True)
        script.write_text("setInterval(()=>{},1000);\n")
        with subprocess.Popen(['node', str(script), '--worker', '--surface=sim', '--quiet'], cwd=self.repo) as owner:
            try:
                API['take'](self.common, owner.pid, reader=API['FLOOR_READER'])
                marker = self.common / 'quiet'
                self.assertEqual(json.loads(marker.read_text())['script'], API['FLOOR_READER'])
                started = marker.stat().st_mtime
                self.assertTrue(API['quiet_marker_active'](marker, started + 599))
                self.assertFalse(API['quiet_marker_active'](marker, started + 600))
                API['release'](self.common, owner.pid + 1)
                self.assertTrue(marker.exists())
                API['release'](self.common, owner.pid)
                self.assertFalse(marker.exists())
            finally:
                owner.terminate()
                owner.wait(timeout=3)
    def test_forged_and_legacy_markers_never_hold_pushes(self):
        path = self.common / 'quiet'
        for marker in [{'owner':'fixture'}, {'pid':os.getpid()}, {'schema':1,'kind':'simulator-reading','script':API['READER'],'pid':os.getpid()},
                       {'schema':1,'kind':'simulator-reading','script':[API['FLOOR_READER']],'pid':os.getpid()}]:
            text = json.dumps(marker)
            path.write_text(text)
            self.assertFalse(API['quiet_marker_active'](path))
            self.assertEqual(path.read_text(), text)

    def test_official_marker_retains_the_ten_minute_cap(self):
        path = self.common / 'quiet'
        path.write_text(json.dumps({'schema':1,'kind':'simulator-reading','script':API['READER'],'pid':42}))
        started = path.stat().st_mtime
        with patch.dict(API['quiet_marker_active'].__globals__, {'official_simulator':lambda pid,repo:pid==42}):
            self.assertTrue(API['quiet_marker_active'](path, started+599))
            self.assertFalse(API['quiet_marker_active'](path, started+600))
            self.assertFalse(API['quiet_marker_active'](path, started-1))

    def test_take_waits_for_push_activity_and_timeout_never_publishes(self):
        path = self.common / 'quiet'
        with (self.common / 'push-loop.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.assertRaisesRegex(RuntimeError, 'do not retry'):
                API['take'](self.common, os.getpid(), timeout=0)
        self.assertFalse(path.exists())
        API['take'](self.common, os.getpid())
        self.assertEqual(json.loads(path.read_text())['pid'], os.getpid())
        with self.assertRaisesRegex(RuntimeError, 'live owner'):
            API['take'](self.common, os.getpid())
        API['release'](self.common, os.getpid()+1)
        self.assertTrue(path.exists())
        API['release'](self.common, os.getpid())
        self.assertFalse(path.exists())

    def test_real_official_node_pid_is_the_marker_authority(self):
        script = self.repo / API['READER']
        script.parent.mkdir(parents=True)
        script.write_text("setInterval(()=>{},1000);\n")
        with subprocess.Popen(['node',str(script)],cwd=self.repo) as owner:
            try:
                self.assertTrue(API['official_simulator'](owner.pid,self.repo))
                API['take'](self.common,owner.pid)
                self.assertTrue(API['quiet_marker_active'](self.common/'quiet'))
            finally:
                owner.terminate()
                owner.wait(timeout=3)
        self.assertFalse(API['quiet_marker_active'](self.common/'quiet'))

    def test_cli_refuses_an_ordinary_parent_even_with_copied_simulator_flags(self):
        env = {**os.environ, 'SIM_UDID':'copied-fixture'}
        result = subprocess.run([sys.executable,str(ROOT/'scripts/sim-quiet.py'),'verify',str(os.getpid())],
                                cwd=ROOT,env=env,capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,2)
        self.assertIn('G670',result.stderr)


if __name__ == '__main__':
    unittest.main()
