// OFFLINE OF1: the offline proof's pass and fail rules (scripts/offline-proof-rules.mjs) on a saved request log.
import { describe, expect, it } from 'vitest';
import { ALL_SHARDS, gridPlaces, judge, mayFail, screenKey, servedCounts, type RequestRow, type ScreenSample } from '../scripts/offline-proof-rules.mjs';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };

const at = 'http://127.0.0.1:4401';
let n = 0;
const row = (url: string, extra: Partial<RequestRow> = {}): RequestRow =>
  ({ n: ++n, t: n * 10, url: url.startsWith('http') ? url : `${at}${url}`, type: 'fetch', origin: 'page', phase: 'load', step: 'home', servedBy: 'service-worker', status: 200, fail: '', ...extra });
const screen = (extra: Partial<ScreenSample> = {}): ScreenSample =>
  ({ t: 0, phase: 'load', step: 'home', card: true, title: false, player: false, failCard: '', text: 'LOAD 12 / 26', ...extra });
const inPlay = [screen({ t: 0 }), screen({ t: 900, phase: 'page', card: false, player: true, text: '' })];
const greenLog = [
  row('/?mute=1', { phase: 'title', type: 'document' }),
  row('/assets/spawn/nalati-grasslands-grid-phone-0123456789abcdef.json', { phase: 'start', step: 'start.app:selected-discovery' }),
  row('/assets/grid-seam-plans-0123456789abcdef.json', { phase: 'load', step: 'home' }),
  row('/api/telemetry', { phase: 'load', servedBy: 'failed', fail: 'net::ERR_INTERNET_DISCONNECTED' }),
  row('https://packs.wildshard.io/releases/staging.json', { phase: 'start', servedBy: 'failed', fail: 'net::ERR_INTERNET_DISCONNECTED' }),
  row('/version.json?t=1', { phase: 'start', servedBy: 'failed', fail: 'net::ERR_INTERNET_DISCONNECTED' }),
  // the service worker's own network-first read failing offline is not the page's read
  row('/programs/nalati-grasslands.json', { origin: 'sw', servedBy: 'failed', fail: 'net::ERR_INTERNET_DISCONNECTED' }),
  // a title-screen read is not on the critical path (OF15 owns the title)
  row('/drafts/thin-ice/50ecc454e23ed708-thumb.webp', { phase: 'title', servedBy: 'failed', fail: 'net::ERR_INTERNET_DISCONNECTED' }),
];
const base = { shard: 'nalati-grasslands', channel: 'staging' as const, mode: 'offline', entry: 'deck' };

