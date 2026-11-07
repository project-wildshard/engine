import * as v from 'valibot';
import type { BowProfile } from '@wildshard/engine/combat/view/bowProfile';
import { HeldBowDefinitionSchema } from '@wildshard/format/weaponProfiles';

/** The profile's numbers: all but what the rows build (the view, arrow, wind, poses, the arrow's rest and length). */
export type HeldBowBase = Omit<BowProfile, 'build' | 'arrow' | 'wind' | 'poses' | 'arrowX' | 'arrowY' | 'arrowLength'>;
/** A held bow definition's rows and its profile numbers, without its geometry: the saddle's gait bands open-ended above
 *  (`below` absent: no upper bound). bindHeldBow builds the profile on these; the Node simulation (CI12's Nalati tape)
 *  reads the same numbers for combat/bowLaw.ts. */
export function heldBowBase(input: unknown): { readonly rows: v.InferOutput<typeof HeldBowDefinitionSchema>['bow']; readonly base: HeldBowBase } {
  const { bow: rows, base } = v.parse(HeldBowDefinitionSchema, input);
  const { parent, mounted, ...values } = base;
  return { rows, base: { ...values, ...(parent === undefined ? {} : { parent: parent as NonNullable<BowProfile['parent']> }),
    ...(mounted === undefined ? {} : { mounted: { ...mounted, gaits: mounted.gaits.map(({ below, spread }) => ({ below: below ?? Infinity, spread })) } }) } };
}
