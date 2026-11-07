import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The span anchors are checked against today's grid session source.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The CLI's argument refusals run in a child process, before any browser.
import { spawnSync } from 'node:child_process';
import { lapLegs, lapPops, splitRequests, splitManifests, spawnMembers, spawnRereads, neighbourSpans, splitByInitiator, NEIGHBOUR_WORK, firstSeconds, profileTop, heapTop } from '../scripts/complete-at-control-snapshot.mjs';

// a snapshot's mesh row: [uuid, chain, signature `geometry|positions|indices|material:map:width`, shown, within reach, skinned]
const row = (id, chain, geometry, map, shown = true, close = true, skinned = false) => [id, chain, `${geometry}|36|0|mat:${map}:256`, shown, close, skinned];
const sample = list => ({ scene: { list, lods: [], texturesPending: [] }, fine: [] });

test('content not resident at control is red; distance design on resident models is listed', () => {
  const at = sample([
    row('pier', 'Mesh<pier', 'g-pier', 't-wood'),
    row('cover-far', 'ground-cover-tuft-far<ground-cover', 'g-tuft-far', 't-plant', false),
    row('npc', 'Mesh<npc-castaway', 'g-npc', 't-npc', false),
    row('rock-lo', 'Mesh<rock', 'g-rock-lo', 't-rock'),
    row('rock-hi-elsewhere', 'Mesh<rock2', 'g-rock-hi', 't-rock'),
    row('crate', 'Mesh<crate', 'g-crate', 't-crate'),
  ]);
  at.scene.lods = ['tree@1'];
  const lap = [sample([
    row('pier', 'Mesh<pier', 'g-pier', 't-wood'),
    row('cover-far', 'ground-cover-tuft-far<ground-cover', 'g-tuft-far', 't-plant'),     // shown: a resident model
    row('npc', 'Mesh<npc-castaway', 'g-npc', 't-npc'),                                   // shown by distance
    row('rock-lo', 'Mesh<rock', 'g-rock-hi', 't-rock'),                                  // swapped to resident geometry
    row('crate', 'Mesh<crate', 'g-crate', 't-crate-ktx2'),                               // swapped to a texture nobody held
    row('pier-2', 'Mesh<driftwood-isle/pier<piers.world-1', 'g-pier-1', 't-wood'),     // added after control
    row('far-away', 'Mesh<far', 'g-far', 't-far', true, false),                          // beyond reach: ignored
    row('deer', 'SkinnedMesh<animals', 'g-deer', 't-deer', true, true, true),            // an actor
  ])];
  const found = lapPops(at, lap, undefined);
  expect(found.pops).toEqual(['swapped to non-resident data Mesh<crate', 'added Mesh<driftwood-isle/pier<piers.world-1']);
  expect(found.distanceLod).toEqual(['shown ground-cover-tuft-far<ground-cover', 'shown Mesh<npc-castaway', 'swapped Mesh<rock']);
  expect(found.lods).toEqual(['tree@1']);
  expect(found.actors).toEqual(['SkinnedMesh<animals']);
});

test('a lap that changes nothing has no pops and no distance LOD', () => {
  const at = sample([row('a', 'Mesh<a', 'g-a', 't-a')]);
  expect(lapPops(at, [sample([row('a', 'Mesh<a', 'g-a', 't-a')])], undefined)).toEqual({ fine: [], pops: [], neighbourPops: [], actors: [], distanceLod: [], lods: [], textures: [], reattached: [] });
});

test('in the grid, a mesh under another cell is the neighbour\'s', () => {
  const at = sample([]);
  const found = lapPops(at, [sample([row('n', 'Mesh<region-scene:far-reach<region:far-reach', 'g-n', 't-n'), row('h', 'Mesh<region:driftwood-isle', 'g-h', 't-h')])], 'driftwood-isle');
  expect(found.neighbourPops).toEqual(['added Mesh<region-scene:far-reach<region:far-reach']);
  expect(found.pops).toEqual(['added Mesh<region:driftwood-isle']);
});

