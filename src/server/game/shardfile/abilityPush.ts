import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimStrike } from '@wildshard/engine/sim';

type Ability = NonNullable<Shardfile['rows']['species'][number]['abilities']>[number];

/** OF20c2: an ability row's push and aim on its strike: `knockback` slides the struck player (metres), `impulse` throws
 * it along the strike's facing (m/s) and up by `lift`; `aimHeight` aims the strike above the target's feet. */
export function abilityPush(ability: Ability): Pick<SimStrike, 'knockbackDistance' | 'impulse' | 'aimHeight'> {
  return {
    ...(ability.effect === 'knockback' && ability.strength !== undefined ? { knockbackDistance: ability.strength } : {}),
    ...(ability.effect === 'impulse' && ability.strength !== undefined ? { impulse: { speed: ability.strength, lift: ability.lift ?? 0 } } : {}),
    ...(ability.aimHeight === undefined ? {} : { aimHeight: ability.aimHeight }),
  };
}
