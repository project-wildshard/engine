// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test, vi } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { NetClient } from '../src/client/engine/net/client';
import { CombatWire, type CombatEvent } from '../src/server/engine/net/combatWire';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { ConditionedTransport, directLoopback } from '../src/test/engine/netLoopback';
import { readNativeRangedItem } from '../src/server/game/plugin/nativeItems';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands, type HeadlessCommand } from '../src/shared/host/tickProtocol';
import { builtProduct } from './fixtures/builtProduct';

// P1-E5.3-I4 (J50, J127, E5-REPLICATION §6.2, §9): a real room on the shipped Pine product, a real client over conditioned
// links, Pine's lever rifle, and a boar crossing the crosshair at 6 m/s. The client fires at the boar it has been shown and
// the server rewinds to that view: within the cap the hit lands, and past it the body has gone. The P1 row's wording is read
// as two links (J127), 100 and 300 ms, each with the row's ±30 ms and 2 % loss.
const TICK_MS = 1000 / 60, X_PER_TICK = 0.1, SPAN = 4, RANGE = 9;
/** §6.1's starting delay, the longest a client renders behind: 100 ms. */
const INTERP_TICKS = 6;
/** The lever rifle's tube. */
const ROUNDS = 7;
const FREE_SHOT = { aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } };

