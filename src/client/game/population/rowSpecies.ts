import type { SpeciesRow } from '@wildshard/engine/ai/species';
import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import { MixedPopulationSchema } from '@wildshard/format/mixedPopulation';
import * as v from 'valibot';
import { numericCreaturePose } from '../../../shared/game/plugin/channelPrograms';
import { stepPerchRoot } from '../../../shared/game/population/perchRoot';

/** Species a server drives: their rows as a page draws them. A brain is the server's, and says when a body strikes by its attack phase. */
export function rowSpecies<T extends SpeciesRow>(rows: readonly T[]): T[] { return rows.map(row => ({ ...row, phased: true })); }
/** The look half of a perch: its kind, and its root and joints posed from its row body's own memory. */
export function perchLook(input: unknown): { readonly kind: string; readonly animate: (c: AnimalRigContext) => void } {
  const rows = v.parse(v.strictObject({ clips: v.array(v.unknown()), program: v.unknown(), perch: MixedPopulationSchema.entries.perch }), input);
  const poses = rows.clips.map(numericCreaturePose);
  return { kind: rows.perch.kind, animate: c => { stepPerchRoot(c, rows.perch.root); for (const pose of poses) pose(c); } };
}
