// oxlint-disable-next-line import/no-nodejs-modules -- rapier's own wasm, read from the tree in plain Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PASTEL_SOURCE as source, pastelAssets } from './fixtures/pastelSource';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';

const WHIP = 'weapon.pastel-whip', BOT = 'bot.one';
const rapier = await loadRapier(readFileSync(new URL('../public/assets/physics/rapier.wasm', import.meta.url)));
const assets = pastelAssets();
const ports = { rapier, quest: { fact: () => undefined, coins: () => undefined } };
function tick(sim: ShardfileSimulation, count = 1): void {
  const players = new Map([...sim.host.players.values()].map(player => [player.id, { moveX: 0, moveZ: 0, yaw: player.yaw }]));
  for (let i = 0; i < count; i++) sim.host.step(players);
}
function boot(): { sim: ShardfileSimulation; first: string } {
  const sim = createShardfileSim(source, assets, ports);
  const [first] = sim.host.players.keys();
  if (first === undefined) throw new Error('No player');
  return { sim, first };
}
const swing = (sim: ShardfileSimulation, player: string): number | null => {
  const hook = sim.itemHooks(player).get(WHIP);
  if (hook === undefined || hook === null) throw new Error('The whip has no hook');
  return hook({ tick: sim.lane?.host.currentTick ?? 0, dt: 1 / 60, action: 1, fuel: 1, cooldown: 0 });
};

describe('a room player at the script lane', () => {
  it('runs an item script as themselves', () => {
    const { sim, first } = boot();
    sim.host.addPlayer(BOT); tick(sim, 2);
    const world = sim.lane?.world, seat = world?.seatOf(BOT);
    if (world === undefined || seat === undefined) throw new Error('The bot took no seat');
    expect(seat.map(handle => world.actor(handle))).toEqual(Array.from(seat, () => BOT));
    expect(seat).not.toContain(source.items.rows.find(row => row.id === WHIP)?.hook?.entity);
    expect(swing(sim, BOT)).toBe(1);
    expect(swing(sim, first)).toBe(1);
    sim.dispose();
  });

  it('answers a prompt from their own place, and reads their own view', () => {
    const { sim, first } = boot();
    const row = source.targets.interactions[0];
    if (row === undefined) throw new Error('No authored interaction');
    sim.host.addPlayer(BOT, { x: row.at[0], y: row.at[1] - 1.68, z: row.at[2] });
    tick(sim, 2);
    expect(sim.selectedInteraction(first)).toBe(null);
    expect(sim.selectedInteraction(BOT)).toBe(row.id);
    expect(sim.interact(row.id, first)).toBe(false);
    expect(sim.interact(row.id, BOT)).toBe(true);
    tick(sim, 2);
    expect(sim.lane?.world.publicField('pastel.door.open')).toBe(1);
    expect(sim.lane?.world.view(BOT).player).toEqual(sim.lane?.world.view(first).player);
    sim.dispose();
  });

  it('leaves with their seat, and a room save holds it', () => {
    const { sim } = boot();
    sim.host.addPlayer(BOT); tick(sim, 2);
    const held = sim.lane?.world.seatOf(BOT), saved = snapshotSimHost(sim.host), { level } = sim.host;
    const installed: { value?: ShardfileSimulation } = {};
    const host = restoreSimHost(level, { rapier }, saved, fresh => { installed.value = bindShardfileSim(fresh, source, assets, { ...ports, restoring: true }); });
    const back = installed.value;
    if (back === undefined) throw new Error('Nothing installed');
    expect(back.lane?.world.seatOf(BOT)).toEqual(held);
    tick(back, 2);
    expect(back.actors.get(BOT)).toBe(held?.[0]);
    expect(swing(back, BOT)).toBe(1);
    host.removePlayer(BOT); tick(back, 1);
    expect(back.lane?.world.seatOf(BOT)).toBeUndefined();
    expect(back.actors.has(BOT)).toBe(false);
    back.dispose(); sim.dispose();
  });

  it('adds nothing to a one-player save', () => {
    const alone = boot(), visited = boot();
    visited.sim.host.addPlayer(BOT); tick(visited.sim, 1); visited.sim.host.removePlayer(BOT); tick(visited.sim, 1);
    tick(alone.sim, 2);
    expect(alone.sim.lane?.snapshot()).not.toContain('seats');
    expect(visited.sim.lane?.snapshot()).not.toContain('seats');
    const entities = (sim: ShardfileSimulation): unknown => sim.lane?.world.checkpoint();
    expect(entities(visited.sim)).toEqual(entities(alone.sim));
    alone.sim.dispose(); visited.sim.dispose();
  });
});
