// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {mkdtempSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {bootCook, createCookWorker, indexKey, pollCatalogue, POLL_EVERY_MS, type CatalogueRow, type CookStage, type ShardfileSource} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, legacyMigrationFixture, useCookHarness} from './fixtures/cookWorkerHarness';

/** SHARD-COMPAT SP6 (J175: "the cook worker polls outbound, no API call into the VPS"). The API sends the box no notice, so
 * an upload cooked only when the cook restarted (opus-ss16f, 2026-11-16 04:06 UTC). The worker now reads the catalogue on a
 * clock and cooks each upload it has not settled; a failed one waits out its own backoff, and a catalogue it can't read
 * backs the poll off. */
describe('the cook worker polls the catalogue', () => {
  const {folder, slug} = legacyMigrationFixture;
  const h = useCookHarness(folder, slug);

  /** A catalogue that can change between sweeps, counting each download. */
  function moving(): {source: ShardfileSource; heads: CatalogueRow[]; blobs: Map<string, Uint8Array>; downloads: string[]} {
    const heads: CatalogueRow[] = [], blobs = new Map<string, Uint8Array>(), downloads: string[] = [];
    return {heads, blobs, downloads, source: {
      heads: (stage: CookStage) => Promise.resolve(stage === 'staging' ? [...heads] : []),
      download: hash => { downloads.push(hash); const bytes = blobs.get(hash); return bytes === undefined ? Promise.reject(new Error('Shardfile answered 503')) : Promise.resolve(bytes); },
    }};
  }

  it('cooks a new upload on the next sweep, and an unchanged catalogue costs no download', async () => {
    const feed = moving(), cook = createCookWorker({build: 'p1', store: folderStore(join(h.scratch, 'poll')), source: feed.source, launcher: h.launcher(),
      serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work')});
    expect(await cook.sweep(['live', 'preview', 'staging'])).toEqual([]);
    const hash = hashOf(h.real);
    feed.heads.push({slug, hash}); feed.blobs.set(hash, h.real);
    expect((await cook.sweep(['live', 'preview', 'staging'])).map(row => row.state)).toEqual(['cooked']);
    expect(await cook.sweep(['live', 'preview', 'staging'])).toEqual([]);
    expect(feed.downloads).toEqual([hash]);
  }, 120_000);

  it('retries a failed upload only after its backoff', async () => {
    let now = 1_000_000;
    const feed = moving(), cook = createCookWorker({build: 'p2', store: folderStore(join(h.scratch, 'poll-failed')), source: feed.source, launcher: h.launcher(),
      serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work'), now: () => now});
    feed.heads.push({slug, hash: 'a'.repeat(64)});
    expect((await cook.sweep(['staging'])).map(row => row.state)).toEqual(['failed']);
    const tries = feed.downloads.length;
    expect(await cook.sweep(['staging'])).toEqual([]);
    expect(feed.downloads).toHaveLength(tries);
    now += 10 * 60_000;
    expect((await cook.sweep(['staging'])).map(row => row.state)).toEqual(['failed']);
    expect(feed.downloads).toHaveLength(2 * tries);
  }, 60_000);
});

describe('pollCatalogue', () => {
  it('sweeps every POLL_EVERY_MS, backs off on a catalogue error up to its cap, and stops', async () => {
    const waits: number[] = [], outcomes = ['ok', 'error', 'error', 'error', 'error', 'error', 'ok', 'ok'];
    const lines: string[] = [];
    let poll: ReturnType<typeof pollCatalogue> | undefined;
    const sweeps: (readonly CookStage[])[] = [];
    poll = pollCatalogue({sweep: stages => {
      sweeps.push(stages);
      const outcome = outcomes.shift();
      if (outcome === undefined) { poll?.stop(); return Promise.resolve([]); }
      return outcome === 'ok' ? Promise.resolve([]) : Promise.reject(new Error('Catalogue answered 502'));
    }}, {log: line => { lines.push(line); }, maxBackoffMs: 4 * POLL_EVERY_MS, wait: ms => { waits.push(ms); return Promise.resolve(); }});
    await poll.done;
    expect(POLL_EVERY_MS).toBeGreaterThanOrEqual(30_000);
    expect(POLL_EVERY_MS).toBeLessThanOrEqual(60_000);
    expect(waits).toEqual([1, 2, 4, 4, 4, 4, 1, 1].map(times => times * POLL_EVERY_MS));
    expect(sweeps[0]).toEqual(['live', 'preview', 'staging']);
    expect(lines.filter(line => line.includes('Catalogue answered 502'))).toHaveLength(5);
  });
});

/** opus-ss16g, 2026-11-16: `serve` awaited the boot recook of all 33 heads (about 2 h) before its first poll, so after every
 * release's cook restart a new upload waited 2 h. The poll now starts with the recook, and an upload no build has indexed
 * cooks ahead of the known heads the recook still has to do. A download that fails at once stands in for a cook; the order
 * of the downloads is the order of the cooks. */
describe('a new upload cooks ahead of the boot recook', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cook-poll-first-'));
  afterAll(() => { rmSync(scratch, {recursive: true, force: true}); });
  const hash = (letter: string): string => letter.repeat(64), KNOWN = ['b', 'c', 'd'].map(hash), FRESH = hash('e');
  const launcher = {root: scratch, execPath: process.execPath, loader: '', script: '', wrap: [], limits: {seconds: 1, memoryMB: 64, heapMB: 64}};
  async function setup(name: string): Promise<{cook: ReturnType<typeof createCookWorker>; heads: CatalogueRow[]; order: string[]; hold: () => () => void}> {
    const store = folderStore(join(scratch, name));
    // Last release's build indexed every known head; this build has none, so each is a recook.
    for (const known of KNOWN) await store.put(indexKey('last', known), new TextEncoder().encode('{}'), {type: 'application/json', cache: ''});
    const heads: CatalogueRow[] = KNOWN.map((known, row) => ({slug: `shard-${row}`, hash: known})), order: string[] = [];
    let gate: Promise<void> | null = null;
    const source: ShardfileSource = {
      heads: () => Promise.resolve([...heads]),
      download: async wanted => { order.push(wanted[0] ?? ''); const held = gate; gate = null; if (held !== null) await held; throw new Error('past its test'); },
    };
    const cook = createCookWorker({build: 'next', store, source, launcher, serverPacks: join(scratch, name, 'server'), scratch: join(scratch, name, 'work')});
    return {cook, heads, order, hold: () => { let open = (): void => undefined; gate = new Promise(resolve => { open = resolve; }); return open; }};
  }

  it('a recook takes the upload no build has indexed first', async () => {
    const {cook, heads, order} = await setup('recook');
    heads.push({slug: 'new-shard', hash: FRESH});
    await cook.recook(['staging']);
    expect(order.join('')).toBe('ebcd');
  });

  it('a sweep during a recook cooks a new upload next, and answers once that one is done', async () => {
    const {cook, heads, order, hold} = await setup('sweep');
    const open = hold(), recook = cook.recook(['staging']);
    await expect.poll(() => order.length).toBe(1); // the recook is inside its first known head
    heads.push({slug: 'new-shard', hash: FRESH});
    const swept = cook.sweep(['staging']);
    open();
    expect((await swept).map(row => row.hash)).toEqual([FRESH]);
    expect(order.join('').startsWith('be'), order.join('')).toBe(true);
    await recook;
    expect(order.join('')).toBe('becd');
  });

  // FAST-RELEASE FR-A20 (11-25): an old pine-hollow upload no catalogue advertised cooked 849 s ahead of all 37 recooks,
  // while the Brasscap head staging QA needed waited 33rd. Advertised heads go first, a bare upload notice last.
  it('an upload no catalogue advertises cooks after the advertised recooks, and a new pin still goes first', async () => {
    const {cook, heads, order, hold} = await setup('advertised');
    const open = hold(), recook = cook.recook(['staging']);
    await expect.poll(() => order.length).toBe(1);
    cook.enqueue({shard: 'old-upload', hash: hash('f')} as Parameters<typeof cook.enqueue>[0]);
    heads.push({slug: 'new-pin', hash: FRESH});
    const swept = cook.sweep(['staging']);
    open();
    await swept; await recook; await cook.idle();
    expect(order.join('')).toBe('becdf');
  });

  it('serve polls at once, with the boot recook still running', async () => {
    const sweeps: (readonly CookStage[])[] = [], waits: number[] = [];
    let poll: ReturnType<typeof bootCook>['poll'] | undefined;
    const booted = bootCook({recook: () => new Promise(() => undefined), sweep: stages => { sweeps.push(stages); poll?.stop(); return Promise.resolve([]); }},
      {wait: ms => { waits.push(ms); return Promise.resolve(); }});
    poll = booted.poll;
    poll.stop();
    await booted.poll.done;
    expect(sweeps).toEqual([['live', 'preview', 'staging']]);
  });
});
