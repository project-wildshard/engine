// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { eliteNetView } from '../src/shared/engine/sim/encounterRows';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { EliteCore, memoryElitePersistence, type EliteCoreEntry, type EliteCoreScript } from '../src/shared/game/eliteSystem';
import { eliteDrops } from '../src/server/game/quest/eliteDrops';
import { SIM_LEVEL } from './fixtures/sim-level/level';

interface Body { entityId: string; alive: boolean; position: { x: number; y: number; z: number }; hp: number; maxHp: number; lastHitT: number }
type Script = EliteCoreScript<Body>;
let R: Rapier;
beforeAll(async () => { R = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

/** A lair with one body, already out, on a real host. */
function lair(skin: string | null): { core: EliteCore<Script>; entry: EliteCoreEntry<Script>; host: ReturnType<typeof createSimHost>; body: Body } {
  const host = createSimHost(SIM_LEVEL, { rapier: R });
  const body: Body = { entityId: 'lair.body', alive: true, position: { x: 4, y: 0, z: 4 }, hp: 10, maxHp: 10, lastHitT: -1 };
  const script: Script = { def: { id: 'lair', lair: { x: 4, z: 4, r: 3 }, awareR: 1, engageR: 1, leashR: 900, rule: 'always', respawnMin: 9, drop: { skin } }, animal: body, spawn: () => undefined, despawn: () => undefined, tick: () => undefined, enterPhase2: () => undefined, reset: () => undefined, trophy: () => undefined };
  const drops = eliteDrops<Script>(host), core = new EliteCore<Script>({ players: host.players, condition: () => true }, drops.hooks, 'level', memoryElitePersistence());
  drops.bind(core);
  const entry = core.add(script); entry.state = 'idle';
  return { core, entry, host, body };
}
const player = (host: ReturnType<typeof createSimHost>): { id: string; position: { set: (x: number, y: number, z: number) => unknown } } => {
  const first = [...host.players.values()][0]; if (first === undefined) throw new Error('No player'); return first;
};

test('a first kill lays its orb on the row, out of reach is refused, and a press in reach takes it for good', () => {
  const { core, entry, host, body } = lair('sabre'), runner = player(host), claim = (): void => { actRoutes(host).claims.get('lair.reward')?.(runner.id); };
  try {
    runner.position.set(40, 0, 40);
    body.alive = false; core.update(0.1, 1);
    const orb = eliteNetView(entry).reward;
    expect(orb?.x).toBe(4); expect(orb?.z).toBe(4);
    claim();
    expect(eliteNetView(entry).reward, 'a press from afar changes nothing').not.toBeNull();
    expect(core.record('lair')?.skinTaken).toBe(false);
    runner.position.set(4, orb?.y ?? 0, 5);
    claim();
    expect(eliteNetView(entry).reward).toBeNull();
    expect(core.record('lair')?.skinTaken).toBe(true);
    entry.drop = null; entry.state = 'idle'; core.update(0.1, 2);
    expect(eliteNetView(entry).reward, 'the next kill drops none').toBeNull();
  } finally { host.scope.dispose(); }
});

test('a lair with no skin lays out nothing, and its save has no orb', () => {
  const { core, entry, host, body } = lair(null);
  try {
    body.alive = false; core.update(0.1, 1);
    expect(eliteNetView(entry).reward).toBeNull();
    expect(JSON.stringify(core.snapshot())).not.toContain('drop');
  } finally { host.scope.dispose(); }
});

// What the page's own lair proved of its rules: a banner, a phase, a kill and a skin, in that order, in the record a save keeps.
test('a lair on the server runs banner, second phase, fall and skin, and its record says so', () => {
  const { core, entry, host, body } = lair('sabre'), runner = player(host);
  try {
    runner.position.set(4, 0, 4.5);
    core.update(0.1, 0);
    expect(eliteNetView(entry)).toMatchObject({ banners: 1 });
    expect(entry.state).toBe('engaged'); expect(entry.phase2).toBe(false);
    body.hp = 5; core.update(0.1, 0.1);
    expect(entry.phase2, 'half its health is its second phase').toBe(true);
    body.alive = false; core.update(0.1, 0.2);
    expect(eliteNetView(entry).state).toBe('dead');
    const orb = eliteNetView(entry).reward; if (orb === null) throw new Error('No orb');
    runner.position.set(4, orb.y, 5);
    actRoutes(host).claims.get('lair.reward')?.(runner.id); actRoutes(host).claims.get('lair.reward')?.(runner.id);
    expect(core.record('lair')).toMatchObject({ discovered: true, skinTaken: true, kills: 1, retired: false });
    expect(eliteNetView(entry).reward, 'a second press finds nothing').toBeNull();
  } finally { host.scope.dispose(); }
});
