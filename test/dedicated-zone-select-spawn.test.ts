import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, serverInput, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, type BotThumb } from './fixtures/dedicated/roomBot';

// QA 11-19 row 52 (Jake, 16:10 Cancún, staging v0.1.52): "When I went to zone select, it doesn't like force me into a spawn point in the
// zone. Like I'm just fucking stuck." He took Zone Select to Driftwood, walked out of its gate onto the road, went back to the title and
// took Zone Select to Driftwood again: the door seated him where Driftwood's save last stood, the step onto the road, so the cell
// handed him straight back out and he stood on the road outside its walls. Zone Select into a zone places the player at its spawn
// (the page's goto word says `spawn`, `gotoFirst`); a redial of the same page, or ENTER THE MMO, still comes back where it stood.
const HOME = 'driftwood-isle', CELLS = [HOME, 'far-reach', 'sunscar-dunes', 'nalati-grasslands'];
const run = (yaw: number): BotThumb => () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: NET_BUTTONS.sprint });
type Resume = { cell?: string; at?: { x: number; z: number } };
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

const inputs = new Map<string, ReturnType<typeof serverInput>>();
function selectBench(): Promise<RoomBench> {
  return roomBench({ cells: CELLS, workers: 2, crossing: true, load: slug => {
    let input = inputs.get(slug);
    if (input === undefined) { input = serverInput(slug); inputs.set(slug, input); }
    return input;
  } });
}

for (const leave of ['quit', 'drop'] as const) {
  test(`Zone Select back into Driftwood after walking onto its road (${leave}) seats the player at Driftwood's spawn`, { timeout: 180_000 }, async () => {
    bench = await selectBench();
    // CHUNK-PARAM CP5 (J522): the pick goes in the page's goto word before its hello; the socket's address stays bare
    const zoneSelect = { cell: HOME, spawn: true };
    const a = new RoomBot(bench.url, 'bench', 'device:a', 'A', 0, 0, zoneSelect); bots.push(a);
    expect(await a.arrived()).toBe(true);
    const spawn = (JSON.parse(a.resume ?? '{}') as Resume).at;
    if (spawn === undefined) throw new Error('a first visit is told the spawn');
    const home = bench.room(HOME), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
    if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
    // out of Driftwood's west entryway onto the road, and a few metres on
    body.resetPose({ x: -(CHUNK_HALF - 1), y: 1, z: 0 }, Math.PI / 2);
    a.thumb = run(Math.PI / 2);
    await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
    await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'out on the road').toBeLessThan(-(CHUNK_HALF + 3)); }, { timeout: 20_000, interval: 20 });
    // back to the title
    if (leave === 'quit') { a.quit(); await a.ended(); } else a.drop();
    // ZONE SELECT → Driftwood
    const b = new RoomBot(bench.url, 'bench', 'device:a', 'A', 0, 0, zoneSelect); bots.push(b);
    expect(await b.arrived()).toBe(true);
    const resume = JSON.parse(b.resume ?? '{}') as Resume;
    expect(resume.cell, 'told to load Driftwood').toBe(HOME);
    expect(resume.at?.x, 'told Driftwood\'s spawn').toBeCloseTo(spawn.x, 1);
    expect(resume.at?.z, 'told Driftwood\'s spawn').toBeCloseTo(spawn.z, 1);
    await vi.waitFor(() => { expect(home.holds('device:a'), 'seated in Driftwood').toBe(true); }, { timeout: 20_000, interval: 50 });
    await new Promise(resolve => { setTimeout(resolve, 1000); });
    expect(home.holds('device:a'), 'and stays there').toBe(true);
    expect(road.holds('device:a'), 'not on the road').toBe(false);
    const feet = home.bodyOf('device:a')?.position;
    expect(Math.hypot((feet?.x ?? Infinity) - spawn.x, (feet?.z ?? Infinity) - spawn.z), 'at the spawn').toBeLessThan(4);
  });
}

test('a redial of a Zone Select page (no `spawn`) comes back where the player stood in the cell', { timeout: 180_000 }, async () => {
  bench = await selectBench();
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A', 0, 0, { cell: HOME, spawn: true }); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), body = home?.bodyOf('device:a');
  if (home === undefined || body === undefined) throw new Error('Driftwood boots');
  body.resetPose({ x: 20, y: body.position.y + 1, z: 30 }, 0);
  await new Promise(resolve => { setTimeout(resolve, 500); });
  const stood = { x: body.position.x, z: body.position.z };
  a.quit(); await a.ended();
  const b = new RoomBot(bench.url, 'bench', 'device:a', 'A', 0, 0, { cell: HOME, spawn: false }); bots.push(b);
  expect(await b.arrived()).toBe(true);
  await vi.waitFor(() => { expect(home.holds('device:a')).toBe(true); }, { timeout: 20_000, interval: 50 });
  const feet = home.bodyOf('device:a')?.position;
  expect(Math.hypot((feet?.x ?? Infinity) - stood.x, (feet?.z ?? Infinity) - stood.z), 'where it stood').toBeLessThan(2);
});
