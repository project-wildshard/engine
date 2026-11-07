import type { EquipmentRow } from './Equipment';
import type { SwordMoveSet, SwordFraming, Move } from '../../../client/engine/combat/view/melee';

/** Numeric camera lag, bob and sway parameters consumed by a weapon view strategy. */
export interface ViewmodelFeel {
  lag: { gain: number; clampYaw: number; clampPitch: number; k: number; c: number; posYaw: number; posPitch: number };
  bob: { x: number; y: number; rz: number; rx: number };
  sway: { ax: number; fx: number; ay: number; fy: number };
  fovHip: number; portraitFov?: number;
}
/** Authored contact, sweep, combo and view parameters for the generic melee family. */
export interface MeleeProfile extends EquipmentRow {
  family: 'melee'; parent?: string;
  damage: number; reach: number; swingScale: number;
  portraitPullX: number; framing: SwordFraming; feel: ViewmodelFeel;
  moves?: SwordMoveSet;
  cooldown: number; comboGap: number; chainLag: number; heavyCharge: number; chargeBlend: number;
  lunge: { range: number; heavyRange: number; cone: number; stop: number; speed: number; minTime: number; maxTime: number };
  sweep: { rays: number; extensions: readonly number[]; step: number; maxSamples: number; maxHits: number };
  trail: { samples: number; subdivisions: number };
  dodgeKick: { kick: number; k: number; c: number }; armFollow: number;
}

/** Internal rows use a discriminated family field; legacy UI-only rows retain default sword tuning. */
export function isMeleeProfile(row: EquipmentRow): row is MeleeProfile {
  return 'family' in row && row.family === 'melee';
}


/** Numeric admitted contact/clock data; the engine owns no schema or shard-specific equipment content. */
export interface MeleeCombatProfile extends Pick<MeleeProfile, 'family' | 'damage' | 'reach' | 'swingScale' | 'cooldown' | 'comboGap' | 'chainLag' | 'heavyCharge' | 'lunge' | 'sweep'> {
  moves: { combo: readonly (Pick<Move, 'windup' | 'slashEnd' | 'total' | 'damage'> & Partial<Pick<Move, 'stagger' | 'sweep' | 'reach'>>)[];
    heavy: Pick<Move, 'windup' | 'slashEnd' | 'total' | 'damage'> & Partial<Pick<Move, 'stagger' | 'sweep' | 'reach'>> };
}

/** Compose admitted numeric combat data with an existing native pose recipe. Preserve identity, metadata, cues and all view fields. */
export function applyMeleeCombatProfile<T extends MeleeProfile>(view: T, data: MeleeCombatProfile): T {
  const moves = view.moves;
  if (moves === undefined || moves.combo.length !== data.moves.combo.length) throw new Error('Melee profile and native combo recipe must match');
  const combo = moves.combo.map((move, index) => {
    const numbers = data.moves.combo[index];
    if (numbers === undefined) throw new Error('Missing admitted melee move');
    return { ...move, ...numbers };
  });
  return { ...view, damage: data.damage, reach: data.reach, swingScale: data.swingScale,
    cooldown: data.cooldown, comboGap: data.comboGap, chainLag: data.chainLag, heavyCharge: data.heavyCharge,
    lunge: data.lunge, sweep: data.sweep, moves: { ...moves, combo, heavy: { ...moves.heavy, ...data.moves.heavy } } };
}
