#!/usr/bin/env python3
"""Safe regression checks: actual native memory only in subprocesses this test owns."""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('watchdog', pathlib.Path(__file__).with_name('ios-memory-watchdog.py'))
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


class WatchdogTests(unittest.TestCase):
    # These tests pin enforcement; @wildshard/format's memoryGates.json report-only mode has its own test below.
    def setUp(self):
        self.report_only = watchdog.REPORT_ONLY
        watchdog.REPORT_ONLY = False

    def tearDown(self):
        watchdog.REPORT_ONLY = self.report_only

    def test_report_only_records_an_overrun_without_failing(self):
        watchdog.REPORT_ONLY = True
        run = watchdog.BudgetRun(100)
        self.assertIsNone(run.observe([{'pid': 1, 'startAbstime': 1, 'physicalFootprintBytes': 150, 'residentBytes': 1}]))
        self.assertEqual(run.overruns[0]['peakBytes'], 150)
        self.assertIn('disappeared or restarted', run.observe([]))

    def test_decimal_phase_budget_drops_and_stale_marker_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = pathlib.Path(directory) / 'world'
            phase = watchdog.PhaseBudget(marker)
            run = watchdog.BudgetRun(phase.update())
            row = {'pid': 12, 'startAbstime': 1, 'physicalFootprintBytes': watchdog.WORLD_BUDGET + 100_000_000, 'residentBytes': 2_000_000_000}
            self.assertEqual(run.budget_bytes, watchdog.LOADING_BUDGET)
            self.assertIsNone(run.observe([row]))
            marker.touch()
            run.budget_bytes = phase.update()
            self.assertEqual(run.budget_bytes, watchdog.WORLD_BUDGET)
            self.assertIn('exceeds', run.observe([row]))
            with self.assertRaises(RuntimeError):
                watchdog.PhaseBudget(marker)

    def test_restarts_and_disappearance_cannot_pass(self):
        for replacement in ([], [{'pid': 12, 'startAbstime': 2, 'physicalFootprintBytes': 1, 'residentBytes': 1}]):
            run = watchdog.BudgetRun(100)
            self.assertIsNone(run.observe([{'pid': 12, 'startAbstime': 1, 'physicalFootprintBytes': 10, 'residentBytes': 20}]))
            self.assertIn('disappeared or restarted', run.observe(replacement))

    def test_processes_are_summed_and_peak_is_retained(self):
        run = watchdog.BudgetRun(100)
        rows = [{'pid': pid, 'startAbstime': 1, 'physicalFootprintBytes': 60, 'residentBytes': 80} for pid in (1, 2)]
        self.assertIn('exceeds', run.observe(rows))
        self.assertEqual(run.peak_footprint, 120)
        self.assertEqual(run.peak_resident, 160)

    @unittest.skipUnless(sys.platform == 'darwin', 'native libproc requires macOS')
    def test_native_allocation_pass_breach_and_exit(self):
        # 64 MiB, touched page-by-page: test enforcement without allocating gigabytes.
        child = subprocess.Popen([sys.executable, '-u', '-c',
            'import mmap,sys,time; print("ready",flush=True); sys.stdin.readline(); '
            'memory=mmap.mmap(-1,64*1024*1024)\n'
            'for offset in range(0,64*1024*1024,4096): memory[offset]=1\n'
            'print("allocated",flush=True); sys.stdin.readline(); '
            'memory.close(); print("freed",flush=True); time.sleep(60)'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            native = watchdog.NativeMemory()
            before = native.sample(child.pid)
            native.reset_interval(child.pid)
            run = watchdog.BudgetRun(before['physicalFootprintBytes'] + 32 * 1024 ** 2)
            self.assertIsNone(run.observe([before]))
            child.stdin.write('allocate\n')
            child.stdin.flush()
            self.assertEqual(child.stdout.readline().strip(), 'allocated')
            after = native.sample(child.pid)
            self.assertGreater(after['physicalFootprintBytes'] - before['physicalFootprintBytes'], 48 * 1024 ** 2)
            self.assertGreater(after['residentBytes'], before['residentBytes'])
            self.assertIn('exceeds', run.observe([after]))
            child.stdin.write('free\n')
            child.stdin.flush()
            self.assertEqual(child.stdout.readline().strip(), 'freed')
            freed = native.sample(child.pid)
            self.assertLess(freed['physicalFootprintBytes'], run.budget_bytes)
            self.assertGreater(freed['intervalMaxPhysicalFootprintBytes'], run.budget_bytes)
            self.assertIn('Native interval high-water', run.observe([freed]))
            native.reset_interval(child.pid)
            reset = native.sample(child.pid)
            self.assertIsNone(run.observe([reset]))
            self.assertGreater(reset['lifetimeMaxPhysicalFootprintBytes'], run.budget_bytes)
            child.terminate()
            child.wait(timeout=5)
            with self.assertRaises(RuntimeError):
                native.sample(child.pid)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdin.close()
            child.stdout.close()


if __name__ == '__main__':
    unittest.main()
