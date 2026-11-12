#!/usr/bin/env python3
"""The look loop's Python logic: CIEDE2000 against Sharma, Wu and Dalal's (2005) reference pairs, the sRGB to Lab
conversion, capture-pattern globbing, and targets.py's capture finding and seed-mode prompts. Run by
test/look-loop.test.ts; standalone: python3 scripts/look-loop/test_look_loop.py"""
import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:  # palette-delta.py needs numpy and Pillow; hosted CI's Python has neither, so its checks run where they exist
    import numpy, PIL  # noqa: F401
    PD = load('palette_delta', 'palette-delta.py')
except ImportError:
    PD = None
TG = load('targets', 'targets.py')
SCRATCH = HERE.parent.parent / 'tmp' if (HERE.parent.parent / 'tmp').is_dir() else None  # the repo's tmp/, not /tmp
NEEDS = unittest.skipUnless(PD, 'numpy and Pillow are not installed')


@NEEDS
class DeltaE(unittest.TestCase):
    def test_sharma_pairs(self):
        pairs = [
            ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
            ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
            ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
            ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
        ]
        for a, b, want in pairs:
            self.assertAlmostEqual(PD.ciede2000(a, b), want, places=3)
            self.assertAlmostEqual(PD.ciede2000(b, a), want, places=3)

    def test_identity_and_lab(self):
        self.assertEqual(PD.ciede2000((40, 10, -5), (40, 10, -5)), 0.0)
        L, a, b = PD.srgb_to_lab((255, 255, 255))
        self.assertAlmostEqual(L, 100, delta=0.05); self.assertAlmostEqual(a, 0, delta=0.05); self.assertAlmostEqual(b, 0, delta=0.05)
        L, a, b = PD.srgb_to_lab((255, 0, 0))
        self.assertAlmostEqual(L, 53.24, delta=0.1); self.assertAlmostEqual(a, 80.09, delta=0.2); self.assertAlmostEqual(b, 67.20, delta=0.2)


class Files(unittest.TestCase):
    @NEEDS
    def test_frame_path(self):
        with tempfile.TemporaryDirectory(dir=SCRATCH) as d:
            for name in ['capture-1-fp-front.jpg', 'r2-capture-1-fp-front.jpg']:
                (Path(d) / name).write_bytes(b'x')
            self.assertEqual(PD.frame_path(f'{d}/capture-{{n}}-*.jpg', 1).name, 'capture-1-fp-front.jpg')
            self.assertIsNone(PD.frame_path(f'{d}/capture-{{n}}-*.jpg', 2))
            self.assertEqual(PD.frame_path(f'{d}/r2-capture-{{n}}-*.jpg', 1).name, 'r2-capture-1-fp-front.jpg')

    def test_captures(self):
        with tempfile.TemporaryDirectory(dir=SCRATCH) as d:
            for name in ['capture-1-fp-front.jpg', 'capture-5-top.jpg', 'r2-capture-1-fp-front.jpg', 'mockup-1-fp-front.jpg']:
                (Path(d) / name).write_bytes(b'x')
            self.assertEqual(sorted(TG.find_captures(d)), [1, 5])
            self.assertEqual(sorted(TG.find_captures(d, 'r2')), [1])

    def test_seed_jobs(self):
        caps = {1: Path('/x/capture-1-fp-front.jpg'), 5: Path('/x/capture-5-top.jpg')}
        jobs = TG.build_jobs(caps, '/o', seed=Path('/s/hero.jpg'), refs=[Path('/r/a.jpg')], only=set(), game='Mossgate', style='', keep='the hut')
        self.assertEqual([j['out'] for j in jobs], ['/o/mockup-1-fp-front.jpg', '/o/mockup-5-top.jpg'])
        self.assertEqual(jobs[0]['inputs'], ['/x/capture-1-fp-front.jpg', '/s/hero.jpg', '/r/a.jpg'])
        self.assertIn('Image 2 is the APPROVED MOCKUP', jobs[0]['prompt'])
        self.assertIn('Image 3 is a STYLE REFERENCE', jobs[0]['prompt'])
        self.assertIn('silhouette of the hut', jobs[0]['prompt'])
        self.assertIn('straight down', jobs[1]['prompt'])
        plain = TG.build_jobs(caps, '/o', only={5}, game='g', style='Warm toon.', keep='')
        self.assertEqual([j['n'] for j in plain], [5])
        self.assertNotIn('APPROVED MOCKUP', plain[0]['prompt'])
        self.assertIn('Warm toon.', plain[0]['prompt'])


if __name__ == '__main__':
    unittest.main()
