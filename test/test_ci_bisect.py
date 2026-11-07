from pathlib import Path
import json
import os
import runpy
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/ci-bisect.py'
if '--candidate-stdin' in sys.argv:
    sys.argv.remove('--candidate-stdin')
    POLICY = {'__file__': str(SOURCE), '__name__': 'bisect_fixture'}
    exec(compile(sys.stdin.read(), str(SOURCE), 'exec'), POLICY)
else:
    POLICY = runpy.run_path(str(SOURCE))


class CiBisect(unittest.TestCase):
    def test_exact_history_covers_every_commit_and_attributed_lane_without_a_checkout(self):
        root = SOURCE.parents[1]
        (root / 'tmp').mkdir(exist_ok=True)
        environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        with tempfile.TemporaryDirectory(dir=root / 'tmp', prefix='bisect-plan-') as owned:
            directory = Path(owned)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=directory, env=environment, text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '-q', '-b', 'main');git('config', 'core.hooksPath', '/dev/null')
            git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid')
            (directory / 'test').mkdir()
            file = directory / 'test/failure.test.ts'
            def commit(index, lane):
                file.write_text('export const value=' + repr('x' * (index + 1)) + ';\n')
                git('add', '.');git('commit', '-qm', 'fixture\n\nAssisted-by: ' + lane + ':model\n')
                return git('rev-parse', 'HEAD')
            base = commit(0, 'sp-x1')
            commits = [commit(index, 'sp-x2' if index % 2 else 'sp-o1') for index in range(1, 5)]
            evidence = [{'sha': commits[-1], 'run': '123', 'files': ['test/failure.test.ts', 'src/source.ts']}]
            plan = POLICY['bisect_plan'](directory, base, commits[-1], '123', evidence, parallel=2)
            self.assertTrue(plan['available'])
            self.assertEqual([row['sha'] for row in plan['commits']], commits)
            self.assertEqual([row['lane'] for row in plan['commits']], ['sp-x2', 'sp-o1', 'sp-x2', 'sp-o1'])
            flattened = [sha for group in plan['matrix']['include'] for sha in json.loads(group['commits'])]
            self.assertEqual(flattened, commits)
            self.assertEqual(plan['files'], ['test/failure.test.ts'])
            self.assertEqual(git('rev-parse', 'HEAD'), commits[-1])

    def test_wrong_run_or_unsafe_files_never_become_replay_commands(self):
        base, head = 'a' * 40, 'b' * 40
        with self.assertRaises(ValueError):
            POLICY['bisect_plan']('.', base, head, '123', [{'sha': head, 'run': 'wrong', 'files': []}])
        plan = POLICY['bisect_plan']('.', base, head, '123', [{'sha': head, 'run': '123', 'files': ['test/../secret.test.ts', '/tmp/foreign.test.ts', 'src/module.ts']}])
        self.assertFalse(plan['available'])
        self.assertEqual(plan['matrix']['include'], [])

    def test_first_bad_requires_complete_results_and_a_reproduced_failed_head(self):
        commits = [{'sha': char * 40, 'lane': 'sp-x2'} for char in ['b', 'c', 'd']]
        plan = {'schema': 1, 'available': True, 'base': 'a' * 40, 'head': 'd' * 40, 'commits': commits, 'files': ['test/failure.test.ts']}
        rows = [{'sha': row['sha'], 'status': 'passed' if index == 0 else 'failed'} for index, row in enumerate(commits)]
        self.assertEqual(POLICY['replay_report'](plan, rows)['firstBad'], 'c' * 40)
        self.assertFalse(POLICY['replay_report'](plan, rows[:-1])['proved'])
        rows[-1]['status'] = 'passed'
        self.assertFalse(POLICY['replay_report'](plan, rows)['proved'])
        rows[-1]['status'] = 'failed';rows[0]['status'] = 'unavailable'
        self.assertFalse(POLICY['replay_report'](plan, rows)['proved'])
        with self.assertRaises(ValueError):
            POLICY['replay_report'](plan, rows + [rows[0]])


if __name__ == '__main__':
    unittest.main()
