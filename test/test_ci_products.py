"""The CI preparation must survive transfer and refuse wrong or unsafe bytes."""
import importlib.util
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ci_products', Path(__file__).resolve().parents[1] / 'scripts' / 'ci-products.py')
products = importlib.util.module_from_spec(spec)
spec.loader.exec_module(products)


class PreparedProducts(unittest.TestCase):
    retained_cases = {
        'test_dirty_tracked_output_is_transferred_not_retained_even_when_staged',
        'test_missing_or_changed_retained_output_refuses_before_writes',
        'test_retained_inventory_cannot_overlap_an_archive_member',
        'test_retained_symlink_parent_refuses_even_inside_checkout',
        'test_retained_mode_is_checked_before_writes',
        'test_unchanged_retained_catalogue_output_is_transferred',
    }

    @classmethod
    def setUpClass(cls):
        # This is a tiny synthetic Git fixture, never a copy of the project.
        # Its real Node phase publisher and initial pack run once. Restoring
        # the same work path keeps the receipt root valid without forging it.
        scratch = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / 'tmp')
        cls.addClassCleanup(scratch.cleanup)
        cls.root = Path(scratch.name) / 'work'
        cls.pristine = Path(scratch.name) / 'pristine'
        cls.retained_pristine = Path(scratch.name) / 'retained'
        cls.root.mkdir()
        subprocess.run(['git', 'init', '-q', str(cls.root)], check=True)
        source = Path('src')
        cls.table = (source / 'table.generated.ts').as_posix()
        cls.shard = source / 'shards' / 'fictional'
        cls.asset = (cls.shard / 'assets' / 'hash').as_posix()
        cls.policy = (cls.shard / '.wildshard' / 'build-policy.json').as_posix()
        (cls.root / '.gitignore').write_text(f'{source}/*.generated.ts\npublic/generated.bin\nout/\nnode_modules/\nlint/*.generated.json\n')
        (cls.root / 'scripts').mkdir()
        cls.catalogue = {'producers': {'fixture': [cls.asset, 'public/generated.bin', cls.table]}}
        (cls.root / 'scripts/source-generation-outputs.json').write_text(json.dumps(cls.catalogue))
        subprocess.run(['git', '-C', str(cls.root), 'add', '.gitignore'], check=True)
        subprocess.run(['git', '-C', str(cls.root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture'], check=True)
        cls.sha = products.git(cls.root, 'rev-parse', 'HEAD').decode().strip()
        for name, content in {cls.table: b'export const value=7;', 'public/generated.bin': b'\0\x01', 'out/fictional/shard.json': b'{"format":2}',
                              cls.asset: b'retained bytes',
                              'lint/shard-words.generated.json': b'{"slugs":["fictional"]}',
                              cls.policy: b'{"version":1,"decisionLegacyLines":100}'}.items():
            path = cls.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        with patch.dict(os.environ, {'GITHUB_SHA': cls.sha, 'GITHUB_RUN_ID': '123'}):
            cls.create_phase_receipt()
            products.pack(cls.root)
        shutil.copytree(cls.root, cls.pristine)
        # The six retained-output cases share this identical real commit and
        # initial pack, but receive separate copied Git objects and files below.
        subprocess.run(['git', '-C', str(cls.root), 'add', cls.asset], check=True)
        subprocess.run(['git', '-C', str(cls.root), '-c', 'user.name=Fixture',
                        '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'retained asset'], check=True)
        cls.retained_sha = products.git(cls.root, 'rev-parse', 'HEAD').decode().strip()
        with patch.dict(os.environ, {'GITHUB_SHA': cls.retained_sha, 'GITHUB_RUN_ID': '123'}):
            products.pack(cls.root)
        shutil.copytree(cls.root, cls.retained_pristine)

    def setUp(self):
        # Every case gets independent Git objects, mutable bytes and archives.
        # copytree copies files; no hard links or state survive a prior case.
        shutil.rmtree(self.root)
        retained = self._testMethodName in self.retained_cases
        shutil.copytree(self.retained_pristine if retained else self.pristine, self.root)
        self.catalogue = json.loads((self.root / 'scripts/source-generation-outputs.json').read_text())
        self.env = patch.dict(os.environ, {'GITHUB_SHA': self.retained_sha if retained else self.sha, 'GITHUB_RUN_ID': '123'})
        self.env.start()
        self.addCleanup(self.env.stop)

    @classmethod
    def phase_probe(cls, action):
        repo = Path(__file__).resolve().parents[1]
        probe = f"""
          import {{InputHashMemo}} from '{(repo/'scripts/bake-input-hashes.mjs').as_uri()}';
          import {{sourceSnapshotIdentity,publishSourceSnapshot,verifiedSourceSnapshot}} from '{(repo/'scripts/source-input-proof.mjs').as_uri()}';
          const root=process.argv[1], action=process.argv[2], memo=new InputHashMemo(root);
          memo.enableSnapshot(file=>file==='public/generated.bin');
          const path=root+'/.cache/generation-phase.json', identity=sourceSnapshotIdentity('CI fixture');
          if(action==='create'){{memo.hash('src/table.generated.ts');publishSourceSnapshot(path,identity,memo,{{'public/generated.bin':memo.hash('public/generated.bin',true)}});}}
          else console.log(verifiedSourceSnapshot(path,identity,memo,['public/generated.bin']));
        """
        return subprocess.run(['node','--input-type=module','-e',probe,str(cls.root),action],
                              text=True,capture_output=True,check=True).stdout.strip()

    @classmethod
    def create_phase_receipt(cls):
        cls.phase_probe('create')

    def test_phase_receipt_transfers_and_rechecks_real_inputs_and_outputs(self):
        products.pack(self.root, generated=True)
        (self.root / products.PHASE).unlink()
        (self.root / self.table).unlink()
        products.unpack(self.root, generated=True)
        self.assertEqual(self.phase_probe('verify'), 'true')
        (self.root / 'public/generated.bin').write_bytes(b'changed output')
        self.assertEqual(self.phase_probe('verify'), 'false')
        (self.root / 'public/generated.bin').write_bytes(b'\0\x01')
        (self.root / self.table).write_text('changed input')
        self.assertEqual(self.phase_probe('verify'), 'false')

    def test_only_the_fixed_phase_cache_path_is_admitted(self):
        self.assertEqual(str(products.admitted_path(products.PHASE)), products.PHASE)
        with self.assertRaisesRegex(ValueError, 'Unexpected prepared output path'):
            products.admitted_path('.cache/other.json')
        (self.root / products.PHASE).unlink()
        with self.assertRaisesRegex(ValueError, 'missing its verified phase receipt'):
            products.pack(self.root, generated=True)

    def test_modified_derived_budget_round_trip_keeps_complete_provenance(self):
        name = 'budgets/ceiling-sources.json'
        path = self.root / name
        path.parent.mkdir()
        before = {'measured': {'gpuMB': 512, 'receipt': 'original capture'},
                  'derived': {'fictional': {'phone': 10}}}
        path.write_text(json.dumps(before))
        subprocess.run(['git', '-C', str(self.root), 'add', name], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Fixture',
                        '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'budget source'], check=True)
        os.environ['GITHUB_SHA'] = products.git(self.root, 'rev-parse', 'HEAD').decode().strip()
        after = {**before, 'derived': {'fictional': {'phone': 11}}}
        expected = (json.dumps(after) + '\n').encode()
        path.write_bytes(expected)
        products.pack(self.root, generated=True)
        path.write_text(json.dumps(before))
        products.unpack(self.root, generated=True)
        self.assertEqual(path.read_bytes(), expected)
        self.assertEqual(json.loads(path.read_text())['measured'], before['measured'])

    def test_derived_budget_transport_does_not_admit_other_policy_paths(self):
        self.assertEqual(str(products.admitted_path('budgets/ceiling-sources.json')),
                         'budgets/ceiling-sources.json')
        for name in ['budgets/calibration.json', 'budgets/other.json',
                     'budgets/../ceiling-sources.json', '/budgets/ceiling-sources.json',
                     'budgets/.env/ceiling-sources.json']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unexpected prepared output path'):
                products.admitted_path(name)


    def test_round_trip_restores_inputs_and_products(self):
        declared, required = products.source_outputs(self.root)
        policy = self.policy
        words = 'lint/shard-words.generated.json'
        for name in declared | required | {policy, words, 'out/fictional/shard.json'}:
            (self.root / name).unlink()
        products.unpack(self.root)
        for name in declared | required:
            self.assertTrue((self.root / name).is_file(), name)
        self.assertEqual(json.loads((self.root / policy).read_text())['decisionLegacyLines'], 100)
        self.assertEqual(json.loads((self.root / words).read_text())['slugs'], ['fictional'])
        repo = Path(__file__).resolve().parents[1]
        probe = f"""
          import {{projectDecisionBudget}} from '{(repo / 'src/sharddev/projectPolicy.ts').as_uri()}';
          import {{decisionLineCeiling}} from '{(repo / 'src/sharddev/buildDecisionScripts.ts').as_uri()}';
          const ceiling = decisionLineCeiling({{decisionLegacyLines: projectDecisionBudget(process.argv[1])}});
          if (ceiling !== 10) throw new Error('Restored policy did not reach decision admission');
        """
        subprocess.run(['node', '--import', str(repo / 'scripts/bake-loader.mjs'), '--input-type=module',
                        '-e', probe, str(self.root / self.shard)], check=True)
        self.assertEqual((self.root / 'public/generated.bin').read_bytes(), b'\0\x01')
        self.assertEqual((self.root / self.table).read_text(), 'export const value=7;')
        self.assertEqual((self.root / 'out/fictional/shard.json').read_text(), '{"format":2}')

    def test_streamed_checksum_covers_the_unchanged_tar_and_its_padding(self):
        files = {'public/empty.bin': b'',
                 'public/non-block.bin': bytes(range(251)) * 17,
                 'public/' + 'long-name-' * 14 + '\u00e9.bin': b'long name'}
        for name, content in files.items():
            (self.root / name).write_bytes(content)
        for generated in [False, True]:
            products.pack(self.root, generated=generated)
            name, proof_name = products.archive_names(generated)
            path = self.root / name
            proof = json.loads((self.root / proof_name).read_text())
            self.assertEqual(proof['sha256'], products.digest(path))
            with tarfile.open(path) as archive:
                names = archive.getnames()
            # Compare with the original direct-file tar writer, not a frozen
            # digest: real headers, PAX names, bodies and end padding must match.
            expected = self.root / 'reference.tar'
            with tarfile.open(expected, 'w') as archive:
                for member in names:
                    archive.add(self.root / member, arcname=member, recursive=False)
            self.assertEqual(path.read_bytes(), expected.read_bytes())
            for member in files:
                (self.root / member).unlink()
            products.unpack(self.root, generated=generated)
            for member, content in files.items():
                self.assertEqual((self.root / member).read_bytes(), content)

    def test_streamed_checksum_refuses_a_short_write(self):
        class ShortOutput(io.BytesIO):
            def write(self, block):
                return super().write(block[:-1])

        writer = products.ArchiveWriter(ShortOutput())
        with self.assertRaisesRegex(OSError, 'Incomplete prepared archive write'):
            writer.write(b'cannot attest unwritten bytes')

    def test_unchanged_retained_catalogue_output_is_transferred(self):
        name = self.asset
        self.retain_asset()
        proof = json.loads((self.root / products.PROOF).read_text())
        self.assertIn(name, proof['retained'])
        products.unpack(self.root)
        self.assertEqual((self.root / name).read_bytes(), b'retained bytes')

    def retain_asset(self):
        self.assertIn(self._testMethodName, self.retained_cases)
        self.assertEqual(os.environ['GITHUB_SHA'], self.retained_sha)
        proof = json.loads((self.root / products.PROOF).read_text())
        self.assertIn(self.asset, proof['retained'])

    def test_dirty_tracked_output_is_transferred_not_retained_even_when_staged(self):
        self.retain_asset()
        (self.root / self.asset).write_bytes(b'new producer bytes')
        subprocess.run(['git', '-C', str(self.root), 'add', self.asset], check=True)
        products.pack(self.root)
        proof = json.loads((self.root / products.PROOF).read_text())
        self.assertNotIn(self.asset, proof['retained'])
        (self.root / self.asset).unlink()
        products.unpack(self.root)
        self.assertEqual((self.root / self.asset).read_bytes(), b'new producer bytes')

    def test_missing_or_changed_retained_output_refuses_before_writes(self):
        self.retain_asset()
        (self.root / self.table).unlink()
        for content in [None, b'corrupt checkout']:
            if content is None:
                (self.root / self.asset).unlink()
            else:
                (self.root / self.asset).write_bytes(content)
            with self.assertRaisesRegex(ValueError, 'retained output|Retained output'):
                products.unpack(self.root)
            self.assertFalse((self.root / self.table).exists())

    def test_retained_inventory_cannot_overlap_an_archive_member(self):
        self.retain_asset()
        with tarfile.open(self.root / products.ARCHIVE, 'a') as archive:
            archive.add(self.root / self.asset, arcname=self.asset)
        proof = json.loads((self.root / products.PROOF).read_text())
        proof.update(sha256=products.digest(self.root / products.ARCHIVE), files=proof['files'] + 1)
        (self.root / products.PROOF).write_text(json.dumps(proof))
        (self.root / self.table).unlink()
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            products.unpack(self.root)
        self.assertFalse((self.root / self.table).exists())

    def test_retained_symlink_parent_refuses_even_inside_checkout(self):
        self.retain_asset()
        path = self.root / self.asset
        moved = self.root / 'other-assets'
        path.parent.rename(moved)
        path.parent.symlink_to(moved, target_is_directory=True)
        (self.root / self.table).unlink()
        with self.assertRaisesRegex(ValueError, 'Unsafe prepared output'):
            products.unpack(self.root)
        self.assertFalse((self.root / self.table).exists())

    def test_retained_mode_is_checked_before_writes(self):
        self.retain_asset()
        (self.root / self.asset).chmod(0o755)
        (self.root / self.table).unlink()
        with self.assertRaisesRegex(ValueError, 'Retained output differs'):
            products.unpack(self.root)
        self.assertFalse((self.root / self.table).exists())

    def test_required_output_is_admitted_from_retained_inventory(self):
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', self.table], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
                        'commit', '-qm', 'tracked required table'], check=True)
        os.environ['GITHUB_SHA'] = products.git(self.root, 'rev-parse', 'HEAD').decode().strip()
        products.pack(self.root, generated=True)
        products.unpack(self.root, generated=True)
        proof = json.loads((self.root / products.archive_names(True)[1]).read_text())
        self.assertIn(self.table, proof['retained'])
        self.assertEqual((self.root / self.table).read_text(), 'export const value=7;')


    def test_wrong_sha_and_run_refuse(self):
        original = (self.root / products.PROOF).read_bytes()
        for key in ['sha', 'run']:
            proof = json.loads((self.root / products.PROOF).read_text())
            proof[key] = 'wrong'
            (self.root / products.PROOF).write_text(json.dumps(proof))
            with self.assertRaisesRegex(ValueError, 'different SHA or CI run'):
                products.unpack(self.root)
            (self.root / products.PROOF).write_bytes(original)

    def duplicate_payload(self):
        source, other = 'public/duplicate.bin', 'out/fictional/duplicate.bin'
        payload = bytes(range(256)) * 512
        for name in [source, other]:
            (self.root / name).write_bytes(payload)
        (self.root / other).chmod(0o755)
        products.pack(self.root)
        proof = json.loads((self.root / products.PROOF).read_text())
        self.assertEqual(len(proof['duplicates']), 1)
        duplicate, row = next(iter(proof['duplicates'].items()))
        return payload, duplicate, row, proof

    def test_duplicate_payloads_restore_exact_paths_bytes_and_modes(self):
        payload, duplicate, row, proof = self.duplicate_payload()
        source = row['source']
        with tarfile.open(self.root / products.ARCHIVE) as archive:
            self.assertNotIn(duplicate, archive.getnames())
            self.assertEqual(archive.getmember(source).size, len(payload))
        mode = (self.root / duplicate).stat().st_mode & 0o777
        (self.root / duplicate).unlink()
        (self.root / source).unlink()
        products.unpack(self.root)
        self.assertEqual((self.root / duplicate).read_bytes(), payload)
        self.assertEqual((self.root / source).read_bytes(), payload)
        self.assertEqual((self.root / duplicate).stat().st_mode & 0o777, mode)
        self.assertNotEqual((self.root / duplicate).stat().st_ino, (self.root / source).stat().st_ino)

    def test_duplicate_tampering_refuses_before_any_writes(self):
        _, duplicate, row, proof = self.duplicate_payload()
        (self.root / self.table).unlink()
        for field, bad in [('source', duplicate), ('source', '../../outside'),
                           ('size', row['size'] + 1), ('sha256', '0' * 64), ('mode', 0o1000)]:
            proof['duplicates'][duplicate] = {**row, field: bad}
            (self.root / products.PROOF).write_text(json.dumps(proof))
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                products.unpack(self.root)
            self.assertFalse((self.root / self.table).exists())

    def test_duplicate_inventory_rejects_overlap_and_symlink_parent(self):
        _, duplicate, row, proof = self.duplicate_payload()
        (self.root / self.table).unlink()
        proof['duplicates'][row['source']] = row
        (self.root / products.PROOF).write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            products.unpack(self.root)
        del proof['duplicates'][row['source']]
        (self.root / products.PROOF).write_text(json.dumps(proof))
        parent = (self.root / duplicate).parent
        moved = self.root / 'duplicate-parent'
        parent.rename(moved)
        parent.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Unsafe prepared output'):
            products.unpack(self.root)
        self.assertFalse((self.root / self.table).exists())

    def test_required_generated_output_can_be_a_verified_duplicate(self):
        payload = bytes(range(256)) * 512
        (self.root / 'public/generated.bin').write_bytes(payload)
        (self.root / self.table).write_bytes(payload)
        self.create_phase_receipt()
        products.pack(self.root, generated=True)
        proof = json.loads((self.root / products.archive_names(True)[1]).read_text())
        self.assertIn(self.table, proof['duplicates'])
        (self.root / self.table).unlink()
        products.unpack(self.root, generated=True)
        self.assertEqual((self.root / self.table).read_bytes(), payload)
        self.assertEqual(self.phase_probe('verify'), 'true')

    def test_legacy_proof_without_duplicates_still_restores(self):
        proof = json.loads((self.root / products.PROOF).read_text())
        del proof['duplicates']
        (self.root / products.PROOF).write_text(json.dumps(proof))
        (self.root / self.table).unlink()
        products.unpack(self.root)
        self.assertTrue((self.root / self.table).is_file())

    def test_zstd_transport_restores_the_same_tar_before_existing_proof_checks(self):
        for generated in [False, True]:
            products.pack(self.root, generated=generated)
            archive_name, proof_name = products.archive_names(generated)
            archive = self.root / archive_name
            before, proof = products.digest(archive), (self.root / proof_name).read_bytes()
            subprocess.run(['zstd', '-3', '-T2', '--rm', str(archive)], check=True, capture_output=True)
            self.assertFalse(archive.exists())
            subprocess.run(['zstd', '-d', '--rm', str(archive) + '.zst'], check=True, capture_output=True)
            self.assertEqual(products.digest(archive), before)
            self.assertEqual((self.root / proof_name).read_bytes(), proof)
            (self.root / self.table).unlink()
            products.unpack(self.root, generated=generated)
            self.assertEqual((self.root / self.table).read_text(), 'export const value=7;')

    def test_duplicate_cannot_use_an_archived_file_as_a_parent(self):
        _, duplicate, row, proof = self.duplicate_payload()
        proof['duplicates'] = {row['source'] + '/child': row}
        (self.root / products.PROOF).write_text(json.dumps(proof))
        (self.root / self.table).unlink()
        with self.assertRaisesRegex(ValueError, 'Unsafe prepared output hierarchy'):
            products.unpack(self.root)
        self.assertFalse((self.root / self.table).exists())

    def test_corrupt_archive_refuses(self):
        with (self.root / products.ARCHIVE).open('ab') as stream:
            stream.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            products.unpack(self.root)

    def test_link_member_refuses_before_writing(self):
        with tarfile.open(self.root / products.ARCHIVE, 'a') as archive:
            link = tarfile.TarInfo('out/unsafe')
            link.type = tarfile.SYMTYPE
            link.linkname = '../../outside'
            archive.addfile(link)
        proof = json.loads((self.root / products.PROOF).read_text())
        proof.update(sha256=products.digest(self.root / products.ARCHIVE), files=proof['files'] + 1)
        (self.root / products.PROOF).write_text(json.dumps(proof))
        (self.root / 'public/generated.bin').unlink()
        with self.assertRaisesRegex(ValueError, 'Unsafe prepared output'):
            products.unpack(self.root)
        self.assertFalse((self.root / 'public/generated.bin').exists())


    def run_prepared_checks(self, read_product=False):
        repo = Path(__file__).resolve().parents[1]
        for name in ['ci-checks.mjs', 'ci-products.py']:
            (self.root / 'scripts' / name).write_bytes((repo / 'scripts' / name).read_bytes())
        (self.root / 'package.json').write_text(json.dumps({'type': 'module', 'scripts': {
            'test:checks': 'pnpm gen && node check.mjs'}}))
        (self.root / 'check.mjs').write_text("""
          import {readFileSync,writeFileSync} from 'node:fs';
          if(readFileSync('src/table.generated.ts','utf8')!=='export const value=7;')throw new Error('Missing verified preparation');
          writeFileSync('checks-ran','once');
        """)
        (self.root / 'extra.mjs').write_text("import {writeFileSync} from 'node:fs';writeFileSync('extra-ran','once');")
        if read_product:
            (self.root / 'check.mjs').write_text(f"""
              import {{readBuiltShardfile}} from '{(repo/'scripts/built-product.mjs').as_uri()}';
              import {{resolve}} from 'node:path';
              import {{existsSync,writeFileSync}} from 'node:fs';
              if(existsSync('absent-cache'))throw new Error('Unexpected local product cache');
              const folder=readBuiltShardfile(process.cwd(),'fictional',{{cacheRoot:resolve('absent-cache')}});
              if(folder!==resolve('out/fictional'))throw new Error('Did not use verified restored product');
              writeFileSync('verified-env.json',JSON.stringify({{sha:process.env.WS_TEST_PRODUCTS_SHA,github:process.env.GITHUB_SHA}}));
              writeFileSync('checks-ran','once');
            """)
        return subprocess.run(['node', 'scripts/ci-checks.mjs', '--prepared', 'node extra.mjs'],
                              cwd=self.root, text=True, capture_output=True)

    def test_prepared_build_reads_restored_product_without_local_recipe_cache(self):
        (self.root / self.shard / 'manifest.json').write_text('{}')
        (self.root / self.shard / 'shard.config.ts').write_text('export default {};')
        for name in ['pnpm-lock.yaml', 'pnpm-workspace.yaml']:
            (self.root / name).write_text('{}')
        products.pack(self.root)
        with patch.dict(os.environ, {'WS_TEST_PRODUCTS_SHA': 'f' * 40}):
            result = self.run_prepared_checks(read_product=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((self.root / 'verified-env.json').read_text()),
                         {'sha': self.sha, 'github': self.sha})
        self.assertFalse((self.root / 'absent-cache').exists())
        self.assertNotIn('ci-checks: gen ', result.stdout)

    def test_prepared_checks_restore_exact_run_without_generation(self):
        (self.root / self.table).unlink()
        result = self.run_prepared_checks()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.root / 'checks-ran').read_text(), 'once')
        self.assertEqual((self.root / 'extra-ran').read_text(), 'once')
        self.assertNotIn('ci-checks: gen ', result.stdout)
        self.assertIn('verified same-run preparation', result.stdout)

    def test_prepared_checks_refuse_a_foreign_run_before_any_checks(self):
        proof = json.loads((self.root / products.PROOF).read_text())
        proof['run'] = 'foreign'
        (self.root / products.PROOF).write_text(json.dumps(proof))
        result = self.run_prepared_checks()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('different SHA or CI run', result.stderr)
        self.assertFalse((self.root / 'checks-ran').exists())
        self.assertFalse((self.root / 'extra-ran').exists())

    def test_prepared_checks_require_the_archive_without_rebuilding(self):
        (self.root / products.ARCHIVE).unlink()
        result = self.run_prepared_checks()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('ci-checks: gen ', result.stdout)
        self.assertFalse((self.root / 'checks-ran').exists())
        self.assertFalse((self.root / 'extra-ran').exists())


    def test_generated_inputs_transfer_without_granting_product_proof(self):
        products.pack(self.root, generated=True)
        archive_name, proof_name = products.archive_names(True)
        with tarfile.open(self.root / archive_name, 'r') as archive:
            self.assertFalse(any(member.name.startswith('out/') for member in archive.getmembers()))
        (self.root / self.table).unlink()
        (self.root / 'out/fictional/shard.json').unlink()
        products.unpack(self.root, generated=True)
        self.assertTrue((self.root / self.table).is_file())
        self.assertFalse((self.root / 'out/fictional/shard.json').exists())
        # Renaming generated-only evidence cannot satisfy a full consumer.
        (self.root / products.ARCHIVE).write_bytes((self.root / archive_name).read_bytes())
        (self.root / products.PROOF).write_bytes((self.root / proof_name).read_bytes())
        with self.assertRaisesRegex(ValueError, 'products are missing'):
            products.unpack(self.root)

    def test_generated_app_tables_transfer_exact_bytes_without_product_proof(self):
        tables = {name: ('export const table=' + json.dumps(name) + ';').encode()
                  for name in ['out/.app/discovery.open-plots.open-plot-fossil-badlands.generated.ts']}
        self.catalogue['producers']['scripts/gen-shards.mjs'] = sorted(tables)
        (self.root / 'scripts/source-generation-outputs.json').write_text(json.dumps(self.catalogue))
        for name, content in tables.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        poison = self.root / 'out/.app/extra.generated.ts'
        poison.write_bytes(b'not a declared app input')
        products.pack(self.root, generated=True)
        archive_name, proof_name = products.archive_names(True)
        with tarfile.open(self.root / archive_name, 'r') as archive:
            names = {member.name for member in archive.getmembers()}
        self.assertEqual({name for name in names if name.startswith('out/')}, set(tables))
        for name in tables:
            (self.root / name).unlink()
        (self.root / 'out/fictional/shard.json').unlink()
        products.unpack(self.root, generated=True)
        for name, content in tables.items():
            self.assertEqual((self.root / name).read_bytes(), content)
        self.assertFalse((self.root / 'out/fictional/shard.json').exists())
        (self.root / products.ARCHIVE).write_bytes((self.root / archive_name).read_bytes())
        (self.root / products.PROOF).write_bytes((self.root / proof_name).read_bytes())
        with self.assertRaisesRegex(ValueError, 'products are missing'):
            products.unpack(self.root)

    def test_generated_app_tables_are_required_and_no_other_out_path_is_admitted(self):
        required = ['out/.app/discovery.open-plots.open-plot-fossil-badlands.generated.ts']
        self.catalogue['producers']['scripts/gen-shards.mjs'] = required
        (self.root / 'scripts/source-generation-outputs.json').write_text(json.dumps(self.catalogue))
        with self.assertRaisesRegex(ValueError, 'Missing prepared source outputs'):
            products.pack(self.root, generated=True)
        for name in required:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'export const table=1;')
        for poison in ['out/.app/extra.generated.ts', 'out/.app/discovery.unregistered.generated.ts', 'out/.app/shard.json', 'out/fictional/shard.json']:
            products.pack(self.root, generated=True)
            archive_name, proof_name = products.archive_names(True)
            with tarfile.open(self.root / archive_name, 'a') as archive:
                archive.add(self.root / required[0], arcname=poison)
            proof = json.loads((self.root / proof_name).read_text())
            proof['sha256'] = products.digest(self.root / archive_name)
            proof['files'] += 1
            (self.root / proof_name).write_text(json.dumps(proof))
            (self.root / self.table).unlink(missing_ok=True)
            with self.assertRaisesRegex(ValueError, 'cannot contain products'):
                products.unpack(self.root, generated=True)
            self.assertFalse((self.root / self.table).exists())
            (self.root / self.table).write_bytes(b'export const value=7;')

    def test_catalogued_discovery_bank_transfers_complete_bytes_and_refuses_omission(self):
        names = [f'out/.app/discovery.open-plots.open-plot-{name}.generated.ts'
                 for name in ('fossil-badlands', 'jungle-ziggurat', 'patchwork-fairground', 'saltwind-lighthouse')]
        self.catalogue['producers']['scripts/gen-shards.mjs'] = names
        (self.root / 'scripts/source-generation-outputs.json').write_text(json.dumps(self.catalogue))
        with self.assertRaisesRegex(ValueError, 'Missing prepared source outputs'):
            products.pack(self.root, generated=True)
        expected = {name: f'export const MANIFEST={{slug:{json.dumps(name)}}};'.encode() for name in names}
        for name, content in expected.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        poison = self.root / 'out/.app/discovery.unregistered.generated.ts'
        poison.write_bytes(b'not a declared generated input')
        products.pack(self.root, generated=True)
        archive_name, proof_name = products.archive_names(True)
        with tarfile.open(self.root / archive_name, 'r') as archive:
            self.assertEqual({item.name for item in archive.getmembers() if item.name.startswith('out/')}, set(names))
        for name in names:
            (self.root / name).unlink()
        poison.unlink()
        products.unpack(self.root, generated=True)
        for name, content in expected.items():
            self.assertEqual((self.root / name).read_bytes(), content)
        self.assertFalse(poison.exists())
        (self.root / products.ARCHIVE).write_bytes((self.root / archive_name).read_bytes())
        (self.root / products.PROOF).write_bytes((self.root / proof_name).read_bytes())
        with self.assertRaisesRegex(ValueError, 'products are missing'):
            products.unpack(self.root)

    def test_generated_inputs_refuse_foreign_run_and_product_members_before_writing(self):
        products.pack(self.root, generated=True)
        archive_name, proof_name = products.archive_names(True)
        proof = json.loads((self.root / proof_name).read_text())
        proof['run'] = 'foreign'
        (self.root / proof_name).write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError, 'different SHA or CI run'):
            products.unpack(self.root, generated=True)
        products.pack(self.root, generated=True)
        with tarfile.open(self.root / archive_name, 'a') as archive:
            archive.add(self.root / 'out/fictional/shard.json', arcname='out/fictional/shard.json')
        proof = json.loads((self.root / proof_name).read_text())
        proof.update(sha256=products.digest(self.root / archive_name), files=proof['files'] + 1)
        (self.root / proof_name).write_text(json.dumps(proof))
        (self.root / self.table).unlink()
        with self.assertRaisesRegex(ValueError, 'cannot contain products'):
            products.unpack(self.root, generated=True)
        self.assertFalse((self.root / self.table).exists())


if __name__ == '__main__':
    unittest.main()
