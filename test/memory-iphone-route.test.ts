// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13): the route bench's numbers. The device half runs on the iPhone 13
// (meta project/evidence/iphone13-driftwood/).
import { expect, test } from 'vitest';
import { FRAME_LOG_READ, FRAME_LOG_START, gapWork, nameLongFrames, otherKind, OWNER_CENSUS } from '../src/scripts/memory/iphone/census.mjs';
import { fenceFrames, fenceWaits } from '../src/scripts/memory/iphone/gpuFence.mjs';
import { linkStages, linkTable } from '../src/scripts/memory/iphone/link.mjs';
import { legSummary, routeFor, routeTable, worstSegment, type LegSample } from '../src/scripts/memory/iphone/route.mjs';

const second = (frameMs: number[], extra: Partial<LegSample> = {}): LegSample => ({ seconds: 1, frames: frameMs.length, frameMs,
  updateMs: frameMs.map(() => 4), renderMs: frameMs.map(() => 6), gpuApproxMs: frameMs.map(() => 1), draws: 80, triangles: 700_000,
  programs: 120, delayMs: 100, jitterMs: 10, ...extra });

test('a leg counts its frames, its spikes over 33 and 50 ms, and its rate per 30 s', () => {
  const steady = Array.from({ length: 30 }, () => 33.3);
  const s = legSummary([second(steady), second([...steady.slice(0, 27), 60, 80, 34.5])]);
  expect(s.fps).toBe(30);
  expect(s.over50).toBe(2);
  expect(s.over33).toBe(3);
  expect(s.over50Per30s).toBe(30);
  expect(s.maxMs).toBe(80);
  expect(s.p50Ms).toBe(33.3);
  expect(s.programsMax).toBe(120);
  expect(s.delayMs).toBe(100);
});

test('a worker-free page reads no delay rather than zero', () => {
  const summary = legSummary([second([16.7], { delayMs: null, jitterMs: null })]);
  expect(summary.delayMs).toBeNull();
  expect(summary.receiptSpacingP95Ms).toBeNull();
  expect(summary.receiptSpacingMaxMs).toBeNull();
});

test('receipt spacing is summarized over packet samples and retains its worst interval', () => {
  const summary = legSummary([
    second([33], { jitterMs: 150, receiptSpacingErrorsMs: [150] }),
    second([33], { jitterMs: 145, receiptSpacingErrorsMs: Array<number>(29).fill(6) }),
  ]);
  expect(summary.receiptSpacingP95Ms).toBe(6);
  expect(summary.receiptSpacingMaxMs).toBe(150);
  expect(summary.jitterMs).toBe(145);
});

test('the worst segment is the highest median p95 at that cap', () => {
  const leg = (name: string, cap: number, p95Ms: number) => ({ name, cap, error: null, nav: null,
    summary: { ...legSummary([second([16.7])]), p95Ms, over50Per30s: 0 } });
  const report = [{ legs: [leg('dock', 30, 40), leg('beach', 30, 70), leg('beach', 60, 90)] }, { legs: [leg('dock', 30, 45), leg('beach', 30, 50)] }];
  expect(worstSegment(report, 30).map(row => row.name)).toEqual(['beach', 'dock']);
  expect(worstSegment(report, 30)[0]?.p95Ms).toBe(50);
  expect(routeTable(report[0]?.legs ?? [])).toContain('| beach | 30 |');
});

test("Driftwood's route starts at the dock and ends in a fight", () => {
  const route = routeFor('driftwood-isle');
  expect(route[0]).toMatchObject({ name: 'dock spawn', kind: 'stand', seconds: 30 });
  expect(route.at(-1)?.kind).toBe('fight');
  expect(() => routeFor('nowhere')).toThrow(/No route for nowhere/u);
});

test('the link table times each stage from the last mark and names the biggest', () => {
  const at = { menu: 1.5, deck: 2, enter: 3, startDone: 4, downloadDone: 20, loadDone: 50, control: 52 };
  expect(linkStages(at)).toEqual({ menu: 1.5, 'zone select': 0.5, 'enter zone': 1, start: 1, download: 16, load: 30, 'to control': 2 });
  expect(linkStages({ menu: 1, control: 9 })['to control']).toBe(8);
  const table = linkTable([{ kind: 'cold', at }, { kind: 'cold', at: { ...at, control: null }, error: 'never reached control in 300 s' }]);
  expect(table).toContain('Biggest stage, cold: **load**, median 30 s.');
  expect(table).toContain('**cold median** (1)');
});

