/**
 * The practice room's gameplay entry and exit (TrainingArena.enter / exit) without the room, its view or its UI, so a
 * native session runs the same loan and spawn: entering lends every weapon of the kit and selects the first, takes the
 * player off the board and stands it at the room's spawn looking a touch down; leaving ends the loan (the world's own
 * unlocks again). The spawn's distance from the lineup is the page's frame fit (`practiceViewDistance`).
 *
 *   enterPracticeLoan({ weapons, player }, { x, z: centreZ + practiceViewDistance(fov, aspect, width), y });
 *   exitPracticeLoan(weapons);
 */
import type { WeaponId } from '../../../shared/engine/combat/Equipment';
import { ARENA_LINEUP } from './lineup';

/** the dummy's half width with its arms, metres: what must stay inside the frame */
export const PRACTICE_DUMMY_HALF_WIDTH = 0.5;

/** What the room's entry moves: the weapon loan (an EquipmentService) and the player's place. */
export interface PracticeLoanPorts<Id = WeaponId> {
  readonly weapons: { readonly lendAll: () => void; readonly select: (id: Id, instant?: boolean) => void; readonly list: readonly { readonly id: Id }[]; readonly current: { readonly id: Id } };
  readonly player: { readonly setHover: (on: boolean) => void; readonly spawn: (x: number, z: number, yaw: number, y?: number) => void; pitch: number };
}

/** Lend every weapon (E298 A), select the first, step off the board (spawn keeps it; on it there is no dodge, E285) and
 *  stand at `at` facing the lineup, pitched -0.1 so the lineup and its floor fill the frame. */
export function enterPracticeLoan<Id>(ports: PracticeLoanPorts<Id>, at: { readonly x: number; readonly z: number; readonly y: number }): void {
  const { weapons, player } = ports;
  weapons.lendAll();
  weapons.select(weapons.list[0]?.id ?? weapons.current.id, true);
  player.setHover(false);
  player.spawn(at.x, at.z, 0, at.y);
  player.pitch = -0.1;
}

/** Leave the room: the loan ends and the world's own unlocks return. */
export function exitPracticeLoan(weapons: { readonly endLoan: () => void } | null): void { weapons?.endLoan(); }

/**
 * How far back from the centre dummy the player stands so the whole lineup, arms included, is inside a frame of vertical
 * field of view `fovDeg`, `aspect` and `width` CSS pixels (10 px margin each side): nearer on a wide frame, further on a
 * narrow one, at least 4.8 and at most 11.
 */
export function practiceViewDistance(fovDeg: number, aspect: number, width: number): number {
  const half = width / 2;
  const usable = Math.max(0.5, (half - 10) / half);
  const tanH = Math.tan(fovDeg * (Math.PI / 180) / 2) * aspect * usable;
  const centre = ARENA_LINEUP[1] ?? { x: 0, z: -7 };
  let need = 4.8;
  for (const spot of ARENA_LINEUP) {
    const reach = Math.abs(spot.x) + PRACTICE_DUMMY_HALF_WIDTH;
    need = Math.max(need, reach / Math.max(0.15, tanH) - (centre.z - spot.z));
  }
  return Math.min(11, need);
}
