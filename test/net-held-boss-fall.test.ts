import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '@wildshard/engine/host/headlessRuntime';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { encounterRows } from '../src/shared/engine/sim/encounterRows';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

// SERVER-PARITY HS3: the Storm Roc is a held boss, a home body. Far Reach's home kill plane (killY 6) killed it when it fell
// off the crown, and its fight paid the victory, the Ledger fact and 25 coins for a death no player dealt (shard-sky-reach
// 636d12e, SKY-2). A held boss under the plane goes back to its anchor, alive, and the fight carries on unpaid.
const KILL_Y = 6;
async function resident(slug: string): Promise<TrustedHeadlessResident> {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory);
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets: runtimeAssets(product, directory),
    rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) });
}

/** Far Reach's resident with the lead player standing in the crown fight, unhurt. */
async function inFight(): Promise<{ live: TrustedHeadlessResident; roc: NonNullable<ReturnType<TrustedHeadlessResident['host']['entities']['get']>>; fight: () => string | undefined }> {
  const live = await resident('far-reach'), { host } = live, lead = leadPlayer(host), roc = host.entities.get('far.roc');
  if (roc === undefined) throw new Error('Missing Roc');
  host.events.answer('damage.modify', request => request?.target === lead.health ? null : request, host.scope);
  const fight = (): string | undefined => [...encounterRows(host).values()].map(read => read()).find(row => row.kind === 'boss' && row.body === 'far.roc')?.state;
  lead.position.set(0, 44.3, -184); lead.motor.resetAt(lead.position);
  for (let tick = 0; tick < 3000 && fight() !== 'fight'; tick++) live.step([]);
  return { live, roc, fight };
}
/** Step `ticks` times; the facts and coins the ticks filed. */
function run(live: TrustedHeadlessResident, ticks: number): { kind: string }[] {
  const paid: { kind: string }[] = [];
  for (let tick = 0; tick < ticks; tick++) { live.step([]); paid.push(...live.effects.filter(effect => effect.kind === 'coins' || effect.kind === 'fact')); }
  return paid;
}

test('a Roc the world kills pays nothing; one a player strikes down pays once', { timeout: 20_000 }, async () => {
  const { live, roc, fight } = await inFight();
  try {
    const { host } = live;
    expect(fight(), 'the fight is on').toBe('fight');
    host.combat.fall(roc.combatActor(), roc.position, { kind: 'out-of-world', label: 'test' });
    expect(roc.alive).toBe(false);
    expect(run(live, 60), 'a death from the world files nothing').toEqual([]);
    expect(host.flags.has('far.roc.down')).toBe(false);
  } finally { live.dispose(); }
  const struck = await inFight();
  try {
    const { host } = struck.live, at = struck.roc.position.clone();
    // A player's melee is an `env` request tagged `actor.player` (Melee.contact): a blow, not the world.
    host.combat.hit({ source: 'env', sourceTags: ['actor.player', 'dmg.melee'], target: struck.roc.combatActor(), amount: 1e6, point: at, dir: at.clone().set(0, 0, -1), throughWalls: true });
    expect(struck.roc.alive).toBe(false);
    const paid = run(struck.live, 60);
    expect(paid.filter(effect => effect.kind === 'coins'), 'a player kill pays once').toHaveLength(1);
    expect(struck.fight()).toBe('victory');
  } finally { struck.live.dispose(); }
});

test('a Roc pushed off the crown falls, comes back and pays nothing', { timeout: 20_000 }, async () => {
  const { live, roc, fight } = await inFight();
  try {
    expect(fight(), 'the fight is on').toBe('fight');
    const anchor = roc.position.clone();
    roc.position.set(anchor.x + 40, KILL_Y - 3, anchor.z); // shoved off the crown, under the plane
    const paid = run(live, 600);
    expect(roc.alive, 'the plane never killed it').toBe(true);
    expect(roc.position.y, 'back above the plane').toBeGreaterThan(KILL_Y);
    expect(Math.hypot(roc.position.x - anchor.x, roc.position.z - anchor.z), 'back on its arena').toBeLessThan(30);
    expect(fight(), 'the fight carries on').not.toBe('victory');
    expect(paid, 'no fact, no coins').toEqual([]);
    expect(live.host.flags.has('far.roc.down'), 'not down').toBe(false);
  } finally { live.dispose(); }
});
