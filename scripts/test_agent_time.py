"""Read-only SW5 report parsers: clocks, live logs and absent external inputs."""
import contextlib
import io
import datetime as dt
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

API = runpy.run_path(str(Path(__file__).with_name('agent-time.py')))


class AgentTimeTests(unittest.TestCase):
    def test_live_push_log_parses_offsets_and_ignores_bad_rows(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            path = Path(directory)/'push.log'
            path.write_text('bad\n2026-10-23T01:00:00-0500 {"status":"quiet"}\n'
                            '2026-10-23T06:00:01Z {"status":"pushed","gateSeconds":42}\n')
            since = dt.datetime(2026,10,23,6,tzinfo=dt.timezone.utc).timestamp()
            rows = API['push_rows'](path, since)
            self.assertEqual([row['status'] for row in rows], ['quiet','pushed'])
            self.assertEqual(rows[1]['at']-rows[0]['at'], 1)
            self.assertEqual(API['push_rows'](path, since+1), [rows[1]])

    def test_ci_cancelled_runs_do_not_close_or_open_red_windows(self):
        def row(seconds, conclusion, event='push'):
            return dict(updatedAt=dt.datetime.fromtimestamp(seconds, dt.timezone.utc).isoformat(),
                        createdAt=dt.datetime.fromtimestamp(seconds, dt.timezone.utc).isoformat(),
                        conclusion=conclusion,event=event,status='completed')
        rows = [row(80,'failure'),row(110,'cancelled'),row(120,'success','schedule'),
                row(130,'failure'),row(140,'success'),row(170,'failure')]
        self.assertEqual(API['ci_windows'](rows,100,200), [40,30])
        self.assertEqual(API['ci_windows']([row(80,'success'),row(150,'cancelled')],100,200), [])

    def test_ci_windows_follow_push_creation_and_later_repair_not_verdict_order(self):
        def row(created, completed, conclusion):
            return dict(createdAt=dt.datetime.fromtimestamp(created, dt.timezone.utc).isoformat(),
                        updatedAt=dt.datetime.fromtimestamp(completed, dt.timezone.utc).isoformat(),
                        conclusion=conclusion, event='push', status='completed')
        # The first green predates the broken push; the slow red finishes after its repair.
        rows = [row(20, 100, 'success'), row(40, 140, 'failure'),
                row(60, 120, 'failure'), row(80, 110, 'success')]
        self.assertEqual(API['ci_windows'](rows, 0, 200), [70])
        self.assertEqual(API['ci_windows'](list(reversed(rows)), 50, 200), [60])
        self.assertEqual(API['ci_windows'](rows[:2], 0, 200), [160])

    def test_ci_overlapping_repairs_keep_each_window_but_count_red_time_once(self):
        def row(created, completed, conclusion, event='push', status='completed'):
            return dict(createdAt=dt.datetime.fromtimestamp(created, dt.timezone.utc).isoformat(),
                        updatedAt=dt.datetime.fromtimestamp(completed, dt.timezone.utc).isoformat(),
                        conclusion=conclusion, event=event, status=status)
        rows = [row(10, 30, 'failure'), row(20, 80, 'success'),
                row(40, 60, 'failure'), row(50, 70, 'success', 'workflow_dispatch'),
                row(55, 75, 'cancelled'), row(65, 90, '', status='in_progress'),
                row(70, 100, 'success'), row(110, 130, 'failure'),
                row(120, 300, 'success')]
        self.assertEqual(API['ci_windows'](rows, 0, 200), [70, 60, 90])
        self.assertEqual(API['ci_red_seconds'](rows, 0, 200), 180)
        self.assertEqual(API['ci_red_seconds'](rows, 60, 200), 130)
        self.assertEqual(API['ci_windows'](rows, 140, 200), [60])

    def test_publication_latency_uses_main_ancestry_not_nearest_timestamp(self):
        commits = [dict(sha='old',at=10),dict(sha='new',at=20),dict(sha='ejected',at=30)]
        pushes = [dict(status='red',at=30,tip='new'),dict(status='pushed',at=40,tip='old'),dict(status='pushed',at=50,tip='new')]
        self.assertEqual(API['publication_seconds'](pushes,commits,{'new':0,'old':1}), [30,30])

    def test_nested_tool_results_capture_waits_without_prompt_commands(self):
        reading={'timeouts':API['Counter'](),'queueSeconds':[]}
        API['observe_output'](reading, json.dumps({'content':[{'type':'text','text':
            'heavy-lane: timed out after 5 min waiting\nheavy-lane: acquired build after 76.5s queue'}]}))
        self.assertEqual(reading['timeouts'], {'heavy-lane':1})
        self.assertEqual(reading['queueSeconds'], [76.5])

    def test_commit_timing_ledger_keeps_refusals_and_ignores_quotes_duplicates_and_invalid_rows(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            path = Path(directory) / 'commit-times.jsonl'
            first = dict(version=1, id='ok', at=20, elapsedMs=100, waitMs=40, workMs=60, exitCode=0)
            refused = dict(first, id='refused', elapsedMs=300, waitMs=100, workMs=200, exitCode=1)
            unknown = dict(first, id='unknown', elapsedMs=600, waitMs=0, workMs=600, exitCode=None)
            invalid = [dict(first, id='negative', elapsedMs=-1), dict(first, id='bad-sum', workMs=500),
                       dict(first, id='bad-type', waitMs=True), dict(first, id='bad-exit', exitCode='0'),
                       dict(first, id='bad-version', version=2), dict(first, id='bad-time', at=float('nan')),
                       {key: value for key, value in first.items() if key != 'exitCode'}]
            contents = [dict(first, id='old', at=9), first, refused, unknown, first, *invalid]
            path.write_text('\n'.join(map(json.dumps, contents)) + '\ncommit.sh: 999999 ms total wall\n')
            samples, ignored, error = API['commit_timing_rows'](path, 10)
            self.assertIsNone(error)
            self.assertEqual([row['id'] for row in samples], ['ok', 'refused', 'unknown'])
            self.assertEqual(ignored, len(invalid) + 2)
            reading = API['commit_timing_reading'](path, 10)
            self.assertIn('total seconds n=3 med=0.30 p90=0.60 max=0.60', reading)
            self.assertIn('successful total seconds n=1 med=0.10 p90=0.10 max=0.10', reading)
            self.assertIn('refused 1; unknown outcome 1', reading)
            self.assertIn('lock held seconds n=3 med=0.20 p90=0.60', reading)
            self.assertNotIn('999999', reading)
            self.assertEqual(API['commit_timing_rows'](path, 21)[0], [])
            path.write_text(json.dumps(refused) + '\n')
            refused_only = API['commit_timing_reading'](path, 10)
            self.assertIn('successful total seconds n=0;', refused_only)
            self.assertIn('refused 1; unknown outcome 0', refused_only)
            path.write_text(json.dumps(dict(first, lockMs=20)) + '\n')
            self.assertIn('lock held seconds n=1 med=0.02', API['commit_timing_reading'](path, 10))
            path.write_text(json.dumps(dict(first, lockMs=1000)) + '\n')
            self.assertEqual(API['commit_timing_rows'](path, 10)[0], [])

    def test_missing_commit_ledger_is_unavailable_and_empty_is_not_a_zero_time_pass(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            path = Path(directory) / 'commit-times.jsonl'
            self.assertIn('unavailable: FileNotFoundError', API['commit_timing_reading'](path, 0))
            path.write_text('')
            reading = API['commit_timing_reading'](path, 0)
            self.assertIn('total seconds n=0', reading)
            self.assertNotIn('p90=0', reading)

    def test_claude_mirror_hours_and_codex_project_filter(self):
        cut=dt.datetime(2026,1,1,tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            root=Path(directory);claude=root/'claude';claude.mkdir()
            entries=[{'timestamp':'2026-10-23T00:00:00Z','type':'assistant','message':{'content':[
                {'type':'tool_use','id':'a','name':'Bash','input':{'command':'node scripts/build-mirror.mjs run HEAD'}}]}},
                {'timestamp':'2026-10-23T00:01:00Z','type':'user','message':{'content':[
                {'type':'tool_result','tool_use_id':'a','content':'heavy-lane: acquired build after 61s queue'}]}}]
            (claude/'lane.jsonl').write_text('\n'.join(map(json.dumps,entries)))
            reading={'commands':{},'timeouts':API['Counter'](),'queueSeconds':[],'opusMirrorHours':0}
            API['claude'](cut,str(claude),reading)
            self.assertAlmostEqual(reading['opusMirrorHours'],1/60)
            self.assertEqual(reading['queueSeconds'],[61])
            session=root/'2026/10/23';session.mkdir(parents=True)
            (session/'lane.jsonl').write_text(json.dumps({'type':'session_meta','payload':{'cwd':'/other'}}))
            self.assertEqual(API['codex'](cut,str(root),repo='/ours')[2],0)

    def test_reading_prints_every_resource_even_when_external_sources_fail(self):
        report=API['print_reading']
        reading={'timeouts':API['Counter'](),'queueSeconds':[],'opusMirrorHours':0}
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            output=io.StringIO()
            with patch.dict(report.__globals__,{'command':lambda *args,**kwargs: ('','unavailable fixture'),
                    'json_command':lambda *args: (None,'unavailable fixture'),
                    'file_count':lambda *args: 'unavailable'}), contextlib.redirect_stdout(output):
                report(directory,2000000000,reading)
            for name in ('Push gate','CI / red main','Build mirror','Heavy builds','Five-minute waits',
                         'Full-test lane','Simulator / browsers','Commit lock / tree','Commit invocation','Generated inputs','Machine','Budgets'):
                self.assertIn('| '+name+' |',output.getvalue())
            self.assertIn('unavailable fixture',output.getvalue())

    def test_external_failure_is_named_and_never_retried(self):
        command=API['json_command']
        with patch.dict(command.__globals__,{'command':lambda *args: ('','gh exited 1')}):
            self.assertEqual(command(['gh']), (None,'gh exited 1'))


if __name__ == '__main__':
    unittest.main()