async function shard(slug: string): Promise<TrustedHeadlessResident> {
  const rapier: Rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
const pine = (): Promise<TrustedHeadlessResident> => shard('pine-hollow');
const hold = (live: TrustedHeadlessResident): void => { for (const actor of live.host.entities.values()) actor.harnessHold = true; };
/** A seeded stream, so a link's run repeats. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
}
/** A boar on open ground, a player `RANGE` off to its side with the lever rifle up. */
function range(live: TrustedHeadlessResident): { boar: AnimalSim; centre: Vector3 } {
  const { host } = live, player = leadPlayer(host), feet = player.position;
  const boar = [...host.entities.values()].filter(row => row.kind === 'boar' && row.alive).sort((a, b) => a.position.distanceTo(feet) - b.position.distanceTo(feet))[0];
  if (boar === undefined) throw new Error('No boar');
  hold(live);
  for (const flag of ['owned:lever-rifle', 'paid:king']) host.flags.set(flag);
  const stand: HeadlessCommand = { kind: 'player', moveX: 0, moveZ: 0, yaw: player.yaw };
  for (let at = 0; at < 40; at++) { hold(live); live.step([stand, { kind: 'script', actorId: 'pine.weapon', value: 1 }]); }
  expect(readNativeRangedItem(host, 1).frame.live.has(1)).toBe(true);
  const centre = boar.position.clone();
  player.resetPose({ x: centre.x, y: host.groundHeightAt(centre.x, centre.z + RANGE), z: centre.z + RANGE }, 0);
  return { boar, centre };
}
interface Shots { fired: number; landed: number; farthest: number; lost: readonly number[] }

/** One link's run: `shots` free rifle rounds at the boar this client has been shown. */
function fire(live: TrustedHeadlessResident, rttMs: number, claimView: boolean, shots: number, seed: number): Shots {
  const { boar, centre } = range(live), link = directLoopback(), { host } = live;
  const random = seeded(seed), conditions = { latencyMs: rttMs / 2, jitterMs: 30, lossPct: 2, reorderPct: 0, random };
  const server = new ConditionedTransport(link.server, conditions), up = new ConditionedTransport(link.client, conditions);
  const client = new NetClient(up), confirmed = new Set<number>(), shown = new Map<number, Vector3>();
  let clockwise = 1, x = centre.x, farthest = 0;
  const room = new NetRoom({ world: new SimNetWorld(host), step: inputs => {
    const own = inputs[0];
    x += X_PER_TICK * clockwise; if (Math.abs(x - centre.x) > SPAN) clockwise = -clockwise;
    boar.position.x = x; boar.position.y = centre.y; boar.position.z = centre.z; boar.hp = boar.maxHp; hold(live);
    live.step(tickCommands([{ source: 'test', commands: netTickCommands(own?.command ?? null, own?.acts ?? []) }], 8));
    if (own?.command?.attack !== undefined) farthest = Math.max(farthest, host.state.tick - own.command.viewTick);
  } });
  client.onFrame(frame => {
    const handle = [...client.entities.values()].find(row => row.id === boar.entityId)?.handle, fields = handle === undefined ? null : client.fields(frame, handle);
    if (fields !== null) shown.set(frame.tick, new Vector3(Number(fields['x']), Number(fields['y']), Number(fields['z'])));
  });
  client.onCombat(event => { if (event.kind === 'hit' && event.target !== 0 && event.confirmFor !== 0) confirmed.add(event.confirmFor); });
  /** One tick's wall clock on the link, both ways. */
  const passing = (): void => { server.advance(TICK_MS); up.advance(TICK_MS); link.pump(); };
  room.join(server); client.hello(); room.open();
  for (let at = 0; at < 120 && client.latest === null; at++) { passing(); room.tick(); }
  const yawFrom = (to: Vector3, feet: Vector3): { yaw: number; pitch: number } => {
    const dx = to.x - feet.x, dy = to.y + boar.dims.bodyY * boar.scale - (feet.y + 1.68), dz = to.z - feet.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  const fired: number[] = [], feet = leadPlayer(host).position.clone();
  for (let at = 0; fired.length < shots; at++) {
    passing();
    const latest = client.latest?.tick ?? 0, view = [...shown.keys()].filter(tick => tick <= latest - INTERP_TICKS).sort((a, b) => b - a)[0];
    const seen = view === undefined ? centre : shown.get(view) ?? centre, shoot = at > 60 && at % 80 === 0;
    const command: Omit<NetCommand, 'seq'> = { viewTick: claimView ? (view ?? 0) & 0xffff : 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, ...yawFrom(seen, feet), buttons: 0, ...(shoot ? { attack: FREE_SHOT } : {}) };
    const seq = client.command(command); if (shoot) fired.push(seq);
    client.flush(); room.tick();
  }
  for (let at = 0; at < 60; at++) { passing(); room.tick(); client.flush(); }
  const before = boar.position.clone();
  room.dispose(); client.dispose();
  expect(boar.position).toEqual(before);
  return { fired: fired.length, landed: fired.filter(seq => confirmed.has(seq)).length, farthest, lost: fired.filter(seq => !confirmed.has(seq)) };
}

test('the two links of J127: a hit lands at 100 ms RTT and misses at 300 ms, and it was the rewind that landed it', async () => {
  // a tube's seven rounds a link, three seeds of jitter and loss
  for (const seed of [12648430, 3735928559, 305419896]) {
    const near = await pine(), far = await pine(), none = await pine();
    try {
      const at100 = fire(near, 100, true, ROUNDS, seed), at300 = fire(far, 300, true, ROUNDS, seed), unrewound = fire(none, 100, false, ROUNDS, seed);
      process.stdout.write(`lag comp ${JSON.stringify({ seed, at100, at300, unrewound })}\n`);
      expect(at100.landed).toBe(ROUNDS);
      expect(at300.landed).toBe(0);
      expect(unrewound.landed).toBe(0);
    } finally { near.dispose(); far.dispose(); none.dispose(); }
  }
}, 120_000);

const stillCommand = (seq: number, yaw: number, pitch: number, viewTick: number, extra: Partial<NetCommand>): NetCommand =>
  ({ seq, viewTick: viewTick & 0xffff, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch, buttons: 0, ...extra });
/** The nearest body of `kind`, with the lead `gap` short of it and looking at its chest, then held there long enough to fill the history. */
function faced(live: TrustedHeadlessResident, kind: string, gap: number): { body: AnimalSim; yaw: number; pitch: number } {
  const { host } = live, player = leadPlayer(host), feet = player.position;
  const body = [...host.entities.values()].filter(row => row.kind === kind && row.alive).sort((a, b) => a.position.distanceTo(feet) - b.position.distanceTo(feet))[0];
  if (body === undefined) throw new Error(`No ${kind}`);
  new SimNetWorld(host); hold(live);
  const { x, z } = body.position, spot = { x, z: z + gap }, y = host.groundHeightAt(spot.x, spot.z);
  player.resetPose({ ...spot, y }, 0);
  const pitch = Math.atan2(body.position.y + body.dims.bodyY * body.scale - (y + 1.68), gap);
  for (let at = 0; at < 20; at++) { hold(live); live.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]); }
  return { body, yaw: 0, pitch };
}
/** Run `ticks` of a player standing and looking with `command`'s, the body gone three metres aside from the first; the hits, as settled. */
function struck(live: TrustedHeadlessResident, body: AnimalSim, first: (seq: number) => NetCommand, then: (seq: number) => NetCommand, ticks: number): CombatEvent[] {
  const wire = new CombatWire(live.host), headAt = body.headWorld.bind(body), capsuleAt = body.bodyCapsule.bind(body), was = headAt(new Vector3()).x;
  body.position.x += 3;
  // a held body publishes no pose, so a posed one needs the jump carried to its volumes
  if (headAt(new Vector3()).x === was) {
    vi.spyOn(body, 'headWorld').mockImplementation(out => { headAt(out); out.x += 3; return out; });
    vi.spyOn(body, 'bodyCapsule').mockImplementation((rear, front) => { capsuleAt(rear, front); rear.x += 3; front.x += 3; });
  }
  for (let at = 0; at < ticks; at++) {
    hold(live); const command = at === 0 ? first(at + 1) : then(at + 1);
    live.step(tickCommands([{ source: 'test', commands: netTickCommands(command, []) }], 8));
  }
  return wire.drain().filter(row => row.kind === 'hit');
}