test('the owner census sums each pass\'s draws by owner, per frame, and puts the renderer back', async () => {
  const info = { render: { triangles: 0, calls: 0 } }, scene = { name: '', type: 'Scene', parent: null };
  const palm = { name: 'palm', type: 'Mesh', parent: scene }, rock = { name: 'rock', type: 'Mesh', parent: scene };
  const renderer = {
    info,
    renderBufferDirect(...args: unknown[]): void { info.render.calls += 1; info.render.triangles += args[4] === palm ? 300 : 100; },
    shadowMap: { autoUpdate: true, render(): void { renderer.renderBufferDirect(0, 0, 0, 0, palm); } },
  };
  const draw = renderer.renderBufferDirect, game = { frameCount: 0, lastFrame: null, renderer };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['window'] = { __wildshard: { world: { game } } };
  globals['requestAnimationFrame'] = (frame: () => void): void => {
    setTimeout(() => { game.frameCount++; renderer.shadowMap.render(); renderer.renderBufferDirect(0, 0, 0, 0, palm); renderer.renderBufferDirect(0, 0, 0, 0, rock); frame(); }, 0);
  };
  try {
    // oxlint-disable-next-line no-new-func -- the census is an in-page body, run here as the inspector runs it
    const body = new Function(OWNER_CENSUS) as (...args: unknown[]) => void;
    const result = await new Promise<{ frames: number; owners: [string, number, number][] }>((done) => { body(2, done); });
    expect(result.frames).toBe(2);
    expect(result.owners).toEqual([['shadow|Scene>palm', 1, 300], ['main|Scene>palm', 1, 300], ['main|Scene>rock', 1, 100]]);
    expect(renderer.renderBufferDirect).toBe(draw);
  } finally { delete globals['window']; delete globals['requestAnimationFrame']; }
});

test('the route frame log keeps the dock and its upload after more than 4,000 frames', () => {
  let tick: (time: number) => void = () => undefined;
  const gl = { bufferSubData: (..._args: unknown[]): void => undefined };
  const renderer = { render: () => undefined, getContext: () => gl, info: { render: { triangles: 0 }, memory: { geometries: 0 } } };
  const page = { __wildshard: { world: { game: { renderer, scene: Object.create(null) as object } } } };
  const start = new Function('window', 'requestAnimationFrame', 'performance', FRAME_LOG_START);
  const read = new Function('window', FRAME_LOG_READ);
  expect(start(page, (next: typeof tick) => { tick = next; }, { now: () => 0 })).toBe('logging');
  tick(16);
  gl.bufferSubData(0, 4096, new Uint16Array(100), 5, 20);
  tick(32);
  tick(92);
  for (let frame = 1; frame <= 4100; frame++) {
    renderer.render();
    renderer.render();
    if (frame === 4100) renderer.render();
    tick(92 + frame * 16);
  }
  const log = read(page) as { count: number; from: number; frames: number[][] };
  expect(log.count).toBe(4103);
  expect(log.from).toBe(16);
  expect(log.frames.map(frame => [frame[0], frame[1], frame[5], frame[9]])).toEqual([[32, 16, 40, 0], [92, 60, 0, 0],
    [65_676, 16, 0, 2], [65_692, 16, 0, 3]]);
});

