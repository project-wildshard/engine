import { Vector3 } from 'three';
import { app } from '../../src/client/engine/app/runtime';
import type { Scope } from '../../src/shared/engine/app/scope';
import type { EffectService } from '../../src/shared/engine/combat/effects/EffectService';
import type { PlayerHealth } from '../../src/shared/engine/combat/health';
import type { EffectTarget } from '../../src/shared/engine/combat/effects/types';
import type { ShardContext } from '../../src/client/game/plugin/context';
import type { Owned } from '../../src/shared/game/loot/Owned';
import { parseItems } from '@wildshard/format/items';
import { DRIFTWOOD_SWORDS } from '../../src/shards/driftwood-isle/generators/items';
import { installItemEffects } from '../../src/client/game/loadout/effects';

export type FixtureOwned = Pick<Owned, 'has' | 'onChange'> & Partial<Pick<Owned, 'worn'>>;
/** Keep the original effect scenarios on the real item rows and the public, data-only installer. */
export function bindFixtureEffects(o: { effects: EffectService; scope: Scope; owned: FixtureOwned;
  health: PlayerHealth; player: { dodgeCooldownScale: number }; swords: readonly EffectTarget[]; hitCap: number }): void {
  const items = parseItems(DRIFTWOOD_SWORDS), row = items.loadout.effects;
  if (row === undefined) throw new Error('Missing real item effect rows');
  row.weapons = row.weapons.flatMap(entry => o.swords.length === 0 ? [] : [{ ...entry, items: entry.items.slice(0, o.swords.length) }]);
  const player = Object.assign(o.player, { effectMoveLocked: false, effectMoveScale: 1, position: new Vector3() });
  const context = { scope: o.scope, manifest: { fight: { maxHitDamage: o.hitCap } },
    product: { shardfile: { items } }, app: { effects: o.effects, player: o.health, events: app.events, combat: app.combat },
    game: { runtime: { world: { player }, play: { owned: { has: (id) => o.owned.has(id), worn: (id) => o.owned.worn?.(id) ?? false, onChange: (run) => o.owned.onChange(run) }, weapons: { get: (slot: string) => o.swords[slot === 'sword' ? 0 : 1] } } } },
  } as ShardContext;
  installItemEffects(context);
}
