import type { HuntTuning } from './hunt';
import type { VariantMods, Rarity, ThinkCtx } from '../../../shared/engine/entities/species/registry';
import type { Animal } from '../../../client/engine/entities/AnimalView';
import type { SpeciesFlight } from '../../../shared/engine/ai/flight';

/** Gameplay data only. A procedural builder, palette or hull never belongs on this row. */
export interface SpeciesVariant {
  id: string; label: string; weight: number; rarity: Rarity; scale: [number, number];
  hp?: number; mods?: Partial<VariantMods>;
}
export interface SpeciesRow {
  id: string; kind: string; label: string; parent?: SpeciesRow;
  variants: SpeciesVariant[]; spawnOnly?: SpeciesVariant[];
  aggressive?: boolean; walkSpeed?: number; chargeSpeed?: number; chargeDamage?: number;
  /** s / m / m: the charge's wind-up, the ring a charger circles on, the grass track it flattens (SpeciesDef) */
  chargeWindup?: number; ringRadius?: number; trampleRadius?: number;
  tuning?: HuntTuning;
  sounds?: { call: string; hurt: string; callVariants?: string[]; callEvery?: [number, number] };
  think?: (animal: Animal, ctx: ThinkCtx) => void;
  tick?: 'ai' | 'always';
  act?: (animal: Animal, ctx: ThinkCtx) => void;
  corpseFade?: number; blood?: boolean;
  flight?: SpeciesFlight;
  /** LOCK / target taps: omitted ground species are not lockable; omitted flight species are. */
  lockable?: boolean;
}

/** Child rows retain all unspecified parent fields and merge tuning without losing the hunter policy. */
export function deriveSpecies(parent: SpeciesRow, patch: Partial<SpeciesRow> & { id: string }): SpeciesRow {
  const row = { ...parent, ...patch, parent };
  if (parent.tuning !== undefined && patch.tuning !== undefined) row.tuning = { ...parent.tuning, ...patch.tuning };
  return row;
}
