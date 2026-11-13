// SHARD-AUTHORING SA35 (meta J314, grill Q11): preview borrows staging's grid at deploy time. Staging's placement file (the one the staging
// MMO reads, signed with the API's placement key) adds its cells after the pinned 25; with staging down the live preview's grid stays and
// the run says so. The tool runs as the workflow runs it, against a `file:` placement file signed with a test key and a dead port.
// @vitest-environment node
/* oxlint-disable import/no-nodejs-modules -- It signs a placement file and runs the tool as a child, as the workflow does. */
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import * as v from 'valibot';
import { StandaloneCatalogueSchema } from '@wildshard/format/standaloneCatalogue';
import { borrowGrid, borrowedCells, sameCells, type Cell } from '../scripts/preview-grid.ts';

const pin = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as Parameters<typeof borrowGrid>[0];
const thinIce: Cell = { instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [0, 3] };
const fresh: Cell = { instance: 'brand-new', slug: 'brand-new', cell: [1, 3] };
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

test('a staging placement lands at the same cell, after the pinned 25, and the document stays a valid catalogue', () => {
  const out = borrowGrid(pin, { placed: [thinIce, fresh], serial: 4 }, { down: 'unused' });
  expect(out.source).toBe('staging');
  expect(out.warning).toBeUndefined();
  expect(out.document.grid.cells.slice(0, pin.grid.cells.length)).toEqual(pin.grid.cells);
  expect(out.document.grid.cells.slice(pin.grid.cells.length)).toEqual([thinIce, fresh]);
  // A pinned shard has its head; a slug this build has none for is placed with no head at this stage.
  expect(out.document.missing).toEqual([...pin.missing, 'brand-new']);
  expect(() => v.parse(StandaloneCatalogueSchema, out.document)).not.toThrow();
  expect(borrowedCells(pin, out.document)).toEqual([thinIce, fresh]);
});

test('no placement file is no placed cell: the pinned grid, with no warning; after a placement it is a fault and the live grid stays', () => {
  const out = borrowGrid(pin, { none: 'no placement file' }, { catalogue: pin });
  expect(out.document).toEqual(pin);
  expect(out.warning).toBeUndefined();
  expect(borrowGrid(pin, { none: 'no placement file' }, { down: 'answered 503' }).warning).toBeUndefined();
  // The API never deletes its file, so a 404 after preview borrowed a cell keeps that cell and says so (review SHOULD).
  const vanished = borrowGrid(pin, { none: 'no placement file' }, { catalogue: borrowGrid(pin, { placed: [thinIce], serial: 1 }, { down: '' }).document });
  expect(vanished.source).toBe('kept');
  expect(vanished.cells).toEqual([thinIce]);
  expect(vanished.warning).toContain('though the live preview borrowed cells');
});

test('staging down keeps the live preview\'s grid and says so; with neither, the pin and a warning', () => {
  const live = borrowGrid(pin, { placed: [thinIce], serial: 1 }, { down: '' }).document;
  const kept = borrowGrid(pin, { down: 'connection refused' }, { catalogue: live });
  expect(kept.source).toBe('kept');
  expect(kept.document.grid.cells.at(-1)).toEqual(thinIce);
  expect(kept.warning).toContain('kept the live preview\'s grid, 1 borrowed cell');
  const none = borrowGrid(pin, { down: 'connection refused' }, { down: 'answered 503' });
  expect(none.source).toBe('pinned');
  expect(none.document.grid.cells).toEqual(pin.grid.cells);
  expect(none.warning).toContain('pinned grid only');
});

test('a cell the staging MMO would refuse is left out: a taken spot, a slug with a cell, off the 7 × 7', () => {
  const home = pin.grid.cells[0];
  if (home === undefined) throw new Error('Expected a pinned cell');
  const out = borrowGrid(pin, { placed: [{ instance: 'squatter', slug: 'squatter', cell: home.cell }, { instance: 'twice', slug: home.slug, cell: [2, 3] },
    { instance: 'far', slug: 'far', cell: [0, 4] }, thinIce, { ...fresh, cell: thinIce.cell }], serial: 2 }, { down: '' });
  expect(out.cells).toEqual([thinIce]);
  expect(out.lines.filter(line => line.startsWith('left out'))).toHaveLength(4);
  expect(out.warning).toContain('4 staging cell(s) left out of preview\'s grid');
  // placeCell's name rules: a slug that is a placed instance's name, or an instance that is a placed slug, is refused too.
  const named = borrowGrid(pin, { placed: [{ instance: 'x-1', slug: home.instance, cell: [2, 3] }, { instance: home.slug, slug: 'y-1', cell: [3, 3] }], serial: 3 }, { down: '' });
  expect(named.cells).toEqual([]);
  expect(sameCells(out.cells, [thinIce])).toBe(true);
  expect(sameCells(out.cells, [])).toBe(false);
});

