import { originalHeldMetadata } from './fixtures/nalati-held-original';
import { expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { App } from '../src/client/engine/app/app';
import type { TargetHit } from '../src/client/engine/combat/types';
import type { Player } from '../src/client/engine/player/Player';
import { parseClientPlan, type ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { HeldClaims, HeldSlotKit } from '../src/client/game/loadout/claims';
import type { StealthController } from '../src/client/game/stealth/controller';
import type { PageRidingView } from '../src/client/game/riding/client';
import type { clientWildlifeState } from '../src/shared/game/population/wildlifeOwner';
import { pageAir } from '../src/client/game/population/pageAir';
import { bindStealthWeapons, installClientStealthEntry } from '../src/client/game/shardfile/clientStealthEntry';
import { publishEntryOwner } from '../src/shared/game/shardfile/entryOwners';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { lendNalatiAdmission } from './fixtures/nalati-return-modules';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const row: Extract<ClientFeatureRow, {kind: 'stealth.entry'}> = {
  kind: 'stealth.entry', owner: 'orchard.stealth', claims: 'orchard.claims', riding: 'orchard.mount', night: 'orchard.night',
  bow: 'reed-bow', melee: 'staff', impactExclusion: 4.5,
  frame: {id: 'orchard.stealth', after: ['orchard.wildlife'], before: ['engine.creatures.update']},
};
function fixture() {
  const scope = new Scope('stealth-entry'), app = new App(), calls: string[] = [], systems: Parameters<ShardContext['system']>[0][] = [];
  const player = legacyDouble<Player>({position: new Vector3(2, 0, 3)}), runtime = legacyDouble<ShardRuntime>({world: legacyDouble<NonNullable<ShardRuntime['world']>>({player})});
  let scale = 2;
  const riding = legacyDouble<PageRidingView>({noteShot(x, z) { expect(this).toBe(riding); calls.push(`ride:${x}:${z}`); }});
  const population = legacyDouble<NonNullable<ReturnType<typeof clientWildlifeState>['wildlife']>>({disturb(x, z) { expect(this).toBe(population); calls.push(`disturb:${x}:${z}`); }});
  const populationOwner: {wildlife: ReturnType<typeof clientWildlifeState>['wildlife']} = {wildlife: population};
  const previous = (): number => { calls.push('previous'); return 3; };
  const bow = legacyDouble<ReturnType<HeldSlotKit['bow']>>({damageMultiplier: previous}), polearm = legacyDouble<ReturnType<HeldSlotKit['polearm']>>({damageScale: 0});
  const kit = legacyDouble<HeldSlotKit>({bow(id) { expect(id).toBe(row.bow); return bow; }, polearm(id) { expect(id).toBe(row.melee); calls.push('melee'); return polearm; }});
  const claims = legacyDouble<HeldClaims>({pageKit() { return kit; }});
  const stealth = legacyDouble<StealthController>({noteShot() { calls.push('shot'); scale = 4; }, sneakMultiplier() { calls.push('scale'); return scale; },
    updateSources(dt, time, owners) { expect(owners.population).toBe(population); expect(owners.riding).toBe(riding);
      expect(owners.kit).toBe(kit); expect(owners.grass).toBe(pageAir); calls.push(`frame:${dt}:${time}`); }});
  const ctx = legacyDouble<ShardContext>({scope, app, game: legacyDouble<ShardContext['game']>({runtime}),
    on(name, handler, options) { app.events.on(name, handler, scope, options); }, system(spec) { systems.push(spec); }});
  publishEntryOwner(scope, 'stealth', row.owner, stealth);
  publishEntryOwner(scope, 'riding-play', row.riding, riding);
  publishEntryOwner(scope, 'claims', row.claims, claims);
  return {scope, app, calls, systems, player, runtime, stealth, riding, population, populationOwner, bow, polearm, previous, kit, ctx};
}
test('strict entry rows refuse executable settings, unknown fields and negative exclusion radii', () => {
  expect(parseClientPlan({version: 1, features: [row]}).features).toEqual([row]);
  for (const input of [{...row, run: () => undefined}, {...row, select: 'player.position'}, {...row, impactExclusion: -1}])
    expect(() => parseClientPlan({version: 1, features: [input]})).toThrow();
});
test('fired and impact callbacks preserve the original order and exact exclusion boundary', () => {
  const f = fixture(), lastShot = pageAir.lastShotT;
  try {
    bindStealthWeapons(f.ctx, row, f.stealth, f.kit, f.populationOwner, f.riding);
    expect(f.bow.damageMultiplier?.(legacyDouble<TargetHit>({}))).toBe(6);
    expect(f.calls).toEqual(['previous', 'scale']); f.calls.length = 0;
    f.app.events.emit('weapon.fired', {id: 'weapon.reed'}); f.app.events.flush('update');
    expect(f.calls).toEqual(['shot', 'melee', 'scale']); expect(f.polearm.damageScale).toBe(4); expect(pageAir.lastShotT).toBe(f.app.clock.now);
    f.calls.length = 0;
    for (const x of [6.499, 6.5, 7]) { f.app.events.emit('weapon.impact', {id: 'weapon.reed', surface: 'ground', point: new Vector3(x, 0, 3)}); f.app.events.flush('update'); }
    expect(f.calls).toEqual(['disturb:6.5:3', 'ride:6.5:3', 'disturb:7:3', 'ride:7:3']);
    f.systems[0]?.run(.025, 12); expect(f.calls.at(-1)).toBe('frame:0.025:12');
    expect(f.systems[0]).toMatchObject({id: row.frame.id, phase: 'update', after: row.frame.after, before: row.frame.before});
  } finally { f.scope.dispose(); pageAir.lastShotT = lastShot; }
});
test('original population replacement and sliced owner retirement refuse before weapon or frame effects', () => {
  for (const retire of [false, true]) {
    const f = fixture();
    try {
      bindStealthWeapons(f.ctx, row, f.stealth, f.kit, f.populationOwner, f.riding);
      const multiplier = f.bow.damageMultiplier;
      if (retire) f.scope.disposeSteps().next(); else f.populationOwner.wildlife = null;
      expect(() => multiplier?.(legacyDouble<TargetHit>({}))).toThrow('owner left or changed');
      expect(() => f.systems[0]?.run(.1, 1)).toThrow('owner left or changed');
      expect(f.calls).toEqual([]); expect(f.polearm.damageScale).toBe(0);
    } finally { f.scope.dispose(); }
  }
});
test('disposal restores only its own bow wrapper and unregisters original event listeners', () => {
  const f = fixture();
  bindStealthWeapons(f.ctx, row, f.stealth, f.kit, f.populationOwner, f.riding);
  f.scope.dispose(); expect(f.bow.damageMultiplier).toBe(f.previous);
  f.app.events.emit('weapon.fired', {id: 'weapon.reed'}); f.app.events.flush('update');
  expect(f.calls).toEqual([]);
  const g = fixture(), replacement = (): number => 9;
  bindStealthWeapons(g.ctx, row, g.stealth, g.kit, g.populationOwner, g.riding);
  g.bow.damageMultiplier = replacement; g.scope.dispose(); expect(g.bow.damageMultiplier).toBe(replacement);
});
test('a missing world refuses before construction or publication', () => {
  const scope = new Scope('missing-stealth-world');
  try { expect(() => installClientStealthEntry(legacyDouble<ShardContext>({scope, game: legacyDouble<ShardContext['game']>({runtime: legacyDouble<ShardRuntime>({world: null, play: null})})}), row)).toThrow('live world and play'); }
  finally { scope.dispose(); }
});


test('world admission reserves only stealth memory; controller guest initialization remains at prepare-play', async () => {
  const scope = new Scope('early-stealth'), rows: unknown = originalHeldMetadata().stealth;
  const product = createShardFolder({slug: 'orchard', revision: 1,
    shardfile: emptyShardfile({slug: 'orchard', name: 'Orchard', author: 'Test', revision: 1, seed: 1}),
    sections: new Map([['player/stealth', rows]]), files: new Map(), read: () => Promise.reject(new Error('Stealth needs no file read'))});
  const ctx = legacyDouble<ShardContext>({scope, product}), feature = CLIENT_FEATURES['stealth.entry'];
  lendNalatiAdmission(scope);
  const memory = vi.spyOn(WebAssembly, 'Memory'), instance = vi.spyOn(WebAssembly, 'Instance');
  try {
    expect(feature.phase).toBe('prepare-play'); expect(feature.world?.rank).toBe(0);
    await feature.world?.install(ctx, row, scope);
    expect(memory).toHaveBeenCalledTimes(1); expect(instance).not.toHaveBeenCalled();
    ReturnProgram.page(product.section('player/stealth').program, scope);
    expect(memory).toHaveBeenCalledTimes(1); expect(instance).toHaveBeenCalledTimes(1);
  } finally { scope.dispose(); memory.mockRestore(); instance.mockRestore(); }
});
