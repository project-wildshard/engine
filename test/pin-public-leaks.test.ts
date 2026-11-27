// @vitest-environment node
// Standalone shardfiles SF11 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md, J525): `pins.ts
// install` writes out/<folder> only, never public/, and no build copies a pinned zone's bytes onto the page (fix preview PV4: the
// page reads every zone from the cook). The guard reads the pins ledger, public/ and a build's dist/ for any pinned blob's or
// mount's SHA-256; the real install of one live pin by slug publishes nothing and removes what an earlier install
// published.
/* oxlint-disable import/no-nodejs-modules -- Fixture trees in owned scratch under tmp/, and the real pin CLI. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
/* oxlint-enable import/no-nodejs-modules */
import {afterEach, expect, test} from 'vitest';
import {assertNoPinPublicLeaks, pinPublicLeaks, trackedPublicPaths} from '../src/scripts/pin-public-leaks.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const sha = (body: string | Uint8Array): string => createHash('sha256').update(body).digest('hex');
function scratch(): string {
  mkdirSync(resolve('tmp/sf11-pin-public-leaks'), {recursive: true});
  const root = mkdtempSync(resolve('tmp/sf11-pin-public-leaks/tree-')); roots.push(root);
  return root;
}
function put(root: string, path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), body);
}
/** A pinned product under out/: one blob named by its hash, one mount, a receipt naming its pin. */
function pinned(root: string): {blob: string; mount: string} {
  const blob = 'zone ground texture bytes', mount = 'zone music bytes';
  put(root, 'out/made-up-zone/validation.json', JSON.stringify({pin: {hash: 'f'.repeat(64), uploadNumber: 3}}));
  put(root, `out/made-up-zone/blobs/image/${sha(blob)}.png`, blob);
  put(root, 'out/made-up-zone/mounts/assets/music/made-up-zone/calm.m4a', mount);
  put(root, 'out/made-up-zone/shard.json', '{}');
  put(root, 'out/.pins.json', JSON.stringify({revision: 'r', published: []}));
  return {blob, mount};
}

test('a clean tree and a zoneless dist pass; engine art the pin also mounts is no leak', () => {
  const root = scratch(), {mount} = pinned(root);
  put(root, 'public/assets/music/piano/calm.m4a', mount);
  put(root, 'public/index.html', '<!doctype html>');
  put(root, 'dist/index.html', '<!doctype html>');
  put(root, 'dist/assets/music/piano/calm.m4a', mount);
  const tracked = new Set(['public/assets/music/piano/calm.m4a', 'public/index.html']);
  // the piano pair is tracked engine art, so its bytes are the engine's even though a pin mounts the same file
  expect(pinPublicLeaks(root, {dist: join(root, 'dist'), tracked})).toEqual({ledger: [], public: [], dist: []});
});

test('a ledger row, an untracked public/ copy and a dist copy of a pinned blob or mount each fail by name', () => {
  const root = scratch(), {blob, mount} = pinned(root);
  put(root, 'out/.pins.json', JSON.stringify({revision: 'r', published: ['public/assets/gpu/tex/ground.png']}));
  put(root, 'public/assets/gpu/tex/ground.png', blob);
  put(root, 'dist/assets/music/made-up-zone/calm-1234abcd.m4a', mount);
  put(root, 'dist/assets/other.png', 'not a pinned file, same tree');
  const leaks = pinPublicLeaks(root, {dist: join(root, 'dist'), tracked: new Set()});
  expect(leaks.ledger).toEqual(['public/assets/gpu/tex/ground.png']);
  expect(leaks.public).toEqual([{path: 'public/assets/gpu/tex/ground.png', pinned: `out/made-up-zone/blobs/image/${sha(blob)}.png`}]);
  expect(leaks.dist).toEqual([{path: 'assets/music/made-up-zone/calm-1234abcd.m4a', pinned: 'out/made-up-zone/mounts/assets/music/made-up-zone/calm.m4a'}]);
  expect(() => { assertNoPinPublicLeaks(root, {dist: join(root, 'dist')}); }).toThrow(/3 pinned file\(s\) reached public\/ or the build/u);
});

test('every file on the engine list is engine git\'s, so no engine art leans on a pin (the cloud field and water ripples did)', () => {
  const tracked = trackedPublicPaths(process.cwd()), {files} = JSON.parse(readFileSync('src/scripts/public-engine.json', 'utf8')) as {files: string[]};
  // the Basis transcoder is copied from its package by the build, never committed
  expect(files.filter(path => !tracked.has(`public/${path}`) && !path.startsWith('basis/'))).toEqual([]);
});

test('a folder under out/ with no pin receipt is not a pinned product', () => {
  const root = scratch();
  put(root, 'out/cooked/blobs/image/x.png', 'cook output');
  put(root, 'public/x.png', 'cook output');
  expect(pinPublicLeaks(root, {tracked: new Set()}).public).toEqual([]);
});

/** One live pin by slug (J507: never a stored zone), the smallest open plot: 15 mounts, 5 MB. */
const SLUG = 'open-plot-saltwind-lighthouse';
function livePin(root: string): {folder: string} {
  const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {api: string; shards: {slug: string}[]};
  const pin = pins.shards.find(row => row.slug === SLUG);
  if (pin === undefined) throw new Error(`${SLUG} is no longer pinned: pick another small pin with asset mounts`);
  put(root, 'test/pins/shardfiles.json', JSON.stringify({api: pins.api, shards: [pin]}));
  return {folder: SLUG};
}
function cli(root: string, args: readonly string[]): Promise<{status: number | null; output: string}> {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve('src/scripts/pins.ts'), ...args], {cwd: root, env: {...process.env, CI: '', WILDSHARD_PINS_REUSE: '0'}});
    let output = '';
    child.stdout.on('data', (part: Buffer) => { output += part.toString(); });
    child.stderr.on('data', (part: Buffer) => { output += part.toString(); });
    child.on('close', status => { done({status, output}); });
  });
}

test('pins install writes out/<folder> only: its mounts stay in the product, and what an earlier install published goes', async () => {
  const root = scratch(), {folder} = livePin(root);
  // an install from before SF11 published a mount and named it in the ledger
  put(root, 'public/assets/made-up-proof/old.json', 'an earlier install wrote this');
  put(root, 'out/.pins.json', JSON.stringify({revision: 'r', published: ['public/assets/made-up-proof/old.json']}));
  const installed = await cli(root, ['install']);
  expect(installed.output).toContain('1 of 1 pins admitted, nothing published under public/'); expect(installed.status).toBe(0);
  const cook = JSON.parse(readFileSync(join(root, 'out', folder, 'cook.json'), 'utf8')) as {mounts: {url: string; path: string}[]};
  const assets = cook.mounts.filter(row => row.url.startsWith('/assets/'));
  expect(assets.length).toBeGreaterThan(0);
  for (const row of assets) expect(existsSync(join(root, 'out', folder, row.path))).toBe(true);
  expect(assets.filter(row => existsSync(join(root, `public${row.url}`)))).toEqual([]);
  expect(existsSync(join(root, 'public/assets/made-up-proof/old.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(root, 'out/.pins.json'), 'utf8'))).toMatchObject({published: []});
  expect(pinPublicLeaks(root, {tracked: new Set()})).toEqual({ledger: [], public: [], dist: []});
});