test('a swing sweeps the bodies its command saw, the damage lands now and each end of the wire reads its own place', async () => {
  const seeing = await shard('driftwood-isle'), blind = await shard('driftwood-isle');
  try {
    const hits = [seeing, blind].map((live, at) => {
      const { body, yaw, pitch } = faced(live, 'crab', 1.4), view = at === 0 ? live.host.state.tick : 0, was = body.position.clone(), hp = body.hp;
      const rows = struck(live, body, seq => stillCommand(seq, yaw, pitch, view, { attack: FREE_SHOT }), seq => stillCommand(seq, yaw, pitch, view, {}), 30);
      return { rows, was, now: body.position.clone(), hp: hp - body.hp };
    });
    const [seen, missed] = hits;
    expect(seen?.rows).toHaveLength(1); expect(seen?.hp).toBeGreaterThan(0);
    const hit = seen?.rows[0];
    if (hit?.kind !== 'hit' || hit.seen === undefined || seen === undefined) throw new Error('No rewound hit');
    expect(Math.hypot(hit.at[0] - seen.now.x, hit.at[2] - seen.now.z)).toBeLessThan(1.5);
    expect(Math.hypot(hit.seen[0] - seen.was.x, hit.seen[2] - seen.was.z)).toBeLessThan(1.5);
    expect(missed?.rows).toEqual([]); expect(missed?.hp).toBe(0);
  } finally { seeing.dispose(); blind.dispose(); }
}, 120_000);

test('a bolt reads the view on its first tick alone', async () => {
  const seeing = await pine(), blind = await pine();
  try {
    const rows = [seeing, blind].map((live, at) => {
      const { body, yaw, pitch } = faced(live, 'boar', 1.2), view = at === 0 ? live.host.state.tick : 0;
      return struck(live, body, seq => stillCommand(seq, yaw, pitch, view, { launcher: { slot: 0, ads: 1, fire: true } }), seq => stillCommand(seq, yaw, pitch, view, {}), 30);
    });
    expect(rows[0]).toHaveLength(1); expect(rows[1]).toEqual([]);
  } finally { seeing.dispose(); blind.dispose(); }
}, 120_000);
