// Native and legacy brains expose their current diagnostic state here.
import type { UtilityScore } from './strikes';

export interface BrainInspection { state: string; picks: readonly UtilityScore[]; brainHz: number; pinned: boolean }
const brains = new WeakMap<object, () => BrainInspection>();
export function inspectBrain(actor: object, read: () => BrainInspection): void { brains.set(actor, read); }
