// oxlint-disable-next-line import/no-nodejs-modules -- The worker runs its job in real folders of its own.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the fixture bytes as the feed does.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep scratch inside the lane.
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createCookWorker, type JobLauncher} from '../src/cook/game/cookWorker';
import {admission} from '../src/cook/game/cookJob';
import {folderStore} from '../src/cook/game/packStore';
import {cookApi, uploadDelivery, VerdictOutbox, type CookApi, type PendingUpload} from '../src/cook/game/uploadTransport';

/** FORMAT-PRUNE FP27c: the format keeps the memory lines and the API keeps the armed list, so the cook feed carries the
 *  catalogue's armed word for each upload and the cook's admission passes it to validation. */
const bytes = new TextEncoder().encode('armed fixture'), hash = createHash('sha256').update(bytes).digest('hex');
const job: PendingUpload = {uploadId: '33333333-3333-3333-3333-333333333333', hash, slug: 'armed-fixture', revision: 1, formatVersion: '0.1.0.4', armed: true};
const folders: string[] = [];
const scratch = (): string => { const root = resolve('tmp/opus-pr6'); mkdirSync(root, {recursive: true}); const path = mkdtempSync(join(root, 'armed-')); folders.push(path); return path; };
afterEach(() => { for (const path of folders.splice(0)) rmSync(path, {recursive: true, force: true}); });

describe('FP27c: the catalogue armed word reaches the cook', () => {
  it('reads armed from each feed row, and an older API row without it', async () => {
    const {armed: _armed, ...older} = job;
    const read: typeof fetch = () => Promise.resolve(Response.json({uploads: [job, {...older, uploadId: '44444444-4444-4444-4444-444444444444'}]}));
    const rows: PendingUpload[] = [];
    for await (const row of cookApi('https://api.example', 'fixture-cook-signing-key-with-32-bytes', read, () => 1795000000000).pending()) rows.push(row);
    expect(rows.map(row => row.armed)).toEqual([true, undefined]);
  });

  it('hands the feed row armed word to the worker, and none when the row has none', async () => {
    const heads: unknown[] = [];
    const {armed: _armed, ...older} = job;
    const api: CookApi = {pending: async function* feed() { yield job; yield {...older, uploadId: '44444444-4444-4444-4444-444444444444', hash: 'b'.repeat(64)}; }, activations: async function* none() {}, download: () => Promise.resolve(bytes), verdict: () => Promise.resolve(), acknowledge: () => Promise.resolve()};
    const delivery = uploadDelivery({api, source: {bind: () => undefined}, worker: {cook: head => { heads.push(head); return Promise.resolve({slug: head.slug, hash: head.hash, state: 'failed', detail: 'fixture'}); }}, outbox: new VerdictOutbox(scratch()), build: 'b1'});
    await delivery.sweep(); await delivery.idle();
    expect(heads).toEqual([{slug: job.slug, hash, armed: true}, {slug: job.slug, hash: 'b'.repeat(64)}]);
  });

  it.each([[true, 'true'], [false, 'false'], [undefined, 'unset']] as const)('the worker gives its job armed %s as COOK_ARMED', async (armed, seen) => {
    const work = scratch(), script = join(work, 'armed-job.mjs');
    writeFileSync(script, `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[3] + '.result.json', JSON.stringify({refused: 'armed ' + (process.env.COOK_ARMED ?? 'unset')})); process.exit(3);`);
    const launcher: JobLauncher = {root: process.cwd(), execPath: process.execPath, loader: join(process.cwd(), 'src/scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 60, memoryMB: 2048, heapMB: 1024}};
    const worker = createCookWorker({build: 'b-armed', store: folderStore(join(work, 'store')), source: {heads: () => Promise.resolve([]), download: () => Promise.resolve(bytes)}, launcher, serverPacks: join(work, 'server'), scratch: join(work, 'work')});
    const row = await worker.cook({slug: job.slug, hash, ...(armed === undefined ? {} : {armed})});
    expect(row).toMatchObject({state: 'refused', detail: `armed ${seen}`});
    expect(row).not.toHaveProperty('armed');
  }, 60_000);

  it('admits a stored file under the armed word, and without one leaves the format to decide', () => {
    expect(admission(true)).toMatchObject({judged: 'stored', armed: true});
    expect(admission(false)).toMatchObject({judged: 'stored', armed: false});
    expect(admission()).not.toHaveProperty('armed');
    expect(admission().hash(bytes)).toBe(hash);
  });
});
