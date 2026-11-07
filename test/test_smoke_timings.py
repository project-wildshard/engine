"""Passive timing failures remain receipts, never browser verdicts."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('smoke_timings', 'scripts/smoke-timings.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Timings(unittest.TestCase):
    def test_api_failure_is_recorded_once_and_other_clock_still_runs(self):
        calls = []

        def request(args, **options):
            calls.append(args)
            return subprocess.CompletedProcess(args, 1, '', 'HTTP 502') if len(calls) == 1 else subprocess.CompletedProcess(args, 0, '{"started_at":"now"}', '')

        with tempfile.TemporaryDirectory(dir='tmp') as root, patch.dict(os.environ, GITHUB_REPOSITORY='owner/repo', GITHUB_RUN_ID='12'):
            directory = Path(root)
            MODULE.record(directory, 'journeys (explorer)', request)
            self.assertIn('HTTP 502', (directory / 'workflow-timing.json').read_text())
            self.assertEqual((directory / 'job-timing.json').read_text(), '{"started_at":"now"}')
        self.assertEqual(len(calls), 2)
        self.assertIn('journeys (explorer)', calls[1][-1])

    def test_unavailable_client_records_both_failures(self):
        def request(*args, **options):
            raise FileNotFoundError('gh unavailable')

        with tempfile.TemporaryDirectory(dir='tmp') as root, patch.dict(os.environ, GITHUB_REPOSITORY='owner/repo', GITHUB_RUN_ID='12'):
            directory = Path(root)
            MODULE.record(directory, 'phone-route', request)
            for name in ('workflow', 'job'):
                self.assertIn('gh unavailable', (directory / f'{name}-timing.json').read_text())


if __name__ == '__main__':
    unittest.main()
