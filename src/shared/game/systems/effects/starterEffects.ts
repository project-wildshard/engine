import * as v from 'valibot';
import type { CombatTag } from '@wildshard/engine/combat/pipeline';
import type { CueId, EffectDef, EffectId } from '@wildshard/engine/combat/effects/types';
import starterRows from './starterRows.json' with { type: 'json' };

const starterTag = v.custom<CombatTag>(value => typeof value === 'string' && /^.+\..+$/u.test(value));
const starterId = v.custom<EffectId>(value => typeof value === 'string' && value.startsWith('effect.'));
const starterCue = v.custom<CueId>(value => typeof value === 'string' && value.startsWith('cue.'));
const finite = v.pipe(v.number(), v.finite());
/** The starter statuses (stun, burn, poison, bleed, slow). The page's EffectService and the room's (HS5) read the same rows;
 *  importing installs no effects. */
export const STARTER_EFFECTS: readonly EffectDef[] = v.parse(v.array(v.strictObject({
  id: starterId, kind: v.literal('timed'), duration: finite, tags: v.array(starterTag), grants: v.array(starterTag),
  modifiers: v.array(v.strictObject({ attr: v.string(), op: v.picklist(['add', 'mul', 'override']), value: finite })),
  stacking: v.union([v.literal('refresh'), v.strictObject({ max: v.pipe(finite, v.integer(), v.minValue(1)) })]),
  cue: starterCue, icon: v.string(), period: v.exactOptional(finite), tickDamage: v.exactOptional(finite),
})), starterRows);

/** A player's own status as the room's owned line: the seconds it has left, in tenths (server/game/shardfile/statusEffects.ts). */
export const statusLine = (id: EffectId): string => `status.${id.slice('effect.'.length)}`;
