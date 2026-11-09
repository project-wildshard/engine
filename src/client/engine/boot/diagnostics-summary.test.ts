// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { diagnosticPath, diagnosticSummary, safeBootDiagnostics, DIAGNOSTIC_PRIVACY } from './diagnostics';
import type { BootTiming } from '../../../shared/engine/boot/timing';

// LD3 (J208): Jake's d91507e paste named its 34.6 s wait only as resource-N and operation-N.
const ORIGIN = 'https://wildshard-singleplayer.vercel.app';

it('names this page\'s own files by path and keeps every other URL private', () => {
  expect(diagnosticPath(`${ORIGIN}/b/d91507e-mw810im4/control-0-0-startup-BrJ0bkDk.js`, ORIGIN)).toBe('/b/d91507e-mw810im4/control-0-0-startup-BrJ0bkDk.js');
  expect(diagnosticPath(`${ORIGIN}/shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab&token=secret`, ORIGIN)).toBe('/shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab');
  expect(diagnosticPath('/assets/spawn/a.json?v=not-hex', ORIGIN)).toBe('/assets/spawn/a.json');
  expect(diagnosticPath(`${ORIGIN}/api/saves/player-123`, ORIGIN)).toBeNull();
  expect(diagnosticPath(`${ORIGIN}/players/PRIVATE_PLAYER/save.bin`, ORIGIN)).toBeNull(); // same origin is not public
  expect(diagnosticPath('//evil.example/b/x.js', ORIGIN)).toBeNull();
  expect(diagnosticPath('/version.json', ORIGIN)).toBe('/version.json');
  expect(diagnosticPath(`${ORIGIN}/assets/a%20b/c.bin`, ORIGIN)).toBe('/assets/…/c.bin');
  expect(diagnosticPath('https://api.wildshard.io/v1/hello', ORIGIN)).toBeNull();
  expect(diagnosticPath(`https://user:pass@wildshard-singleplayer.vercel.app/x.js`, ORIGIN)).toBeNull();
  expect(diagnosticPath('blob:https://wildshard-singleplayer.vercel.app/123', ORIGIN)).toBeNull();
  expect(diagnosticPath('/x.js', 'null')).toBeNull(); // an opaque origin (file:, sandboxed) names nothing
});

it('leads with the slowest step, what ran inside it and the request gap (Jake\'s 52 s reload shape)', () => {
  const page = (operation: string, start: number, end: number) => ({ realm: 'page', operation, start, end });
  const lines = diagnosticSummary([
    page('app:entry-and-session-preparation', 321, 36481), page('app:selected-discovery', 456, 35084),
    page('download:cache-check', 1200, 33300), page('game-stage:server', 40000, 45100), page('game-stage:home', 37000, 41500),
    { realm: 'service-worker', operation: 'sw:request', start: 0, end: 60000 },
  ], [
    { realm: 'page', url: '/assets/spawn/driftwood-isle-grid-phone-9eaf1a898d98629d.json', startTime: 457 },
    { realm: 'page', url: '/version.json', startTime: 600 },
    { realm: 'page', url: '/shardfiles/driftwood-isle/shard.json?v=f102bc31', startTime: 33318 },
  ]);
  expect(lines[0]).toBe('summary: slowest step app:selected-discovery · 34.6 s (0.5 s → 35.1 s)');
  expect(lines[1]).toBe('  longest inside it: download:cache-check · 32.1 s (1.2 s → 33.3 s)');
  expect(lines[2]).toBe('  no page request started for 32.7 s (0.6 s → 33.3 s); the next was /shardfiles/driftwood-isle/shard.json?v=f102bc31');
  expect(lines[3]).toBe('  next slowest: game-stage:server 5.1 s · game-stage:home 4.5 s');
  expect(diagnosticSummary([], [])).toEqual(['summary: no completed page step']);
});

it('exports engine operation and wait names, paths for own files, and still hides free text', () => {
  const own = `${location.origin}/shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab`;
  const timing = { version: 1, build: 'd91507e-mw810im4', attempt: '1', attemptCount: 1, timeOrigin: 1,
    entries: [
      { id: 1, build: null, attempt: '1', realm: 'page', operation: 'app:selected-discovery', start: 456, end: 35084, result: 'complete', detail: {} },
      { id: 2, build: null, attempt: '1', realm: 'page', operation: 'download:cache-check', start: 500, end: 33300, result: 'complete', detail: { files: 480 } },
      { id: 3, build: null, attempt: '1', realm: 'page', operation: `wait:GLTF decode ${own}`, start: 1, end: 2, result: 'complete', detail: {} },
      { id: 4, build: null, attempt: '1', realm: 'page', operation: 'wait:Player <script> name\nPRIVATE', start: 1, end: 2, result: 'complete', detail: {} },
      { id: 5, build: null, attempt: '1', realm: 'page', operation: `download:${own}`, start: 1, end: 2, result: 'complete', detail: { url: own } },
      ...['app:PRIVATE_PLAYER', 'download:PRIVATE_TOKEN', 'wait:Player Alice PRIVATE', 'wait:GLTF decode /x?token=PRIVATE',
        'wait:GLTF decode HTTPS://private.invalid/PRIVATE', 'wait:GLTF decode //private.invalid/PRIVATE', 'game-stage:PRIVATE'].map((operation, index) =>
        ({ id: 6 + index, build: null, attempt: '1', realm: 'page', operation, start: 1, end: 2, result: 'complete', detail: {} })),
      { id: 13, build: null, attempt: '1', realm: 'page', operation: 'wait:Link 29 shader programs', start: 1, end: 2, result: 'complete', detail: {} },
    ],
    resources: [{ url: own, realm: 'page', initiator: 'fetch', startTime: 33318 }, { url: 'https://private.invalid/x?t=PRIVATE', realm: 'page', startTime: 2 }],
    counters: {}, active: [],
  } as unknown as BootTiming;
  const out = safeBootDiagnostics(timing) as { exportPrivacy: string; summary: string[]; entries: { operation: string; detail: { resource?: string } }[]; resources: { url: string }[] };
  expect(out.exportPrivacy).toBe(DIAGNOSTIC_PRIVACY);
  expect(out.summary[0]).toContain('app:selected-discovery · 34.6 s');
  expect(out.entries.map(row => row.operation)).toEqual(['app:selected-discovery', 'download:cache-check',
    'wait:GLTF decode /shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab', 'operation-4', 'download:/shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab',
    'operation-6', 'download:resource-1', 'operation-8', 'operation-9', 'wait:GLTF decode resource-2', 'operation-11', 'operation-12', 'wait:Link 29 shader programs']);
  expect(out.entries[4]?.detail.resource).toBe('/shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab');
  expect(out.resources.map(row => row.url)).toEqual(['/shardfiles/driftwood-isle/discovery.json?v=dbeeb0ab', 'resource-3']);
  expect(JSON.stringify(out)).not.toContain('PRIVATE');
});