test('a worker fetch the page never requests in the visit is precache; any page request stays the level\'s (G872 (a))', () => {
  const level = url => !url.includes('/version.json');
  const rows = [
    { url: 'https://x.test/assets/late-Explore-a1.js', by: 'service-worker', start: 50, end: 60 },   // offline precache: never read by the page
    { url: 'https://x.test/assets/packs/spawn-b2.bin', by: 'service-worker', start: 10, end: 40 },   // the worker fetches it ...
    { url: 'https://x.test/assets/packs/spawn-b2.bin?v=1', by: 'page', start: 30, end: null },        // ... while the page still reads it
    { url: 'https://x.test/assets/main-d4.js', by: 'page', start: 1, end: 5 },                        // the page read it before control ...
    { url: 'https://x.test/assets/main-d4.js', by: 'service-worker', start: 70, end: 80 },           // ... and the worker caches it later
    { url: 'https://x.test/assets/gpu/horizon/day-c3.ktx2', by: 'page', start: 90, end: 95 },         // a page read answered from the worker's cache
    { url: 'https://x.test/assets/gpu/horizon/day-c3.ktx2', by: 'service-worker', start: 85, end: 99 },// the worker fetching it for that read
    { url: 'https://x.test/version.json', by: 'service-worker', start: 1, end: 2 },                   // not level content at all
  ];
  const { level: levelRows, precache } = splitRequests(rows, level);
  expect(precache.map(entry => entry.url)).toEqual(['https://x.test/assets/late-Explore-a1.js', 'https://x.test/assets/main-d4.js']);
  expect(levelRows.map(entry => `${entry.by} ${entry.url}`)).toEqual(['service-worker https://x.test/assets/packs/spawn-b2.bin', 'page https://x.test/assets/packs/spawn-b2.bin?v=1',
    'page https://x.test/assets/main-d4.js', 'page https://x.test/assets/gpu/horizon/day-c3.ktx2', 'service-worker https://x.test/assets/gpu/horizon/day-c3.ktx2']);
});

test('the server worker\'s code and server class are listed apart; anything else it fetches stays level content', () => {
  const level = url => /\/(?:shardfiles|assets\/spawn|b)\//u.test(url);
  const rows = [
    { url: 'https://x.test/assets/spawn/server-abc.json', by: 'page', start: 1, end: 2 },
    { url: 'https://x.test/b/abc/standalone/serverWorker-d1.js', by: 'page', start: 1, end: 2 },
    { url: 'https://x.test/shardfiles/nine/blobs/bin/a.bin', by: 'page', start: 3, end: 4 },
    { url: 'https://x.test/b/abc/assets/main-d4.js', by: 'page', start: 3, end: 4 },
  ];
  const { level: levelRows, server } = splitRequests(rows, level);
  expect(server.map(entry => new URL(entry.url).pathname)).toEqual(['/assets/spawn/server-abc.json', '/b/abc/standalone/serverWorker-d1.js']);
  expect(levelRows.map(entry => new URL(entry.url).pathname)).toEqual(['/shardfiles/nine/blobs/bin/a.bin', '/b/abc/assets/main-d4.js']);
});

test('DL25: a part\'s member moved over the network again is counted, unless its part failed or a worker answered', () => {
  const manifest = { files: [{ url: '/shardfiles/nine/a.bin' }, { url: '/assets/physics/rapier.wasm?v=2935a533' }, { url: '/shardfiles/nine/shard.json?v=1' }], parts: [{ members: [[0, 0], [1, 16]] }] };
  const members = spawnMembers(manifest);
  expect([...members]).toEqual(['/shardfiles/nine/a.bin', '/assets/physics/rapier.wasm']);
  const rows = [
    { url: 'https://x.test/assets/physics/rapier.wasm', bytes: 836_316, start: 20 },
    { url: 'https://x.test/shardfiles/nine/a.bin?v=1', bytes: 0, start: 20 },
    { url: 'https://x.test/shardfiles/nine/a.bin', bytes: 7, start: 5 }, // the title's, before the manifest
    { url: 'https://x.test/shardfiles/nine/shard.json', bytes: 9, start: 20 },
  ];
  expect(spawnRereads(rows, members, 10)).toEqual({ files: 1, bytes: 836_316, first: ['/assets/physics/rapier.wasm'] });
  expect(spawnRereads(rows, members, 10, true).files).toBe(0);
  expect(spawnRereads(rows, members, null).files).toBe(0);
  expect(spawnMembers({ files: [] }).size).toBe(0);
});

