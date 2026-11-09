"""Manual CLI boundary proof; outside hooks and ordinary test discovery."""
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parent.parent
fixture = runpy.run_path(str(ROOT / 'scripts/test_sim_lane.py'))


class HeadlessNativeProof(fixture['SimulatorReadinessTests']):
    def selected_without_app(self):
        developer = self.developer_simctl()
        # The fixture created this empty directory in its own unique scratch.
        (developer / 'Applications/Simulator.app').rmdir()
        return developer

    def test_native_frames_are_still_required_with_no_desktop_bundle(self):
        result = self.lane(DEVELOPER_DIR=str(self.selected_without_app()),
                           SIM_OPEN_NO_FRAME='1', SIM_SAFARI_READY_TIMEOUT='.3')
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assert_not_handed_over()
        self.assertFalse((self.root / 'booted').exists())
        self.assertFalse((self.root / 'presentation-request').exists())

    def test_real_handover_follows_native_frames_without_a_desktop_bundle(self):
        result = self.lane(DEVELOPER_DIR=str(self.selected_without_app()))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('owned launch and owned two-frame callback confirmed', result.stderr)
        self.assertTrue((self.root / 'child-ran').exists())
        self.assertFalse((self.root / 'presentation-request').exists())


if __name__ == '__main__':
    suite = unittest.TestSuite(HeadlessNativeProof(name) for name in (
        'test_native_frames_are_still_required_with_no_desktop_bundle',
        'test_real_handover_follows_native_frames_without_a_desktop_bundle'))
    raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
