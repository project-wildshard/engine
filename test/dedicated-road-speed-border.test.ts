// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { gridBoardLimitAt } from '../src/shared/game/grid/rules';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { decodeArrive, encodeEnter, type ArriveWord } from '../src/shared/engine/net/socketFrames';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { openHomeFor, openRoad } from '../src/server/host/standalone/roadWorld';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, serverInput, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb, type BotThumb } from './fixtures/dedicated/roomBot';

// MMO-PLAN MP5.1d under zone entry (J352/J353): W7h's rule is that road speed never leaves the road. No highway car exists in engine; the
// road's one fast ride is the board, 30 m/s on the deck (G60). Under J352 every cell but the home is walled and entered only by its gate,
// so the rule reads: (1) the deck lets a board 30 m/s and a cell's ground eases it to the shard's 14 (G39); (2) a body at board speed
// meets another cell's wall and gate and stays out (no tunnelling at 0.5 m a tick); (3) a gate entry takes the rider off the board and
// out of its speed, so it arrives in the cell on foot, from rest. A car, when a plan builds one, joins (2) and (3).
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });
/** The road's board speed, and how far it carries a body in one fixed tick. */
const ROAD_SPEED = 30, BOARD_STEP = ROAD_SPEED * FIXED_STEP;

test('the deck lets a board 30 m/s; over a cell\'s ground it eases to the shard\'s 14', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), [home] = assembly.cells;
  if (home === undefined) throw new Error('Missing cells');
  const deck = { x: home.origin.x + assembly.pitch / 2, y: 0.5, z: home.origin.z };
  expect(gridBoardLimitAt(assembly, deck), 'mid-road on the deck').toBe(ROAD_SPEED);
  for (const depth of [20, 100, CHUNK_HALF - 5]) {
    expect(gridBoardLimitAt(assembly, { x: home.origin.x + CHUNK_HALF - depth, y: 0.5, z: home.origin.z + 40 }), `${depth} m into the cell`).toBeLessThanOrEqual(14);
  }
});

test('a body at board speed meets another cell\'s wall and its gate, and stays out; its own home lets it in', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), [home, other] = assembly.cells;
  if (home === undefined || other === undefined) throw new Error('Missing cells');
  const road = openRoad(rapier, assembly.cells, [], assembly.cells);
  try {
    road.physics.world.step();
    /** A body 12 m outside `cell`'s east edge at `along`, driven west at 30 m/s for one second: how far past the edge it got. */
    const drive = (id: string, cell: typeof home, along: number, opens: string | null): number => {
      const start = { x: cell.origin.x + CHUNK_HALF + 12, y: 1, z: cell.origin.z + along }, body = road.addPlayer(id, start, 0);
      if (opens !== null) expect(openHomeFor(road, body.motor, opens)).toBe(true);
      const feet = { ...start };
      for (let tick = 0; tick < 1 / FIXED_STEP; tick++) body.motor.move(feet, { x: -BOARD_STEP, y: 0, z: 0 }, true);
      return cell.origin.x + CHUNK_HALF - feet.x;
    };
    expect(drive('seat:wall', other, 40, home.instance), 'another cell: held at its edge wall').toBeLessThan(0);
    const gate = drive('seat:gate', other, 0, home.instance);
    expect(gate, 'another cell\'s entryway: into its buffer').toBeGreaterThan(0);
    expect(gate, 'and held at its gate').toBeLessThan(BUFFER_DEPTH);
    expect(drive('seat:home', home, 40, home.instance), 'its own home: driven in').toBeGreaterThan(5);
  } finally { road.dispose(); }
});

// Staging's 2 workers: Driftwood with Sunscar (its west neighbour) and Far Reach on one, Nalati on the other.
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', CELLS = [HOME, 'far-reach', WEST, 'nalati-grasslands'];
const run = (yaw: number): BotThumb => () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 });
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a gate entry at board speed takes the rider off the board: it arrives in the cell on foot, from rest', { timeout: 180_000 }, async () => {
  const inputs = new Map<string, ReturnType<typeof serverInput>>();
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, load: slug => {
    let input = inputs.get(slug);
    if (input === undefined) { input = serverInput(slug); inputs.set(slug, input); }
    return input;
  } });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const arrivals: ArriveWord[] = [];
  a.transport.onControl((control, bytes) => { if (control === 'arrive') { const word = decodeArrive(bytes); if (word !== null) arrivals.push(word); } });
  const home = bench.room(HOME), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a'), edge = 562.5 - CHUNK_HALF;
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  // Off Driftwood's west entryway by input, then placed 1 m short of Sunscar's edge to run into its buffer
  body.resetPose({ x: -(CHUNK_HALF - 1), y: 1, z: 0 }, Math.PI / 2);
  a.thumb = run(Math.PI / 2);
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  const walker = road.bodyOf('device:a');
  if (walker === undefined) throw new Error('the walker stands on the road');
  walker.resetPose({ x: -(edge - 1), y: walker.position.y + 1, z: 0 }, Math.PI / 2);
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'into the buffer').toBeLessThan(-(edge + 2)); }, { timeout: 30_000, interval: 50 });
  // On the board at road speed, driving into the gate, the page says enter
  a.thumb = stillThumb;
  const rider = road.bodyOf('device:a');
  if (rider === undefined) throw new Error('the rider stands in the buffer');
  rider.setBoard(true); rider.velocity.set(-ROAD_SPEED, 0, 0);
  expect(rider.board.on, 'on the board').toBe(true);
  a.transport.control('enter', encodeEnter({ cell: WEST }));
  await vi.waitFor(() => { expect(road.entering('device:a')).toBe(WEST); }, { timeout: 5000, interval: 20 });
  const frozen = road.bodyOf('device:a');
  expect(frozen?.board.on, 'off the board at the gate').toBe(false);
  expect(Math.hypot(frozen?.velocity.x ?? Infinity, frozen?.velocity.z ?? Infinity), 'its speed gone at the gate').toBeLessThan(0.01);
  await vi.waitFor(() => { expect(arrivals).toHaveLength(1); }, { timeout: 5000, interval: 20 });
  a.transport.control('ready');
  const target = bench.room(WEST);
  if (target === undefined) throw new Error(`${WEST} boots`);
  await vi.waitFor(() => { expect(target.holds('device:a'), `seated in ${WEST}`).toBe(true); }, { timeout: 20_000, interval: 50 });
  const arrived = target.bodyOf('device:a');
  expect(arrived?.board.on, 'arrives on foot').toBe(false);
  expect(Math.hypot(arrived?.velocity.x ?? Infinity, arrived?.velocity.z ?? Infinity), 'arrives from rest, not at road speed').toBeLessThan(1);
});
