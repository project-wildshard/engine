import { STARTER_MELEE_PROFILE, IRON_MELEE_PROFILE } from './starterCombat';
import type { EquipmentRow } from '@wildshard/engine/combat/Equipment';
import { SWAP_GLYPHS } from './starterGlyphs';
import { REST, CHARGE, SPRINT, COMBO, HEAVY, CHARGE_BLEND } from './starterMoves';
import type { MeleeProfile } from '@wildshard/engine/combat/meleeProfile';

/** The starter wooden sword equipment row and existing UI metadata. */
export const WOODEN_SWORD: EquipmentRow = {
  cues: {"fire": "cue.sword.swing", "reload": "cue.reload", "impact": "cue.sword.hit"},
  "id": "weapon.sword",
  "legacySlot": "sword",
  "ui": {
    "swapIcon": SWAP_GLYPHS.sword,
    "name": "Wooden sword",
    "icon": "sword",
    "touch": "melee",
    "lockOn": true,
    "melee": true,
    "tracers": false
  },
  "meta": {
    "name": "Wooden sword",
    "icon": "sword",
    "blurb": "",
    "category": "weapon"
  }
};

/** The upgraded iron sword equipment row and existing UI metadata. */
export const IRON_SWORD: EquipmentRow = {
  cues: {"fire": "cue.sword.swing", "reload": "cue.reload", "impact": "cue.sword.hit"},
  "id": "weapon.sword-iron",
  "legacySlot": "sword-iron",
  "ui": {
    "swapIcon": SWAP_GLYPHS.sword,
    "name": "Iron sword",
    "icon": "sword",
    "touch": "melee",
    "lockOn": true,
    "melee": true,
    "tracers": false
  },
  "meta": {
    "name": "Iron sword",
    "icon": "sword",
    "blurb": "",
    "category": "weapon"
  }
};

/** The base sword equipment row, retaining its legacy slot and cue IDs. */
/** The original wooden contact profile, moves and portrait framing. */
export const SWORD_WOOD: MeleeProfile = {
  ...WOODEN_SWORD, cues: { fire: 'cue.sword.swing', reload: 'cue.reload', impact: 'cue.sword.hit', hit: 'cue.sword.hit', heavy: 'cue.sword.heavy' },
  hitStop: { body: 0.06, head: 0.06, kill: 0.06 }, family: STARTER_MELEE_PROFILE.family, damage: STARTER_MELEE_PROFILE.damage, reach: STARTER_MELEE_PROFILE.reach, swingScale: STARTER_MELEE_PROFILE.swingScale,
  portraitPullX: 0.32, framing: { shrink: 0.33, dx: -0.03, dy: -0.055, tilt: 0.36, yaw: -0.02 },
  moves: { rest: REST, charge: CHARGE, sprint: SPRINT, combo: COMBO, heavy: HEAVY },
  cooldown: STARTER_MELEE_PROFILE.cooldown, comboGap: STARTER_MELEE_PROFILE.comboGap, chainLag: STARTER_MELEE_PROFILE.chainLag, heavyCharge: STARTER_MELEE_PROFILE.heavyCharge, chargeBlend: CHARGE_BLEND,
  lunge: STARTER_MELEE_PROFILE.lunge,
  sweep: STARTER_MELEE_PROFILE.sweep,
  trail: { samples: 20, subdivisions: 3 }, dodgeKick: { kick: 2.2, k: 160, c: 14 }, armFollow: 0.45,
  feel: { lag: { gain: 0.5, clampYaw: 0.12, clampPitch: 0.1, k: 220, c: 20, posYaw: 0.25, posPitch: 0.2 },
    bob: { x: 0.018, y: 0.014, rz: 0.02, rx: 0.012 }, sway: { ax: 0.003, fx: 0.7, ay: 0.0025, fy: 1.1 }, fovHip: 72 },
};
/** The base sword equipment row, retaining its legacy slot and cue IDs. */
/** The original iron contact profile, retaining the wooden parent and 28 damage. */
export const SWORD_IRON: MeleeProfile = { ...SWORD_WOOD, ...IRON_SWORD, parent: SWORD_WOOD.id, damage: IRON_MELEE_PROFILE.damage };
