"""P1 cache/source identity and bounded observation; no network calls."""
import datetime as dt
import json
import os
from pathlib import Path
import runpy
import tempfile
import time
import unittest
from unittest.mock import patch

API=runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / 'recent-ci-tests.py'))


class RecentCITests(unittest.TestCase):
    def test_only_current_repository_test_paths_are_eligible(self):
        for path in ['test/actual.test.ts','src/format/actual.test.ts','admin/test/actual.test.ts']:
            self.assertTrue(API['test_path'](path))
        for path in ['/test/actual.test.ts','test/../run.test.ts','test/back\\slash.test.ts','scripts/executable.py','test/file.ts']:
            self.assertFalse(API['test_path'](path))

    def test_cache_expiry_repository_and_recency_are_exact(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            path=Path(directory)/'cache.json'
            path.write_text(json.dumps({'repo':'org/repo','at':100000,'runs':{
                'old':{'at':0,'files':['test/old.test.ts']},'first':{'at':99999,'files':['test/a.test.ts']},
                'latest':{'at':100000,'files':['test/b.test.ts','test/a.test.ts']},
                'future':{'at':100001,'files':['test/future.test.ts']}}}))
            self.assertEqual(API['paths'](API['read_cache'](path,'org/repo',100000)),['test/b.test.ts','test/a.test.ts'])
            self.assertEqual(API['paths'](API['read_cache'](path,'other/repo',100000)),[])

    def test_c4_metadata_pins_run_sha_and_ignores_peer_cancellation(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            root=Path(directory);(root/'tmp').mkdir()
            row={'databaseId':7,'headSha':'abc'}
            def fetch(args,*_):
                target=Path(args[args.index('--dir')+1]);target.mkdir(exist_ok=True)
                actual=target/'actual';actual.mkdir();peer=target/'peer';peer.mkdir()
                (actual/'failure.json').write_text(json.dumps({'run':'7','sha':'abc','files':['test/a.test.ts'],'peer':None}))
                (peer/'failure.json').write_text(json.dumps({'run':'7','sha':'abc','files':['test/innocent.test.ts'],'peer':'https://job'}))
                return 0,''
            self.assertEqual(API['failure_paths'](root,'org/repo',row,99999999,fetch),['test/a.test.ts'])
            with self.assertRaisesRegex(ValueError,'foreign'):
                API['failure_paths'](root,'org/repo',dict(row,headSha='other'),99999999,fetch)

    def test_legacy_failure_log_fallback_has_no_artifact_or_input_fabrication(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            root=Path(directory);(root/'tmp').mkdir();calls=[]
            def fetch(args,*_):
                calls.append(args)
                return (1,'') if 'download' in args else (0,'FAIL test/real.test.ts > actual')
            self.assertEqual(API['failure_paths'](root,'org/repo',{'databaseId':7},99999999,fetch),['test/real.test.ts'])
            self.assertEqual(len(calls),2);self.assertIn('--log-failed',calls[1])

    def test_refresh_is_cached_and_api_timeout_is_not_retried(self):
        function=API['refresh'];now=time.time()
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            root=Path(directory);(root/'.git').mkdir();(root/'tmp').mkdir()
            class Result:
                stdout='git@github.com:org/repo.git\n'
            calls=[]
            def timeout(*_):
                calls.append(1);raise TimeoutError('budget')
            with patch.object(API['subprocess'],'check_output',return_value=str(root/'.git')),patch.object(API['subprocess'],'run',return_value=Result()):
                files,note=function(root,time.monotonic()+1,fetch=timeout,now=now)
                self.assertEqual(files,[]);self.assertIn('no retry',note)
                function(root,time.monotonic()+1,fetch=timeout,now=now+30)
            self.assertEqual(calls,[1])


if __name__=='__main__':
    unittest.main()