test('a model re-attached by the ring after control is listed, a new one is a pop (DL5 target)', () => {
  const at = sample([row('pier-a', 'Mesh<driftwood-isle/pier<piers.world-0<Scene', 'g-pier', 't-wood')]);
  const found = lapPops(at, [sample([row('pier-b', 'Mesh<driftwood-isle/pier<Scene', 'g-pier-2', 't-wood'), row('crate', 'Mesh<crate<Scene', 'g-crate', 't-crate')])], undefined);
  expect(found.reattached).toEqual(['re-attached Mesh<driftwood-isle/pier<Scene']);
  expect(found.pops).toEqual(['added Mesh<crate<Scene']);
});

test('a look-alike is a pop: another texture, or the control mesh never retired (sp-x9)', () => {
  const at = sample([row('pier-a', 'Mesh<driftwood-isle/pier<piers.world-0<Scene', 'g-pier', 't-wood')]);
  // the original left the scene, but the newcomer draws another texture: new content, not the same model
  const retexture = lapPops(at, [sample([row('pier-b', 'Mesh<driftwood-isle/pier<Scene', 'g-pier-2', 't-gold')])], undefined);
  expect(retexture.reattached).toEqual([]); expect(retexture.pops).toEqual(['added Mesh<driftwood-isle/pier<Scene']);
  // same signature, but the control mesh is still there: a second copy appeared, nothing was re-attached
  const extra = lapPops(at, [sample([row('pier-a', 'Mesh<driftwood-isle/pier<piers.world-0<Scene', 'g-pier', 't-wood'), row('pier-b', 'Mesh<driftwood-isle/pier<Scene', 'g-pier-2', 't-wood')])], undefined);
  expect(extra.reattached).toEqual([]); expect(extra.pops).toEqual(['added Mesh<driftwood-isle/pier<Scene']);
});

