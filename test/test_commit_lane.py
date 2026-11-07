from pathlib import Path
import json
import runpy
import sys
import tempfile
import unittest

if '--candidate-stdin' in sys.argv:
    sys.argv.remove('--candidate-stdin')
    POLICY = {'__name__': 'commit_lane_fixture'}
    exec(compile(sys.stdin.read(), 'scripts/commit_lane.py', 'exec'), POLICY)
else:
    POLICY = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/commit_lane.py'))


class CommitLane(unittest.TestCase):
    def test_assisted_trailer_supplies_missing_runtime_lane(self):
        self.assertEqual(POLICY['commit_lane']('fix(scope): exact\n\nAssisted-by: sp-x2:gpt-6.1-sol\n'), 'sp-x2')
        self.assertEqual(POLICY['commit_lane']('fix(scope): exact\n\nAssisted-by: sp-o1:claude-opus-4-6\n'), 'sp-o1')
        self.assertEqual(POLICY['commit_lane']('human change'), 'human')

    def test_explicit_lane_wins_without_turning_a_pane_id_into_a_lane(self):
        self.assertEqual(POLICY['commit_lane']('human-authored fix', 'sp-x7'), 'sp-x7')
        with self.assertRaises(ValueError):
            POLICY['commit_lane']('', 'wT:p3')
        with self.assertRaises(ValueError):
            POLICY['commit_lane']('Assisted-by: sp-x1:model\nAssisted-by: sp-x2:model\n')

    def test_record_retains_existing_fields_and_never_leaves_lane_null(self):
        root = Path(__file__).resolve().parents[1]
        (root / 'tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root / 'tmp', prefix='commit-lane-') as owned:
            path = Path(owned) / 'ledger'
            def runner(command, **options):
                self.assertEqual(command, ['git', 'show', '-s', '--format=%H%x00%B', 'HEAD'])
                self.assertEqual(options['env']['HERDR_PANE_ID'], 'wT:p3')
                return 'a' * 40 + '\0fix(scope): exact\n\nAssisted-by: sp-x2:gpt-6.1-sol\n'
            row = POLICY['record_commit'](path, {'HERDR_PANE_ID': 'wT:p3'}, runner, lambda: 123)
            self.assertEqual(json.loads(path.read_text()), row)
            self.assertEqual(row, {'sha': 'a' * 40, 'pane': 'wT:p3', 'lane': 'sp-x2', 'at': 123})
            human = POLICY['record_commit'](path, {'HERDR_PANE_ID': 'wT:p3', 'SKIP_ATTRIB': '1'}, runner, lambda: 124)
            self.assertEqual(human['lane'], 'human')
            self.assertEqual(len(path.read_text().splitlines()), 2)


if __name__ == '__main__':
    unittest.main()