describe('offline proof rules (OF1)', () => {
  it('covers the ten catalogue shards and three Open Plots', () => {
    expect(ALL_SHARDS).toHaveLength(13);
    expect(ALL_SHARDS).toContain('open-plot-night-market');
  });
  it('passes a load from the cache whose only failures are telemetry, version.json and the release read', () => {
    expect(judge({ ...base, rows: greenLog, samples: inPlay, outcome: 'play', layout: true })).toEqual([]);
    expect(mayFail(`${at}/version.json`)).toBe(true);
    expect(mayFail(`${at}/__offline-proof/staging.json`) && mayFail(`${at}/api/errors`)).toBe(true);
    expect(mayFail(`${at}/assets/spawn/code/0123.json`)).toBe(false);
    expect(servedCounts(greenLog)).toEqual({ 'service-worker': 3, failed: 4 });
  });
  it('names the shard and the URL of a failed critical-path read', () => {
    const rows = [...greenLog, row('/assets/spawn/code/2b3387b48de22bc0.json', { phase: 'start', servedBy: 'failed', fail: 'net::ERR_INTERNET_DISCONNECTED' }),
      row('/assets/music/piano/sting-a4f2ffab.m4a', { phase: 'load', servedBy: 'network', status: 404 })];
    const failures = judge({ ...base, rows, samples: inPlay, outcome: 'play' });
    expect(failures.map(failure => [failure.shard, failure.rule, failure.url])).toEqual([
      ['nalati-grasslands', 'critical-request-failed', `${at}/assets/spawn/code/2b3387b48de22bc0.json`],
      ['nalati-grasslands', 'critical-request-failed', `${at}/assets/music/piano/sting-a4f2ffab.m4a`],
    ]);
  });
  it('fails a drop to the title and the raw failure strings', () => {
    const samples = [screen({ t: 0 }), screen({ t: 500, text: 'Level load and cleanup failed' }), screen({ t: 900, phase: 'title', card: false, title: true, text: 'Failed to fetch' })];
    const rules = judge({ ...base, rows: greenLog, samples, outcome: 'title' }).map(failure => failure.rule);
    expect(rules).toEqual(['title-drop', 'raw-string', 'raw-string']);
  });
  it('fails a world build that reads the solo server or a one-shard manifest the warm visit never read', () => {
    const client = '/assets/spawn/nalati-grasslands-client-phone-0b40f90e23cec8d9.json';
    const rows = [...greenLog, row('/b/abc/standalone/serverWorker-spaczDlR.js', { step: 'gameplay' }), row('/assets/spawn/server/90b50ecb27fbb1fb.pack.br'), row(client, { phase: 'start' })];
    const rules = judge({ ...base, rows, samples: inPlay, outcome: 'play', warm: new Set(['/assets/spawn/code/2b3387b48de22bc0.json']) }).map(failure => failure.rule);
    expect(rules).toEqual(['solo-file-on-world-build', 'solo-file-on-world-build', 'client-manifest-not-warm']);
    // a manifest the warm visit read is fine, and preview is the solo build, so its server reads are fine
    expect(judge({ ...base, rows: [...greenLog, row(client)], samples: inPlay, outcome: 'play', warm: new Set([client]) })).toEqual([]);
    expect(judge({ ...base, channel: 'preview', rows, samples: inPlay, outcome: 'play', warm: new Set() })).toEqual([]);
    // the service worker's own precache of the solo files is reported, not judged
    expect(judge({ ...base, rows: [...greenLog, row('/b/abc/standalone/serverRuntime-q4.js', { origin: 'sw' })], samples: inPlay, outcome: 'play' })).toEqual([]);
  });
  it('fails a stall with nothing else to blame, and a staging seat wait is not a stall', () => {
    expect(judge({ ...base, rows: greenLog, samples: [screen({ phase: 'start', step: 'start.app:code' })], outcome: 'stalled' })).toEqual([
      { shard: 'nalati-grasslands', rule: 'stalled', detail: 'start/start.app:code' }]);
    expect(judge({ ...base, rows: greenLog, samples: [screen({ step: 'server' })], outcome: 'seat-wait' })).toEqual([]);
  });
  it('OF5b: the card\'s clock and HUD text never count as the screen changing; its step, error and progress do', () => {
    // setup | readBytes | streamedBytes | spawnFilesDone | serverFiles, as readScreen joins them
    const waiting = { phase: 'load', step: 'server', error: '', failCard: '', title: false, player: false, progress: '86|20408822|34504377|295|0' };
    // buddy-engine's run: Template's card ticked "LOADING TEMPLATE SHARD 00:38.3" inside the old 200-character text key; text is no input now
    expect(screenKey({ ...waiting, text: 'LOADING TEMPLATE SHARD 00:38.3' } as typeof waiting)).toBe(screenKey({ ...waiting, text: 'LOADING TEMPLATE SHARD 00:38.6' } as typeof waiting));
    for (const change of [{ step: 'audio' }, { error: 'Failed to fetch' }, { failCard: 'No connection' }, { title: true }, { player: true },
      { progress: '87|20408822|34504377|295|0' }, { progress: '86|20408822|34600000|295|0' }])
      expect(screenKey({ ...waiting, ...change })).not.toBe(screenKey(waiting));
  });
  it('OF3, OF5b: "Not in this world yet" is green only for a shard a world build\'s grid doesn\'t place', () => {
    const title = [screen({ phase: 'title', card: false, title: true, text: 'Thin Ice: Not in this world yet' })];
    const end = (extra: Partial<Parameters<typeof judge>[0]>) => judge({ ...base, shard: 'open-plot-thin-ice', rows: greenLog, samples: title, outcome: 'outside-world', ...extra }).map(failure => failure.rule);
    expect(gridPlaces('open-plot-thin-ice', catalogue)).toBe(false);
    expect(gridPlaces('open-plot-night-market', catalogue)).toBe(true);
    expect(end({ placed: false })).toEqual([]);
    // a page that never left the title loads no grid layout (OF20's rule is for entries that load)
    expect(end({ placed: false, layout: true })).toEqual([]);
    expect(end({ placed: false, requireWorld: true })).toEqual([]);
    expect(end({ placed: true })).toEqual(['outside-world']);
    expect(end({ placed: false, channel: 'preview' })).toEqual(['outside-world']);
  });
  it('GC26: a preview deck entry of a placed shard ends inside its own grid cell', () => {
    const at = (inside?: string | null) => judge({ ...base, channel: 'preview', placed: true, rows: greenLog, outcome: 'play',
      samples: [screen({ t: 0 }), screen({ t: 900, phase: 'page', card: false, player: true, text: '', ...inside === undefined ? {} : { inside } })] }).map(failure => failure.rule);
    expect(at('nalati-grasslands')).toEqual([]);
    expect(at('driftwood-isle')).toEqual(['not-in-cell']);
    expect(at(null)).toEqual(['not-in-cell']);
    expect(at()).toEqual(['not-in-cell']);
  });
  it('fails the load error screen, the proof\'s own error, a resume never offered, a leak, and (OF5, OF9) any end outside the world', () => {
    const rules = (extra: Partial<Parameters<typeof judge>[0]>) => judge({ ...base, rows: greenLog, samples: inPlay, outcome: 'play', ...extra }).map(failure => failure.rule);
    expect(rules({ outcome: 'error' })).toEqual(['load-error-screen']);
    expect(rules({ outcome: 'error', proofError: 'TimeoutError: .ws-main-select' })).toEqual(['proof-error']);
    expect(rules({ outcome: 'no-resume', channel: 'preview' })).toEqual(['no-resume']);
    // GC26: preview's grid page reopens on the title as staging's does, for a shard its grid places
    expect(rules({ outcome: 'no-resume', channel: 'preview', placed: true })).toEqual([]);
    // OF9: a world build's reopened page lands on the title by design (QA 11-12 row 35); the deck is the way back in
    expect(rules({ outcome: 'no-resume', channel: 'staging', entry: 'resume', requireWorld: true })).toEqual([]);
    expect(rules({ leaks: 3 })).toEqual(['offline-leak']);
    expect(rules({ outcome: 'seat-wait', samples: [screen({ step: 'server' })], requireWorld: true })).toEqual(['not-in-world']);
    // a read cancelled by the page (or by closing the browser) is not a failed read
    expect(rules({ rows: [...greenLog, row('/assets/music/a.m4a', { servedBy: 'failed', fail: 'net::ERR_ABORTED' })] })).toEqual([]);
  });
  it('OF20: an offline entry reads the grid layout, and from the cache', () => {
    const fromNetwork = greenLog.map(entry => entry.url.includes('grid-seam-plans') ? { ...entry, servedBy: 'network' as const } : entry);
    expect(judge({ ...base, rows: fromNetwork, samples: inPlay, outcome: 'play', layout: true }).map(failure => failure.rule)).toEqual(['grid-layout-not-cached']);
    const oneShard = greenLog.filter(entry => !/grid/u.test(entry.url));
    expect(judge({ ...base, rows: oneShard, samples: inPlay, outcome: 'play', layout: true }).map(failure => failure.rule)).toEqual(['grid-layout-not-read']);
  });
  it('OF17: no image is read where the warm visit read only its KTX2 stand-in', () => {
    const warm = new Set(['/assets/gpu/nine-dragon/lab/organic/scroll.phone-580f21aa.ktx2', '/assets/nine-dragon/lab/organic/lion.webp']);
    const offline = (path: string) => judge({ ...base, shard: 'nine-dragon-stack', rows: [...greenLog, row(path)], samples: inPlay, outcome: 'play', warm }).map(failure => failure.rule);
    expect(offline('/assets/nine-dragon/lab/organic/scroll.phone.webp?v=1963d344')).toEqual(['texture-form-not-warm']);
    // the form the warm visit read, an image it read as an image, and a texture it never read are all fine here
    expect(offline('/assets/gpu/nine-dragon/lab/organic/scroll.phone-580f21aa.ktx2')).toEqual([]);
    expect(offline('/assets/nine-dragon/lab/organic/lion.webp')).toEqual([]);
    expect(offline('/assets/nine-dragon/lab/organic/leaf-atlas.webp?v=01f4261a')).toEqual([]);
  });
  it('OF21: the walk-through needs the world and then the connection card', () => {
    expect(judge({ ...base, rows: greenLog, samples: inPlay, outcome: 'play', walkthrough: true }).map(failure => failure.rule)).toEqual(['walkthrough-no-connection-card']);
    const carded = [...inPlay, screen({ t: 4000, phase: 'page', card: false, player: true, failCard: 'Can’t reach the world', text: '' })];
    expect(judge({ ...base, rows: greenLog, samples: carded, outcome: 'play', walkthrough: true })).toEqual([]);
    expect(judge({ ...base, rows: greenLog, samples: [screen({ step: 'server' })], outcome: 'seat-wait', walkthrough: true }).map(failure => failure.rule))
      .toEqual(['walkthrough-not-in-world', 'walkthrough-no-connection-card']);
  });
});
