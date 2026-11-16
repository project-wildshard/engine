// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createCookWorker, pollCatalogue, POLL_EVERY_MS, type CatalogueRow, type CookStage, type ShardfileSource} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, slug, useCookHarness} from './fixtures/cookWorkerHarness';

/** SHARD-COMPAT SP6 (J175: "the cook worker polls outbound, no API call into the VPS"). The API sends the box no notice, so
 * an upload cooked only when the cook restarted (opus-ss16f, 2026-11-16 04:06 UTC). The worker now reads the catalogue on a
 * clock and cooks each upload it has not settled; a failed one waits out its own backoff, and a catalogue it can't read
 * backs the poll off. */
describe('the cook worker polls the catalogue', () => {
  const h = useCookHarness();

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
