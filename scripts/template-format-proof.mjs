// Manual J233 edge proof, outside hooks. Actual CLI, OS-denied networking.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const started = performance.now(), root = resolve(import.meta.dirname, '..');
assert.equal(process.platform, 'darwin', 'This proof requires the macOS network sandbox');
const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11);
const scratch = process.argv.find(value => value.startsWith('--scratch='))?.slice(10);
assert.ok(baseline !== undefined && /^[a-f0-9]{40}$/u.test(baseline));
assert.ok(scratch !== undefined);
const old = execFileSync('git', ['show', `${baseline}:scripts/pins.ts`], {cwd: root, encoding: 'utf8'});
assert.ok(!old.includes("rest[0] === '--from-format'"), 'The control must be the actual unsupported CLI');
const temporary = mkdtempSync(join(scratch, 'template-format-proof-'));
try {
  const loader = join(temporary, 'baseline.mjs');
  writeFileSync(loader, `import{registerHooks}from'node:module';registerHooks({load(url,context,next){return url===${JSON.stringify(pathToFileURL(join(root, 'scripts/pins.ts')).href)}?{format:'module-typescript',source:${JSON.stringify(old)},shortCircuit:true}:next(url,context);}});`);
  const command = ['scripts/pins.ts', 'install', '--from-format', 'blender-template'];
  /** @param {string[]} args */
  const run = args => spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', process.execPath, ...args], {cwd: root, encoding: 'utf8', timeout: 8000});
  const before = run(['--import', loader, ...command]);
  assert.equal(before.error, undefined);
  assert.equal(before.status, 1);
  assert.match(before.stderr, /Not pinned: --from-format/u);
  const after = run(command);
  assert.equal(after.error, undefined);
  assert.equal(after.status, 0, `${after.stdout}\n${after.stderr}`);
  assert.match(after.stdout, /1 of 1 pins admitted/u);
  const receipt = JSON.parse(readFileSync(join(root, 'out/blender-template/validation.json'), 'utf8'));
  assert.equal(receipt.source.kind, 'format-dependency');
  assert.equal(receipt.source.path, '@wildshard/format/corpus/handwritten');
  /** @type {{shards: {slug: string; hash: string}[]}} */
  const pins = JSON.parse(readFileSync(join(root, 'test/pins/shardfiles.json'), 'utf8'));
  const pin = pins.shards.find(row => row.slug === 'blender-template');
  assert.ok(pin !== undefined);
  assert.equal(receipt.pin.hash, pin.hash, 'This frozen dependency equals the original API archive');
} finally {
  rmSync(temporary, {recursive: true});
}
const ms = performance.now() - started;
assert.ok(ms < 9500, `Complete edge proof took ${ms} ms`);
console.log(JSON.stringify({pass: true, ms, baseline, actualCli: true, network: 'OS-denied', cooked: false}));