test('a shared fetch only neighbour work asked for is the neighbour\'s; no stack or home work stays red (G872)', () => {
  const source = ['class S {', '  private tileAdmission(r) {', '    admit();', '  }', '  private refuse(c) {}', '}'].join('\n');
  const spans = neighbourSpans(() => source, [{ file: 'src/client/game/grid/session.ts', what: 'tile views', from: /^\s*private tileAdmission\(/u, to: /^\s*private refuse\(/u }]);
  expect(spans).toEqual([{ file: 'src/client/game/grid/session.ts', what: 'tile views', from: 2, to: 5 }]);
  const at = (line) => ({ src: `build-mirror/check/tree/src/client/game/grid/session.ts:${line}` }), home = { src: 'src/client/game/session/finish.ts:300' };
  const trace = {
    initiators: [
      { url: 'https://x.test/basis/basis_transcoder.wasm', frames: [{ src: null }, at(3)] },        // the neighbour's tile views
      { url: 'https://x.test/assets/a.worker.js', frames: [] },                                      // a worker script: no stack ...
      { url: 'https://x.test/assets/mixed.js', frames: [at(3)] }, { url: 'https://x.test/assets/mixed.js', frames: [home] },
      { url: 'https://x.test/shardfiles/driftwood-isle/blobs/glb/h', frames: [at(3)] },             // names the level: never moved
    ],
    workers: [{ url: 'https://x.test/assets/a.worker.js', frames: [at(4)] }, { url: 'https://x.test/assets/b.worker.js', frames: [] }],
  };
  const after = ['https://x.test/basis/basis_transcoder.wasm', 'https://x.test/assets/a.worker.js', 'https://x.test/assets/b.worker.js',
    'https://x.test/assets/mixed.js', 'https://x.test/shardfiles/driftwood-isle/blobs/glb/h', 'https://x.test/assets/none.js'].map(url => ({ url, by: 'page' }));
  after.push({ url: 'https://x.test/assets/a.worker.js?v=2', by: 'service-worker' });
  const { level, neighbour } = splitByInitiator(after, trace, spans, url => url.includes('/shardfiles/'));
  expect(neighbour.map(entry => `${entry.by} ${new URL(entry.url).pathname} ${entry.work}`)).toEqual(['page /basis/basis_transcoder.wasm tile views', 'page /assets/a.worker.js tile views', 'service-worker /assets/a.worker.js tile views']);
  expect(level.map(entry => new URL(entry.url).pathname)).toEqual(['/assets/b.worker.js', '/assets/mixed.js', '/shardfiles/driftwood-isle/blobs/glb/h', '/assets/none.js']);
});

test('unknown initiator evidence vetoes the neighbour verdict per request (sp-x1)', () => {
  const spans = [{ file: 'src/client/game/grid/session.ts', what: 'tile views', from: 2, to: 5 }];
  const near = { src: 'src/client/game/grid/session.ts:3' }, home = { src: 'src/client/game/session/finish.ts:300' };
  const page = (url, ms) => ({ url: `https://x.test${url}`, by: 'page', msAfterControl: ms });
  const split = (after, trace) => splitByInitiator(after, trace, spans, () => false).neighbour.map(entry => new URL(entry.url).pathname);
  // two reads, one neighbour stack and one stackless fetch that no worker constructor explains
  expect(split([page('/assets/shared.js', 1), page('/assets/shared.js', 2)],
    { initiators: [{ ...page('/assets/shared.js', 1), frames: [near] }, { ...page('/assets/shared.js', 2), frames: [] }], workers: [] })).toEqual([]);
  // two reads, but the trace saw only one of them
  expect(split([page('/assets/shared.js', 1), page('/assets/shared.js', 2)], { initiators: [{ ...page('/assets/shared.js', 1), frames: [near] }], workers: [] })).toEqual([]);
  // a worker script fetched twice: each fetch takes its own constructor, in order; the home's second one keeps it red
  const fetched = { initiators: [{ ...page('/assets/w.js', 10), frames: [] }, { ...page('/assets/w.js', 40), frames: [] }],
    workers: [{ ...page('/assets/w.js', 9), frames: [near] }, { ...page('/assets/w.js', 39), frames: [home] }] };
  expect(split([page('/assets/w.js', 10), page('/assets/w.js', 40)], fetched)).toEqual([]);
  fetched.workers[1].frames = [near];
  expect(split([page('/assets/w.js', 10), page('/assets/w.js', 40)], fetched)).toEqual(['/assets/w.js', '/assets/w.js']);
  // a fetch with its own neighbour stack still owns its constructor: the home's second constructor vetoes (sp-x1)
  const mixed = { initiators: [{ ...page('/assets/w.js', 10), frames: [near] }, { ...page('/assets/w.js', 40), frames: [] }],
    workers: [{ ...page('/assets/w.js', 9), frames: [near] }, { ...page('/assets/w.js', 39), frames: [home] }] };
  expect(split([page('/assets/w.js', 10), page('/assets/w.js', 40)], mixed)).toEqual([]);
  // fewer constructors than fetches of a worker script: the unpaired fetch vetoes
  expect(split([page('/assets/w.js', 10), page('/assets/w.js', 40)], { ...mixed, workers: [mixed.workers[0]] })).toEqual([]);
});

test('the neighbour spans refuse a missing or doubled anchor, and today\'s session source has each once', () => {
  expect(() => neighbourSpans(() => 'private tileAdmission(\nprivate tileAdmission(\nprivate refuse(', [NEIGHBOUR_WORK[4]])).toThrow(/single/u);
  const spans = neighbourSpans(file => readFileSync(file, 'utf8'));
  expect(spans.map(span => span.what)).toEqual(NEIGHBOUR_WORK.map(span => span.what));
});

test('the boost lap drives route legs and names the containment legs it skips', () => {
  const leg = (name, x, z, inside) => ({ name, start: { x, z, y: 0 }, waypoints: [{ x: x + 1, z }], ...(inside ? { inside: { x0: 0, x1: 1, z0: 0, z1: 1, floor: 0 } } : {}) });
  const all = [leg('route', 0, 0), leg('escape-wall', 1, 1, true), leg('far', 500, 0)];
  const { legs, skipped } = lapLegs(all, [10, 20], [10, 20], 220);
  expect(legs.map(l => l.name)).toEqual(['route']);
  expect(legs[0]).toEqual({ name: 'route', start: { x: 10, z: 20, y: 0 }, points: [[11, 20]], boost: true });
  expect(skipped).toEqual(['escape-wall']);
  // out of reach is neither driven nor named
  expect(skipped).not.toContain('far');
});

test('the first seconds after control: fps per second, the worst frame and the long ones (G1008)', () => {
  const frames = [[0, 16], [16, 16], [32, 4432], [4464, 16], [4480, 120], [4600, 16]];
  const read = firstSeconds(frames, 5);
  expect(read.fps).toEqual([3, 0, 0, 0, 3]);
  expect(read.worstMs).toBe(4432); expect(read.over250).toBe(1); expect(read.over100).toBe(2);
  expect(read.long).toEqual([{ at: 32, ms: 4432 }, { at: 4480, ms: 120 }]);
});

test('a CPU profile reads as self time by mapped function and inclusive time by file', () => {
  const frame = (functionName, url, lineNumber) => ({ functionName, url, lineNumber, columnNumber: 0 });
  const profile = { nodes: [
    { id: 1, callFrame: frame('(root)', '', 0), children: [2, 4] },
    { id: 2, callFrame: frame('a', 'https://x/assets/main.js', 9), children: [3] },
    { id: 3, callFrame: frame('b', 'https://x/assets/main.js', 19), children: [] },
    { id: 4, callFrame: frame('(garbage collector)', '', 0), children: [] },
  ], samples: [3, 3, 2, 4], timeDeltas: [1000, 1000, 2000, 500] };
  const sourceOf = f => (f.line === 10 ? 'src/a.ts:10 a' : f.line === 20 ? 'src/b.ts:20 b' : null);
  const top = profileTop(profile, sourceOf);
  expect(top.totalMs).toBe(5); // 4.5 ms rounds up
  expect(top.self).toEqual([['src/b.ts:20 b', 2], ['src/a.ts:10 a', 2], ['(garbage collector)', 1]]); // ties keep sampling order
  expect(top.files).toEqual([['src/a.ts', 4], ['src/b.ts', 2]]);
});

test('a route leg marked lap.boost false is driven without boost; every other leg keeps it (D226)', () => {
  const leg = (name, extra = {}) => ({ name, start: { x: 0, z: 0 }, waypoints: [{ x: 1, z: 0 }], ...extra });
  const { legs } = lapLegs([leg('road'), leg('hover bridge', { lap: { boost: false, why: 'narrow sloping bridge' } })], [0, 0], [0, 0], 100);
  expect(legs.map(l => [l.name, l.boost])).toEqual([['road', true], ['hover bridge', false]]);
});

test('a heap snapshot reads as self size by type and constructor (D227)', () => {
  const heap = { snapshot: { meta: { node_fields: ['type', 'name', 'id', 'self_size'], node_types: [['hidden', 'object', 'native', 'string']] } },
    strings: ['Float32Array', 'ArrayBuffer', ''], nodes: [1, 0, 1, 3_000_000, 1, 0, 2, 1_000_000, 2, 1, 3, 5_000_000, 3, 2, 4, 200_000] };
  expect(heapTop(heap)).toEqual({ totalMB: 9.2, top: [['native ArrayBuffer', 5], ['object Float32Array', 4], ['string (string)', 0.2]] });
});

test('--frames is a whole number of seconds, 1 to 600: a window that never ends or fills no bucket refuses (sp-x9, C12)', () => {
  const run = frames => spawnSync(process.execPath, ['scripts/complete-at-control.mjs', '--base=http://127.0.0.1:1/', '--rev=0000000', '--flow=pine-hollow',
    `--frames=${frames}`, '--heap=on', '--out=tmp/complete-at-control/refused.json'], { encoding: 'utf8', timeout: 20_000 });
  for (const bad of ['Infinity', '0.5', '0', '-3', '601', '1e2', '30s']) {
    const result = run(bad); expect(result.status, bad).toBe(2); expect(result.stderr).toContain('bad --frames');
  }
});

test("a neighbour's packs are listed apart and leave the home's DL25 members alone (G828)", () => {
  const home = { shard: 'driftwood-isle', files: [{ url: '/shardfiles/driftwood-isle/shard.json' }], parts: [{ url: '/assets/spawn/parts/a.pack.br', members: [[0, 0, 1]] }] };
  const other = { shard: '_template', files: [{ url: '/shardfiles/_template/sections/world/tiles.json' }], parts: [{ url: '/assets/spawn/parts/b.pack.br', members: [[0, 0, 1]] }] };
  const rows = [{ at: 7, path: '/assets/spawn/_template-client-phone-1.json', manifest: other }, { at: 9, path: '/assets/spawn/driftwood-isle-client-phone-2.json', manifest: home }];
  const { members, listedAt, packs } = splitManifests(rows, shard => shard === '_template');
  expect([...members]).toEqual(['/shardfiles/driftwood-isle/shard.json']);
  expect(listedAt).toBe(9);
  expect([...packs]).toEqual(['/assets/spawn/_template-client-phone-1.json', '/assets/spawn/parts/b.pack.br']);
  // on one shard's page nothing is a neighbour, so every manifest stays DL25's
  expect(splitManifests(rows, () => false).listedAt).toBe(7);
  expect(splitManifests(rows, () => false).packs.size).toBe(0);
});