test('a long frame is named by what ran in the interval before it: a collection, a link, an upload, the update or the render', () => {
  // [page ms, interval, links, tex, texels, buffer bytes, tris, geos, new programs, renders, uniform ms, slow programs, split, systems, slowest draw]
  const frame = (at: number, ms: number, extra: Record<number, unknown> = {}): unknown[] => {
    const row: unknown[] = [at, ms, 0, 0, 0, 0, 0, 0, '', 2, 0, '', [4, 5, 4, 5], '', null];
    for (const [i, v] of Object.entries(extra)) row[Number(i)] = v;
    return row;
  };
  const frames = [
    frame(1000, 33), frame(1060, 60),                                          // nothing in the game: other, unless a collection
    frame(2000, 33, { 12: [31, 5, 4, 5], 13: 'player.update:26' }), frame(2055, 55), // the update before it
    frame(3000, 33, { 5: 24_000_000, 12: [3, 40, 4, 5], 14: [28, 'Scene>grid-deck'] }), frame(3090, 90), // upload, then render
    frame(4000, 33, { 2: 1, 8: 'graph:material:kit' }), frame(4052, 52),       // a link
    frame(5000, 60),                                                           // no frame before it kept: the older split
  ];
  const named = nameLongFrames(frames, [['full', 1010, 1030]]);
  expect(named.map(n => n.cause)).toEqual(['gc', 'update', 'upload', 'compile', 'other']);
  expect(named[0]?.causes).toEqual(['gc full 20']);
  expect(named[1]?.causes).toEqual(['update 31 player.update:26']);
  expect(named[2]?.causes).toEqual(['upload 24.0 MB', 'render 40 (draw 28 ms Scene>grid-deck)']);
  expect(named[3]?.causes).toEqual(['compile graph:material:kit']);
  expect(nameLongFrames(frames, [['partial', 1010, 1015]])[0]?.cause).toBe('other'); // under 10 ms of collection
});

test('DF8 (mini-driftwood13i): gapWork names the GPU waits and long timers inside a long frame, longest first', () => {
  const named = [{ at: 1060, ms: 60 }, { at: 2000, ms: 55 }];
  const log = { reads: [[1020, '2d.getImageData', 41], [1950, 'gl.readPixels', 5]] as [number, string, number][], tasks: [[1005, 'setTimeout:look', 9], [1500, 'setTimeout:far', 30]] as [number, string, number][] };
  expect(gapWork(named, log)).toEqual([['2d.getImageData:41', 'setTimeout:look:9'], ['gl.readPixels:5']]);
  expect(gapWork(named, {})).toEqual([[], []]);
});

test('DF8 (mini-driftwood13m): an other frame is a stamped callback, held by unwrapped work, or free', () => {
  const stamps: [number, [number, number, string][], number, number, number?][] = [
    [1100, [[1010, 30, 'event.Worker.message:onWorker'], [1000, 12, 'raf:tick']], 0, 0],
    [1200, [[1150, 40, 'raf:t=>{if(e!==this.epoch)return}']], 35, 50],
    [1300, [], 3, 3],
    [1500, [], 40, 40, 1],
  ];
  const at = (ms: number) => ({ at: ms, ms: 60, cause: 'other' });
  expect(otherKind(at(1100), { stamps })).toBe('task event.Worker.message:onWorker');
  expect(otherKind(at(1200), { stamps })).toBe('held');
  expect(otherKind(at(1300), { stamps })).toBe('free');
  expect(otherKind(at(1400), { stamps })).toBeNull();
  expect(otherKind(at(1500), { stamps })).toBe('held gc');
  expect(otherKind(at(1100), {})).toBeNull();
  expect(gapWork([at(1100)], { stamps })).toEqual([['event.Worker.message:onWorker:30', 'raf:tick:12', 'probe late max 0 sum 0']]);
});

// DF8 (mini-driftwood13n): a long frame's fences (issued in it or in the 40 ms before) and full collections
test('a long frame reads its fences and full collections', () => {
  const log = { fences: [[960, 1000, 2, 0], [1000, 1060, 2, 0], [1010, 1100, 3, 1], [1210, 1243, 2, 0]] as [number, number, number, number][],
    full: [[1020, 1050], [3000, 3033]] as [number, number][] };
  const [long, quiet] = fenceFrames([{ at: 1060, ms: 60 }, { at: 1300, ms: 55 }], log);
  expect(long).toEqual({ at: 1060, fences: [[40, 2, 0], [60, 2, 0], [90, 3, 1]], full: 1, gpu: true });
  expect(quiet).toEqual({ at: 1300, fences: [[33, 2, 0]], full: 0, gpu: false });
  expect(fenceFrames([{ at: 1060, ms: 60 }], { fences: [[1000, 1040, 2, 9]] })[0]?.gpu).toBe(true); // a slow status call
  expect(fenceWaits(log)).toEqual({ 2: 3, 3: 1 });
  expect(fenceFrames([{ at: 10, ms: 60 }], null)).toEqual([{ at: 10, fences: [], full: 0, gpu: false }]);
});