/** The tool as the workflow runs it, from this checkout, with GitHub's output files. */
const tool = (args: readonly string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> => new Promise(done => {
  const child = spawn(process.execPath, args, { env: { PATH: process.env['PATH'], ...env } });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.on('close', code => { done({ code, out }); });
});

test('the workflow\'s two calls: a signed staging file reaches the page, news is told, and a dead staging keeps the live grid', async () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/preview-grid-')), url = (name: string): string => pathToFileURL(join(root, name)).href;
  folders.push(root);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'), key = publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
  const body = JSON.stringify({ kind: 'placement', channel: 'staging', serial: 3, cells: [thinIce] });
  writeFileSync(join(root, 'placements.json'), JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
  writeFileSync(join(root, 'live.json'), JSON.stringify(pin));
  const output = join(root, 'output'), summary = join(root, 'summary'), env = { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: 'true' };
  const common = [`--placements=${url('placements.json')}`, `--last=${url('live.json')}`, `--key=${key}`];

  const news = await tool(['scripts/preview-grid.ts', '--news', ...common], env);
  expect(news.code, news.out).toBe(0);
  expect(readFileSync(output, 'utf8')).toBe('news=true\n');

  const write = await tool(['--import', './scripts/bake-loader.mjs', 'scripts/preview-grid.ts', join(root, 'catalogue.json'), ...common], env);
  expect(write.code, write.out).toBe(0);
  const baked = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')) as unknown;
  expect(borrowedCells(pin, baked)).toEqual([thinIce]);
  expect(readFileSync(summary, 'utf8')).toContain('open-plot-thin-ice (open-plot-thin-ice) at (0,3)');

  // The live preview now shows it: no news. A file under another key is refused by engine's reader, as the MMO refuses it.
  writeFileSync(join(root, 'live.json'), JSON.stringify(baked));
  writeFileSync(output, '');
  expect((await tool(['scripts/preview-grid.ts', '--news', ...common], env)).code).toBe(0);
  expect(readFileSync(output, 'utf8')).toBe('news=false\n');
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
  const forged = await tool(['--import', './scripts/bake-loader.mjs', 'scripts/preview-grid.ts', join(root, 'forged.json'), `--placements=${url('placements.json')}`, `--last=${url('live.json')}`, `--key=${other}`], env);
  expect(forged.out).toContain('bad signature');
  expect(forged.out).toContain('::warning title=preview grid::');

  // A live catalogue that can't be read is news only when staging has a cell: no placement file and no live page, no deploy.
  writeFileSync(output, '');
  expect((await tool(['scripts/preview-grid.ts', '--news', `--placements=${url('absent.json')}`, `--last=${url('absent-live.json')}`, `--key=${key}`], env)).code).toBe(0);
  expect(readFileSync(output, 'utf8')).toBe('news=false\n');

  // Staging down: the dead port's fetch fails, and the live preview's cell stays.
  const down = await tool(['--import', './scripts/bake-loader.mjs', 'scripts/preview-grid.ts', join(root, 'down.json'), '--placements=http://127.0.0.1:9/staging-placements.json', `--last=${url('live.json')}`, `--key=${key}`], env);
  expect(down.code, down.out).toBe(0);
  expect(down.out).toContain('::warning title=preview grid::staging\'s grid unreadable');
  expect(down.out).toContain('kept the live preview\'s grid, 1 borrowed cell');
  expect(borrowedCells(pin, JSON.parse(readFileSync(join(root, 'down.json'), 'utf8')) as unknown)).toEqual([thinIce]);
}, 30_000);
