import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL_ROOT = Path(os.environ.get("WS_PUSH_TOOL_ROOT", ROOT / "scripts"))
CACHE = runpy.run_path(str(TOOL_ROOT / "push_input_cache.py"))


class PushInputCache(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tmp').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='push-loop-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'core.hooksPath', '/dev/null')
        self.put('.oxlintrc.json', '{"ignorePatterns":[]}')
        self.put('.gitignore', 'tmp/\n')
        self.put('scripts/push-inputs.mjs', 'console.log(JSON.stringify(process.argv.slice(2)));')
        self.base = self.commit('src/base.ts')
        self.git('update-ref', 'refs/remotes/origin/main', self.base)

    def git(self, *args):
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        return subprocess.check_output(['git', *args], cwd=self.root, env=env, text=True, stderr=subprocess.DEVNULL).strip()

    def put(self, file, value):
        path = self.root / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def commit(self, file):
        self.put(file, 'export const value = 1;\n')
        self.git('add', '--', '.')
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def test_source_type_cache_binds_contents_and_inventory(self):
        records = [b'100644 blob aaa\tsrc/author.ts', b'100644 blob bbb\tsrc/data.json']
        key = CACHE['source_key'](records, ['src'])
        self.assertEqual(key, CACHE['source_key']([*records, b'100644 blob ccc\tdocs/note.md'], ['src']))
        self.assertNotEqual(key, CACHE['source_key']([b'100644 blob ddd\tsrc/author.ts', records[1]], ['src']))
        self.assertNotEqual(key, CACHE['source_key']([*records, b'100644 blob eee\tsrc/new.ts'], ['src']))

    def test_generation_phase_cache_rejects_changed_inputs_and_corrupt_outputs(self):
        tip = self.git('rev-parse', 'HEAD')
        records = [row for row in subprocess.check_output(['git', 'ls-tree', '-rz', tip], cwd=self.root).split(b'\0') if row]
        generated = self.root / 'completed/tree'
        generated.mkdir(parents=True)
        (generated.parent / 'HEAD').write_text(tip)
        source = self.git('show', tip + ':src/base.ts') + '\n'
        output = b'{"value":1}'
        digest = hashlib.sha256(output).hexdigest()
        saved = {'schema': 'generation-phase/1', 'root': str(generated), 'identity': '0' * 64,
                 'inputs': {'src/base.ts': hashlib.sha256(source.encode()).hexdigest()},
                 'trees': {'src': ['src/base.ts']}, 'outputs': {'src/value.generated.json': digest}}
        body_name = 'public/assets/nalati/baked/bodies.bin'
        body = b'original raw species source'
        body_digest = hashlib.sha256(body).hexdigest()
        saved['outputs'][body_name] = body_digest
        body_path = generated / body_name
        body_path.parent.mkdir(parents=True)
        body_path.write_bytes(body)
        discovery = b'export default {seed:42};\n'
        saved['inputs']['src/shards/fixture/discovery.generated.ts'] = hashlib.sha256(discovery).hexdigest()
        asset = b'intrinsic asset bytes'
        asset_digest = hashlib.sha256(asset).hexdigest()
        asset_name = 'src/shards/fixture/assets/' + asset_digest
        saved['inputs'][asset_name] = asset_digest
        phase = generated / '.cache/generation-phase.json'
        phase.parent.mkdir()
        encoded = json.dumps(saved, ensure_ascii=False, separators=(',', ':'))
        phase.write_text(json.dumps({**saved, 'seal': hashlib.sha256(encoded.encode()).hexdigest()}))
        (generated / 'src').mkdir()
        (generated / 'src/value.generated.json').write_bytes(output)
        discovery_path = generated / 'src/shards/fixture/discovery.generated.ts'
        discovery_path.parent.mkdir(parents=True)
        discovery_path.write_bytes(discovery)
        asset_path = generated / asset_name
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(asset)
        post_bytes = b'export const post = true;\n'
        post_digest = hashlib.sha256(post_bytes).hexdigest()
        post_blobs = generated / '.cache/push-post-blobs'
        post_blobs.mkdir()
        (post_blobs / post_digest).write_bytes(post_bytes)
        # A finished post table survives mirror overlay cleanup in its blob.
        post_inputs = {}
        for row in records:
            header, name = row.split(b'\t', 1)
            name = name.decode()
            post_inputs[name] = hashlib.sha256(subprocess.check_output(
                ['git', 'cat-file', 'blob', header.split()[2]], cwd=self.root)).hexdigest() if name.endswith(('.ts', '.mjs', '.json')) else None
        post_inputs = {name: digest for name, digest in post_inputs.items() if digest is not None}
        post = {'schema': 'push-post-inputs/1', 'root': str(generated), 'revision': tip,
                'phase': json.loads(phase.read_text())['seal'], 'inputs': post_inputs,
                'outputs': {'src/post.generated.ts': post_digest}}
        post_file = generated / '.cache/push-post-inputs.json'
        def seal_post():
            encoded = json.dumps(post, ensure_ascii=False, separators=(',', ':'))
            post_file.write_text(json.dumps({**post, 'seal': hashlib.sha256(encoded.encode()).hexdigest()}))
        seal_post()
        self.assertEqual(CACHE['publish'](self.root, tip, generated), 3)
        cached = json.loads((self.root / 'tmp/push-input-cache/entries.json').read_text())
        self.assertEqual(cached['testFiles'], {body_name: body_digest})
        body_path.write_bytes(b'corrupt raw source')
        with self.assertRaisesRegex(ValueError, 'output changed'):
            CACHE['publish'](self.root, tip, generated)
        body_path.write_bytes(body)
        asset_path.write_bytes(b'corrupt addressed asset')
        with self.assertRaisesRegex(ValueError, 'input changed'):
            CACHE['publish'](self.root, tip, generated)
        asset_path.write_bytes(asset)
        post['revision'] = 'f' * 40
        seal_post()
        with self.assertRaisesRegex(ValueError, 'post-generation proof'):
            CACHE['publish'](self.root, tip, generated)
        post['revision'] = tip
        seal_post()
        target = self.root / 'checked'
        target.mkdir()
        self.assertTrue(CACHE['restore'](self.root, target, records, time.monotonic() + 5))
        self.assertEqual((target / 'src/value.generated.json').read_bytes(), output)
        self.assertEqual((target / 'src/shards/fixture/discovery.generated.ts').read_bytes(), discovery)
        self.assertEqual((target / 'src/post.generated.ts').read_bytes(), post_bytes)
        self.assertFalse((target / body_name).exists())
        self.assertFalse(CACHE['restore'](self.root, target, [*records, b'100644 blob new\tsrc/new.ts'], time.monotonic() + 5))
        previous = self.root / 'previous-check'
        previous.mkdir()
        changed = [*records, b'100644 blob new\tsrc/new.ts']
        self.assertEqual(CACHE['restore_tests'](self.root, previous, changed, time.monotonic() + 5), tip)
        self.assertEqual((previous / 'src/value.generated.json').read_bytes(), output)
        self.assertEqual((previous / body_name).read_bytes(), body)
        selected = self.root / 'selected-check'
        selected.mkdir()
        self.assertEqual(CACHE['restore_tests'](self.root, selected, changed, time.monotonic() + 5,
                         include=lambda name: name == 'src/post.generated.ts'), tip)
        self.assertEqual((selected / 'src/post.generated.ts').read_bytes(), post_bytes)
        self.assertFalse((selected / 'src/value.generated.json').exists())
        # The same old set still cannot earn current type proof.
        self.assertFalse(CACHE['restore'](self.root, previous, changed, time.monotonic() + 5))
        unsafe = self.root / 'symlink-check'
        unsafe.mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        (unsafe / 'src').symlink_to(outside, target_is_directory=True)
        self.assertIsNone(CACHE['restore_tests'](self.root, unsafe, changed, time.monotonic() + 5))
        self.assertEqual(list(outside.iterdir()), [])
        (self.root / 'tmp/push-input-cache/blobs' / digest).write_text('corrupt')
        clean = self.root / 'another-check'
        clean.mkdir()
        self.assertFalse(CACHE['restore'](self.root, clean, records, time.monotonic() + 5))
        self.assertIsNone(CACHE['restore_tests'](self.root, clean, changed, time.monotonic() + 5))
        self.assertFalse((clean / 'src/shards/fixture/discovery.generated.ts').exists())
        # An omitted blob is still verified; selection cannot hide corruption.
        filtered = self.root / 'filtered-corrupt'
        filtered.mkdir()
        self.assertIsNone(CACHE['restore_tests'](self.root, filtered, changed, time.monotonic() + 5,
                          include=lambda name: name == 'src/post.generated.ts'))
        self.assertFalse((filtered / 'src/post.generated.ts').exists())
        saved['inputs']['src/base.ts'] = 'f' * 64
        encoded = json.dumps(saved, ensure_ascii=False, separators=(',', ':'))
        phase.write_text(json.dumps({**saved, 'seal': hashlib.sha256(encoded.encode()).hexdigest()}))
        with self.assertRaisesRegex(ValueError, 'source differs'):
            CACHE['publish'](self.root, tip, generated)


if __name__ == "__main__":
    unittest.main()
