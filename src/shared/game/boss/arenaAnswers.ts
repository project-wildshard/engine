/**
 * The open arena encounter's answers, renderer-free (CI12: the Nalati chapter tape plays the Storm Titan's tie and clear on
 * the real persistence): the fight's tie event (arm the boss, disarming first when told; the toast line it picks) and its
 * boundary answer (the tie prompt's reach and label, a disarm, where the player is held, a wall hit, and the clear: calm
 * weather, then the kill and the feat recorded). `ArenaRoomEncounter` (arenaRoom.ts) applies them through these, in this
 * order; a native host passes its own boss, player, weather and persistence.
 */
import type { ProjectedState } from '../population/returnProgram';

type Answer = Readonly<Record<string, number>>;
/** what the tie event reads of the encounter */
export interface ArenaTieObservation { readonly engaged: boolean; readonly victory: boolean; readonly hit: boolean; readonly mounted: boolean; readonly storm: boolean }
export interface ArenaAnswerPorts {
  readonly boss: { readonly arm: () => void; readonly disarm: () => void };
  /** the fight's tied flag (OpenArenaFight.tied) */
  readonly fight: { tied: boolean };
  readonly toast: (line: string) => void;
}
export interface ArenaBoundaryPorts extends ArenaAnswerPorts {
  readonly prompt: { radius: number; label: string };
  readonly player: { x: number; z: number };
  /** the wall hurts the player where they stand */
  readonly wall: () => void;
  /** the storm clears (the encounter's clearing weather) */
  readonly clear: () => void;
  /** the adventure's records: the kill and the feat of the encounter's record */
  readonly persistence: { readonly kill: (kind: string, variant: string) => void; readonly feat: (kind: string) => void };
}
export interface ArenaBoundaryLines { readonly tie: string; readonly tieOnFoot: string; readonly tieQuiet: string }

/** The fight's tie event on `life` from `observed`, applied: armed (disarmed first when told), and its line toasted. */
/** The view call that tells a page which tie line a press got. */
export const arenaTieWord = (id: string): string => `${id}.tie`;
export function arenaTie(life: Pick<ProjectedState, 'event'>, observed: ArenaTieObservation, lines: readonly string[], ports: ArenaAnswerPorts): Answer {
  const answer = life.event('tie', { engaged: Number(observed.engaged), victory: Number(observed.victory), hit: Number(observed.hit), mounted: Number(observed.mounted), storm: Number(observed.storm) });
  if (answer['arm'] === 1) { ports.fight.tied = true; if (answer['disarm'] === 1) ports.boss.disarm(); ports.boss.arm(); }
  const line = lines[answer['index'] ?? -1]; if (line) ports.toast(line);
  return answer;
}

/** A boundary answer applied: the prompt, a disarm, the player held, the wall, then the clear and its records. */
export function arenaBoundary(answer: Answer, lines: ArenaBoundaryLines, record: { readonly kind: string; readonly variant: string }, ports: ArenaBoundaryPorts): void {
  const prompt = ports.prompt;
  prompt.radius = answer['radius'] ?? 0; prompt.label = answer['label'] === 1 ? lines.tieOnFoot : answer['label'] === 2 ? lines.tieQuiet : lines.tie;
  if (answer['disarm'] === 1) { ports.fight.tied = false; ports.boss.disarm(); }
  const p = ports.player; p.x = answer['x'] ?? p.x; p.z = answer['z'] ?? p.z;
  if (answer['hurt'] === 1) ports.wall();
  if (answer['clear'] === 1) { ports.fight.tied = false; ports.clear(); const saved = ports.persistence; saved.kill(record.kind, record.variant); saved.feat(record.kind); }
}
