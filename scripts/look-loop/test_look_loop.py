#!/usr/bin/env python3
"""The look loop's Python logic: targets.py's capture finding, seed-mode prompts and job polling. Run by
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


TG = load('targets', 'targets.py')
SCRATCH = HERE.parent.parent / 'tmp' if (HERE.parent.parent / 'tmp').is_dir() else None  # the repo's tmp/, not /tmp


class Files(unittest.TestCase):
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


class FakeRun:
    """a codex run that is still going until stopped"""
    def __init__(self): self.pid, self.returncode, self.stopped = 0, None, False
    def poll(self): return self.returncode


class Batch(unittest.TestCase):
    def test_two_job_batch_collects_both_pngs(self):
        """poll() end to end on a fake 2-job batch: each run logs its session id, its PNG lands in the fake
        generated_images folder, poll copies it into `work`, writes the job's out and stops the run"""
        with tempfile.TemporaryDirectory(dir=SCRATCH) as d:
            root = Path(d); gen, work = root / 'gen', root / 'work'
            gen.mkdir(); work.mkdir()
            jobs = [{'id': f'{n}-shot', 'out': str(root / f'mockup-{n}-shot.jpg')} for n in (1, 2)]
            queue, running, failed, started, stopped = list(jobs), {}, [], [], []

            def start(j):
                sid = f'0000000{len(started)}-aaaa-bbbb'
                log = work / f"{j['id']}.log"
                log.write_text(f'session id: {sid}\n')
                (gen / sid).mkdir(); (gen / sid / 'image.png').write_bytes(b'png-' + j['id'].encode())
                running[j['id']] = (FakeRun(), log, j); started.append(j['id'])

            def stop(p): p.stopped = True; stopped.append(p)
            real = TG.to_jpeg
            TG.to_jpeg = lambda png, out: Path(out).write_bytes(Path(png).read_bytes())  # no Pillow on hosted CI
            try:
                TG.poll(queue, running, failed, __import__('time').time(), 30, 1, start, stop, work, gen=gen, tick=0, settle=0)
            finally:
                TG.to_jpeg = real
            self.assertEqual(started, ['1-shot', '2-shot'])  # parallel 1: the second starts after the first lands
            self.assertEqual((failed, running, queue), ([], {}, []))
            self.assertEqual(len(stopped), 2)
            for j in jobs:
                self.assertEqual(Path(j['out']).read_bytes(), b'png-' + j['id'].encode())
                self.assertTrue((work / f"{j['id']}.png").is_file())

    def test_a_run_that_exits_without_an_image_fails(self):
        with tempfile.TemporaryDirectory(dir=SCRATCH) as d:
            work = Path(d); running, failed = {}, []

            def start(j):
                log = work / 'x.log'; log.write_text('no session\n')
                p = FakeRun(); p.returncode = 1; running[j['id']] = (p, log, j)
            TG.poll([{'id': 'x', 'out': str(work / 'x.jpg')}], running, failed, __import__('time').time(), 30, 2,
                    start, lambda p: None, work, gen=work / 'gen', tick=0, settle=0)
            self.assertEqual((failed, running), (['x'], {}))


if __name__ == '__main__':
    unittest.main()
