// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a built page tree under the repository's tmp.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under tmp.
import {dirname, join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the CLI as build:game does.
import {spawnSync} from 'node:child_process';
import {afterEach, expect, test} from 'vitest';
import {SPLITTING, contentDirOf, joinOutput, splitOutput} from '../src/scripts/app-build/splitOutput.mjs';
import {gatePage, pageSize} from '../src/scripts/page-size.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/** Kept on the page: code, shell, runtime and maps. */
const PAGE = ['index.html', 'sw.js', 'version.json', 'catalogue.json', '.vite/chunk-modules.json', 'fonts/a.woff2', 'b/c/main-aaaaaaaa.js',
  'b/c/main-aaaaaaaa.js.map', 'basis/r186/basis_transcoder.wasm', 'assets/physics/rapier.wasm', 'calibration/index.html'];
/** Moved to dist-content: shard content (S1 to S7) and engine art (E1, D1 yes). */
const CONTENT = ['shardfiles/pine-hollow/shard.json', 'assets/spawn/parts/0123456789abcdef.pack.br', 'assets/spawn/server-build1.json',
  'assets/spawn/packs-build1.json', 'programs/pine-hollow.json', 'assets/grid-strip-mesh-12345678.bin', 'assets/boot-tables-12345678.json',
  'assets/pine-hollow/baked/a.glb', 'assets/tex/stone.ktx2', 'assets/title/card.webp', 'trailer-15.mp4', 'crossroads-rig/rig.glb'];

/** Every file under a root, `/`-separated, sorted. */
function tree(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name), path = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(at).isDirectory()) walk(at, path); else out.push(path);
    }
  };
  walk(root, '');
  return out.sort();
}

function fixture(): string {
  mkdirSync('tmp/codex-netlag', {recursive: true});
  const parent = mkdtempSync(resolve('tmp/codex-netlag/split-output-')); roots.push(parent);
  const dist = join(parent, 'dist');
  for (const path of [...PAGE, ...CONTENT]) { mkdirSync(dirname(join(dist, path)), {recursive: true}); writeFileSync(join(dist, path), path); }
  writeFileSync(join(dist, 'catalogue.json'), JSON.stringify({placements: [{slug: 'pine-hollow'}]}));
  return dist;
}

test('the split leaves code, shell, runtime and maps in dist/ and moves the rest to dist-content/ at the same paths', () => {
  const dist = fixture(), moved = splitOutput(dist);
  expect(contentDirOf(dist)).toBe(`${dist}-content`);
  expect(tree(dist)).toEqual([...PAGE].sort());
  expect(tree(contentDirOf(dist))).toEqual([...CONTENT].sort());
  expect(moved.files).toBe(CONTENT.length);
  // no empty folder is left behind on the page
  expect(existsSync(join(dist, 'shardfiles'))).toBe(false);
  expect(existsSync(join(dist, 'assets/spawn'))).toBe(false);
  expect(gatePage(pageSize(dist))).toEqual([]);
  // a second split is a no-op: the page already holds no content, and dist-content stays
  expect(splitOutput(dist).files).toBe(0);
  expect(tree(contentDirOf(dist))).toEqual([...CONTENT].sort());
});

test('a fresh build replaces a stale dist-content; --join puts the one tree back', () => {
  const dist = fixture();
  mkdirSync(join(`${dist}-content`, 'assets/spawn'), {recursive: true});
  writeFileSync(join(`${dist}-content`, 'assets/spawn/packs-old.json'), 'old');
  splitOutput(dist);
  expect(tree(contentDirOf(dist))).toEqual([...CONTENT].sort());
  joinOutput(dist);
  expect(tree(dist)).toEqual([...PAGE, ...CONTENT].sort());
  expect(existsSync(contentDirOf(dist))).toBe(false);
  // join with nothing to join is a no-op
  expect(joinOutput(dist).files).toBe(0);
});

test('DK10: an unchanged rebuilt file keeps its inode while changed and stale content is replaced', () => {
  const dist = fixture(), content = contentDirOf(dist), same = CONTENT[0] ?? '', changed = CONTENT[1] ?? '';
  splitOutput(dist);
  const inode = statSync(join(content, same)).ino;
  for (const path of CONTENT) { mkdirSync(dirname(join(dist, path)), {recursive: true}); writeFileSync(join(dist, path), path); }
  writeFileSync(join(dist, changed), 'changed content');
  writeFileSync(join(content, 'stale.bin'), 'stale');
  splitOutput(dist);
  expect(statSync(join(content, same)).ino).toBe(inode);
  expect(statSync(join(content, changed)).size).toBe('changed content'.length);
  expect(tree(content)).toEqual([...CONTENT].sort());
  expect(tree(dist)).toEqual([...PAGE].sort());
});

