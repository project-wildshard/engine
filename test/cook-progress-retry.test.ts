// @vitest-environment node
// Standalone shardfiles SF21 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md): a cook that runs out
// of its clock while it keeps new texture encodes is tried again from them, up to PROGRESS_TRIES more times, so a big zone's
// first cold cook on the production box finishes on a later try. The job here is a fake slow encoder run through the real
// bounded child: it keeps one encode per try in the job's cache folder and runs past the clock until it finds what it needs.
// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns and removes its store, scripts and job folders.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns and removes its store, scripts and job folders.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns and removes its store, scripts and job folders.
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {PROGRESS_TRIES, createCookWorker, encodeFolder, retryAfter} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';

describe('SF21: which failed try goes again', () => {
  it('retries a timed-out try that kept new encodes, while progress tries remain', () => {
    expect(retryAfter('past 1500 s', 10, 12, 0)).toBe('progress');
    expect(retryAfter('past 1500 s', 10, 12, PROGRESS_TRIES)).toBe('stop');
    expect(retryAfter('past 1500 s', 12, 12, 0)).toBe('stop');
    expect(retryAfter('exit 1: boom', 10, 12, 0)).toBe('transient');
    expect(retryAfter('Over the pack budget', 10, 12, 0)).toBe('stop');
  });
});

describe('SF21: a cook job retried from its kept encodes', () => {
  let scratch = '';
  const saved = process.env['COOK_ENCODE_CACHE'];
  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'sf21-retry-')); delete process.env['COOK_ENCODE_CACHE']; });
  afterEach(() => {
    rmSync(scratch, {recursive: true, force: true});
    if (saved === undefined) delete process.env['COOK_ENCODE_CACHE']; else process.env['COOK_ENCODE_CACHE'] = saved;
  });

  /** A job that keeps one encode a try and finishes (as a refusal naming its tries) once the cache holds `needed`. */
  const run = async (needed: number) => {
    // The child reads only its jobs folder (and the checkout), so the script sits there.
    mkdirSync(join(scratch, 'jobs'), {recursive: true});
    const script = join(scratch, 'jobs', 'slow-encoder.mjs');
    writeFileSync(script, `import {mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const folder = process.env.COOK_ENCODE_CACHE; mkdirSync(folder, {recursive: true});
const kept = readdirSync(folder).filter(name => name.endsWith('.ktx2')).length;
if (kept >= ${needed}) { console.log(JSON.stringify({refused: 'finished from ' + kept + ' kept encodes'})); process.exit(3); }
writeFileSync(join(folder, 'encode-' + kept + '.ktx2'), 'x');
setTimeout(() => {}, 60_000);`);
    const pin = {slug: 'proof-slow', hash: 'a'.repeat(64), revision: 1};
    const worker = createCookWorker({build: 'sf21-retry', store: folderStore(join(scratch, 'store')),
      source: {heads: () => Promise.resolve([pin]), download: () => Promise.resolve(new Uint8Array(8))},
      serverPacks: join(scratch, 'server'), scratch: join(scratch, 'jobs'),
      launcher: {root: process.cwd(), execPath: process.execPath, loader: resolve('src/scripts/bake-loader.mjs'), script, wrap: [],
        limits: {seconds: 2, memoryMB: 2048, heapMB: 512}}});
    return worker.cook(pin);
  };

  it('times out on the first try and finishes on the retry from the encode it kept', async () => {
    const row = await run(1);
    expect(row.state, row.detail).toBe('refused');
    expect(row.detail).toContain('finished from 1 kept encodes');
    expect(encodeFolder(join(scratch, 'jobs'))).toBe(join(scratch, 'jobs', 'cache', 'encodes'));
  }, 60_000);

  it('stops after PROGRESS_TRIES retries when each try keeps more but never finishes', async () => {
    const row = await run(PROGRESS_TRIES + 5);
    expect(row.state).toBe('failed');
    expect(row.detail).toMatch(/^past 2 s$/u);
  }, 90_000);
});
