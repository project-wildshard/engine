import type { CarriedQuestRows } from '@wildshard/format/questSteps';

/** A carried-prop round (Nalati's kokpar goat) as numbers only: its guest's continuation, where the prop rests and the
 *  step clock, with the observation each step projects and what the guest's outputs decide. No scene, renderer, mount
 *  or page service: the page's CarriedQuestProp (carriedProp.ts) and the Node simulation (CI12's Nalati tape) apply
 *  the same decisions to their own prop and effects. */
export interface CarriedRound { readonly state: Record<string, number>; readonly at: { x: number; z: number }; pending: number }

/** What a projected step reads of the world: the player, whether they ride (or need no mount), whether a carrier is
 *  there and fast, whether the practice room is open, and the carrier's position. */
export interface CarriedRoundInputs {
  readonly playerX: number; readonly playerZ: number; readonly mounted: boolean; readonly carrier: boolean; readonly fast: boolean;
  readonly practice: boolean; readonly carrierX: number; readonly carrierZ: number;
}
type Rows = Pick<CarriedQuestRows, 'state' | 'home' | 'step' | 'fields' | 'outputs' | 'poses' | 'goals'>;

/** A fresh round: the rows' initial continuation, the prop at home. */
export function carriedRound(rows: Rows): CarriedRound { return { state: { ...rows.state }, at: { ...rows.home }, pending: 0 }; }

/** Whether the guest's continuation says the prop is carried. */
export function carriedRoundCarrying(rows: Rows, round: CarriedRound): boolean { return (round.state[rows.outputs.carrying] ?? 0) !== 0; }

/** The prop goes home (a reset): its resting place is the rows' home. */
export function carriedRoundHome(rows: Rows, round: CarriedRound): void { round.at.x = rows.home.x; round.at.z = rows.home.z; }

/** Add a frame's `dt`: the time to project when a step is due (every `rows.step` s), else null. */
export function carriedRoundDue(rows: Rows, round: CarriedRound, dt: number): number | null {
  round.pending += dt;
  if (round.pending < rows.step) return null;
  const elapsed = round.pending; round.pending = 0; return elapsed;
}

/** The guest's observation for a step of `dt` s: its continuation, then the declared world fields. */
export function carriedRoundFrame(rows: Rows, round: CarriedRound, dt: number, world: CarriedRoundInputs): Record<string, number> {
  const fields = rows.fields;
  return { ...round.state,
    [fields.dt]: dt, [fields.playerX]: world.playerX, [fields.playerZ]: world.playerZ, [fields.objectX]: round.at.x, [fields.objectZ]: round.at.z,
    [fields.mounted]: Number(world.mounted), [fields.carrier]: Number(world.carrier), [fields.fast]: Number(world.fast),
    [fields.practice]: Number(world.practice), [fields.carrierX]: world.carrierX, [fields.carrierZ]: world.carrierZ };
}

/** What a step's outputs decide, in the order the page applies them: the warning, a reset or the carry pose, the event
 *  (0: none), then (`carriedRoundGoal`) a delivery. */
export interface CarriedRoundStep { readonly warning: boolean; readonly reset: boolean; readonly carry: boolean; readonly event: number }
/** Take a step's outputs: the guest's continuation into the round (every state key must come back), and its decisions. */
export function carriedRoundOutputs(rows: Rows, round: CarriedRound, out: Readonly<Record<string, number>>): CarriedRoundStep {
  for (const key of Object.keys(round.state)) { const value = out[key]; if (value === undefined) throw new Error('Missing carried quest continuation'); round.state[key] = value; }
  const pose = out[rows.outputs.pose], event = out[rows.outputs.event];
  const reset = pose === rows.poses.reset;
  return { warning: out[rows.outputs.warning] === 1, reset, carry: !reset && pose !== undefined && rows.poses.carry.includes(pose),
    event: event !== undefined && event > 0 ? event : 0 };
}

/** A delivery (the goal pose): the prop rests at the goal the guest chose, returned; null when the step delivers nothing. */
export function carriedRoundGoal(rows: Rows, round: CarriedRound, out: Readonly<Record<string, number>>): { readonly x: number; readonly z: number } | null {
  if (out[rows.outputs.pose] !== rows.poses.goal) return null;
  const goal = rows.goals[out[rows.outputs.goal] ?? -1]; if (goal === undefined) throw new Error('Missing carried quest goal');
  round.at.x = goal.x; round.at.z = goal.z; return goal;
}