test('DK10: a saved full path list resumes pruning without losing already-moved files', () => {
  const dist = fixture(), content = contentDirOf(dist), first = CONTENT[0] ?? '';
  mkdirSync(dirname(join(content, first)), {recursive: true});
  renameSync(join(dist, first), join(content, first));
  writeFileSync(join(content, 'stale.bin'), 'stale');
  writeFileSync(join(dist, SPLITTING), JSON.stringify(CONTENT));
  splitOutput(dist);
  expect(tree(content)).toEqual([...CONTENT].sort());
  expect(tree(dist)).toEqual([...PAGE].sort());
});

test('DK10: pruning refuses a linked content root and preserves its destination', () => {
  const dist = fixture(), foreign = join(dirname(dist), 'foreign');
  mkdirSync(foreign); writeFileSync(join(foreign, 'keep.bin'), 'keep');
  symlinkSync(foreign, contentDirOf(dist));
  expect(() => splitOutput(dist)).toThrow('content root must be a real directory');
  expect(statSync(join(foreign, 'keep.bin')).size).toBe(4);
});

test('DK10: an interrupted temporary marker restarts atomically and still prunes stale content', () => {
  const dist = fixture(), content = contentDirOf(dist);
  mkdirSync(content); writeFileSync(join(content, 'stale.bin'), 'stale');
  writeFileSync(join(dist, `${SPLITTING}.tmp`), '["incomplete');
  splitOutput(dist);
  expect(tree(content)).toEqual([...CONTENT].sort());
  expect(tree(dist)).toEqual([...PAGE].sort());
});

test('DK10: a corrupt committed marker reports recovery before moving or pruning anything', () => {
  const dist = fixture(), content = contentDirOf(dist);
  mkdirSync(content); writeFileSync(join(content, 'stale.bin'), 'stale');
  writeFileSync(join(dist, SPLITTING), '["incomplete');
  expect(() => splitOutput(dist)).toThrow('invalid interrupted path list; inspect output and remove .splitting');
  expect(tree(content)).toEqual(['stale.bin']);
  expect(tree(dist)).toEqual([...PAGE, ...CONTENT, SPLITTING].sort());
});

test('a retry after an interrupted split keeps what already moved; overlapping roots are refused', () => {
  const dist = fixture(), content = contentDirOf(dist), first = CONTENT[0] ?? '';
  // the split was interrupted after its first move
  writeFileSync(join(dist, SPLITTING), '');
  mkdirSync(dirname(join(content, first)), {recursive: true});
  renameSync(join(dist, first), join(content, first));
  splitOutput(dist);
  expect(tree(content)).toEqual([...CONTENT].sort());
  expect(tree(dist)).toEqual([...PAGE].sort());
  expect(() => splitOutput(dist, dist)).toThrow('overlap');
  expect(() => joinOutput(dist, join(dist, 'assets'))).toThrow('overlap');
});

test('the CLI splits, gates and joins', () => {
  const dist = fixture();
  const split = spawnSync(process.execPath, ['src/scripts/app-build/splitOutput.mjs', dist], {encoding: 'utf8'});
  expect(split.status, split.stderr).toBe(0);
  expect(split.stdout).toContain(`${CONTENT.length} content files`);
  const gate = spawnSync(process.execPath, ['src/scripts/page-size.mjs', dist, '--gate'], {encoding: 'utf8'});
  expect(gate.status, gate.stderr).toBe(0);
  expect(gate.stdout).toContain('page-size gate: pass');
  const join_ = spawnSync(process.execPath, ['src/scripts/app-build/splitOutput.mjs', dist, '--join'], {encoding: 'utf8'});
  expect(join_.status, join_.stderr).toBe(0);
  const whole = spawnSync(process.execPath, ['src/scripts/page-size.mjs', dist, '--gate'], {encoding: 'utf8'});
  expect(whole.status).toBe(1);
  expect(whole.stderr).toContain(`dist/ holds ${CONTENT.length} content files`);
});

test('a kept build\'s content stays on the page (its tabs read it there) and the gate lets it pass', () => {
  const dist = fixture(), old = 'assets/boot-tables-87654321.json';
  writeFileSync(join(dist, old), 'old tables');
  writeFileSync(join(dist, 'deploy-chunks.json'), JSON.stringify({format: 2, builds: [
    {build: 'new', files: [{path: 'b/c/main-aaaaaaaa.js', bytes: 1}]},
    {build: 'old', files: [{path: old, bytes: 10}]},
  ]}));
  splitOutput(dist);
  expect(existsSync(join(dist, old))).toBe(true);
  expect(tree(contentDirOf(dist))).toEqual([...CONTENT].sort());
  expect(gatePage(pageSize(dist))).toEqual([]);
});
