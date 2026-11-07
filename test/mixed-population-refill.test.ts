import {lendDriftwoodReturns} from './fixtures/driftwood-return-modules';
import { installMixedPopulation, type MixedPopulationInput } from '@wildshard/engine/game/population/mixedRoster';
import { orchardPopulation } from './fixtures/mixed-population';
// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier exercises the native host.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { REFILL_WAIT } from '../src/server/engine/entities/creatureRefill';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { createSimHost } from '../src/server/engine/sim';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

// J109, J108 on a mixed roster: a kind no author timed, or a tamed body of any kind, comes back in a room and only there.
/** The orchard with a second body beside its practice slot: the roster's ordinary, unruled animal. */
const orchard = (): MixedPopulationInput => orchardPopulation({ id: 'creature:1', x: 4, z: 3, seed: 8 });

async function open(players: number): Promise<{ host: ReturnType<typeof createSimHost>; population: ReturnType<typeof installMixedPopulation>; dispose: () => void }> {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  lendDriftwoodReturns(host.scope);
  const population = installMixedPopulation(host, orchard());
  for (let i = 1; i < players; i++) host.addPlayer(`bot.${String(i)}`, { x: -9, y: 2, z: -9 });
  leadPlayer(host).position.set(-9, 0, -9);
  return { host, population, dispose: () => { host.dispose(); } };
}

const seconds = (host: ReturnType<typeof createSimHost>, count: number): void => {
  for (let i = 0; i < count * 60; i++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
};
const kill = (host: ReturnType<typeof createSimHost>, id: string): void => {
  const actor = host.entities.get(id);
  if (actor === undefined) throw new Error('Missing victim');
  host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(), amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
};
const owed = (host: ReturnType<typeof createSimHost>): number => {
  const row = host.adapters.get('orchard.population')?.snapshot();
  if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error('Missing orchard save row');
  const ecology = row['ecology'];
  if (typeof ecology !== 'object' || ecology === null || Array.isArray(ecology)) throw new Error('Missing ecology row');
  const pending = ecology['pending'];
  if (!Array.isArray(pending)) throw new Error('Missing pending row');
  return pending.length;
};
const tame = (host: ReturnType<typeof createSimHost>, id: string): void => {
  const actor = host.entities.get(id);
  if (actor === undefined) throw new Error('Missing tamed body');
  host.events.emit('creature.tamed', { kind: actor.kind, variant: actor.variant, herd: 0, x: 4, z: 3, id });
};

/** Past the return's sight distance, and past a refill's nearby radius too. */
const walkAway = (host: ReturnType<typeof createSimHost>): void => {
  for (const player of host.players.values()) { player.position.set(200, 0, 200); player.motor.resetAt(player.position); }
};

test('a room brings an untimed kind back on the refill wait, sooner with players near, never in sight', async () => {
  const room = await open(2);
  try {
    kill(room.host, 'creature:1');
    seconds(room.host, 2);
    expect(owed(room.host)).toBe(1);
    // both players near run a 300 s wait in 150 s, and the body still waits for them to leave
    seconds(room.host, Math.ceil(REFILL_WAIT / 2));
    expect(owed(room.host)).toBe(1);
    walkAway(room.host);
    seconds(room.host, 3);
    expect(owed(room.host)).toBe(0);
    expect(room.population.bodies().length).toBe(3);
    expect(room.population.bodies()[2]?.actor?.alive).toBe(true);
  } finally { room.dispose(); }
}, 60_000);

test('a tame owes its spot in a room, and leaves the mount it became alive', async () => {
  const room = await open(2);
  try {
    tame(room.host, 'creature:1');
    seconds(room.host, 1);
    expect(owed(room.host)).toBe(1);
    seconds(room.host, Math.ceil(REFILL_WAIT / 2));
    walkAway(room.host);
    seconds(room.host, 3);
    expect(owed(room.host)).toBe(0);
    expect(room.population.bodies().length).toBe(3);
    expect(room.host.entities.get('creature:1')?.alive).toBe(true);
  } finally { room.dispose(); }
}, 60_000);

test('one player owes nothing for either, and their tick is the tick it was', async () => {
  const solo = await open(1), twin = await open(1);
  try {
    kill(solo.host, 'creature:1'); kill(twin.host, 'creature:1');
    tame(solo.host, 'creature:0');
    seconds(solo.host, 2); seconds(twin.host, 2);
    expect(owed(solo.host)).toBe(0);
    expect(snapshotSimHost(solo.host)).toEqual(snapshotSimHost(twin.host));
  } finally { solo.dispose(); twin.dispose(); }
}, 60_000);

/** The orchard's bound is 8: two boot bodies, the reserved guardian's slot and five spares. */
const FULL = 7;
const liveIds = (room: { population: ReturnType<typeof installMixedPopulation> }): string[] =>
  room.population.bodies().flatMap((body, i) => i > 0 && body.actor?.alive === true ? [body.id] : []);

test('at the roster bound a return takes the slot a dead body left, on and on', async () => {
  const room = await open(2);
  try {
    walkAway(room.host);
    for (let round = 0; round < FULL + 3; round++) {
      const [id] = liveIds(room); if (id === undefined) throw new Error('Missing live body');
      kill(room.host, id);
      seconds(room.host, REFILL_WAIT + 5);
      expect(owed(room.host)).toBe(0);
    }
    expect(room.population.bodies()).toHaveLength(FULL);
    expect(liveIds(room)).toHaveLength(1);
    expect(room.population.bodies().filter(body => body.actor === null)).toHaveLength(FULL - 2);
    room.population.bodies().forEach((body, i) => { expect(room.population.bodies().findIndex(other => other.id === body.id)).toBe(i); });
  } finally { room.dispose(); }
}, 120_000);

test('a roster full of living bodies forgives the return, and a full queue forgives the debt', async () => {
  const room = await open(2);
  try {
    walkAway(room.host);
    for (let round = 0; round < FULL + 3; round++) {
      const id = liveIds(room).at(-1); if (id === undefined) throw new Error('Missing live body');
      tame(room.host, id);
      seconds(room.host, REFILL_WAIT + 5);
      expect(owed(room.host)).toBe(0);
    }
    expect(room.population.bodies()).toHaveLength(FULL);
    expect(room.population.bodies().filter(body => body.actor?.alive === true)).toHaveLength(FULL);
    for (let i = 0; i < 12; i++) tame(room.host, 'creature:1');
    seconds(room.host, 1);
    expect(owed(room.host)).toBe(8);
    seconds(room.host, REFILL_WAIT + 5);
    expect(owed(room.host)).toBe(0);
  } finally { room.dispose(); }
}, 120_000);
