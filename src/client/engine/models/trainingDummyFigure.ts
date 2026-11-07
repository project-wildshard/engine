import { buildTrainingDummy, type DummyVariant, type TrainingDummyModel } from '../practice/TrainingDummy';

/**
 * One figure of this armour: the rigged TRELLIS.2 cast, or the procedural figure when its file fails (`who` names whose
 * copy fell back, in the warning). The arena's copies and the Explorer's specimen are both built by this.
 */
export async function dummyFigure(variant: DummyVariant, who: string): Promise<TrainingDummyModel> {
  try { const { loadTrainingDummy } = await import('../practice/TrainingDummyAssets'); return await loadTrainingDummy(variant); }
  catch (error) {
    console.warn(`[practice] ${who}: ${variant} mesh unavailable; using procedural fallback`, error);
    return buildTrainingDummy(variant);
  }
}

/** the procedural figure of this armour: the arena's stand-in while the files load (E291: never an empty room) */
export function dummyStandIn(variant: DummyVariant): TrainingDummyModel { return buildTrainingDummy(variant); }
