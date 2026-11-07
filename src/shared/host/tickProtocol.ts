import {headlessTapePlanSchema,headlessTapeReportSchema,type HeadlessTapePlan,type HeadlessTapeReport} from './headlessTape';
import { HeadlessJourneyPlanSchema, type HeadlessJourneyPlan } from './headlessJourney';
import { DecisionPublicationSchema, type DecisionPublication } from '@wildshard/format/decisionPublication';
import type { SimCommand } from '@wildshard/engine/sim';
import * as v from 'valibot';

const text = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(0x7fffffff));
/** Strict bounded player, script and event inputs admitted at the worker tick boundary. */
export const TickCommandSchema: v.GenericSchema<BoundedTickCommandInput, BoundedTickCommand> = v.variant('kind', [
  // `hover: true` is the HOVER press this tick: on or off the hoverboard (SimCommand.hover); `jump: true` / `dodge: true`
  // the JUMP / DODGE press (SimCommand.jump / .dodge). `heavy` is a HELD state, not a press: the HEAVY hold is down this
  // tick (the touch ATTACK hold, the desktop latch), aimed at `targetId` when the crosshair is on one; the first tick
  // without it releases. The runtime's weapon reads it with its own law (SweptMeleeCore.step's `held`; a hold-to-release
  // weapon's charge); SimHost has no heavy of its own. `dive` / `surface` are held booleans read by the installed water law.
  // `swing: true` says this tick's press or hold names no target: a net client's free swing or shot (P1-E3.2), which the weapon
  // resolves along `yaw` and the look `pitch` from the server's own eye. `seq` is the NetCommand's: the hit a swing or shot started
  // here lands confirms it (J47). `viewTick` is the tick a client saw the world at, which its blow is settled against (J50); no
  // rewind without one.
  // `lockTarget` is J116's lock-on: what SimCommand.lockTarget orbits.
  v.pipe(v.strictObject({ kind: v.literal('player'), moveX: finite, moveZ: finite, yaw: finite, attack: v.optional(v.strictObject({ targetId: text })), lockTarget: v.exactOptional(text), hover: v.optional(v.literal(true)), boost: v.optional(v.literal(true)),
    jump: v.optional(v.literal(true)), dodge: v.optional(v.literal(true)), heavy: v.optional(v.strictObject({ targetId: v.optional(text) })),
    swing: v.exactOptional(v.literal(true)), secondary: v.exactOptional(v.literal(true)), seq: v.exactOptional(natural), viewTick: v.exactOptional(natural), pitch: v.exactOptional(v.pipe(finite, v.minValue(-Math.PI / 2), v.maxValue(Math.PI / 2))), dive: v.exactOptional(v.boolean()), surface: v.exactOptional(v.boolean()),
    commandVersion: v.exactOptional(v.literal(1)), steer: v.exactOptional(v.strictObject({ keyX: v.pipe(finite, v.minValue(-1), v.maxValue(1)), keyY: v.pipe(finite, v.minValue(-1), v.maxValue(1)),
      stickX: v.pipe(finite, v.minValue(-1), v.maxValue(1)), stickY: v.pipe(finite, v.minValue(-1), v.maxValue(1)) })), sprint: v.exactOptional(v.boolean()), crouch: v.exactOptional(v.boolean()) }),
    v.check(command => command.commandVersion === 1 || (command.steer === undefined && command.sprint === undefined && command.crouch === undefined), 'Raw movement requires commandVersion 1')),
  v.strictObject({ kind:v.literal('launcher'), slot:v.pipe(natural,v.maxValue(31)),
    ads:v.pipe(finite,v.minValue(0),v.maxValue(1)), pitch:v.pipe(finite,v.minValue(-Math.PI/2),v.maxValue(Math.PI/2)),
    fire:v.exactOptional(v.literal(true)), reload:v.exactOptional(v.literal(true)) }),
  v.strictObject({ kind: v.literal('interact'), id: text }),
  // `playerId` names who acted when it is not the lead (P1-E3.3); a tape of one player never carries it
  v.strictObject({ kind: v.literal('script'), actorId: text, value: finite, playerId: v.exactOptional(text) }),
  v.strictObject({ kind: v.literal('event'), type: natural, target: natural, value: finite }),
]);
/** A detached input admitted before the fixed tick; every source shares the shard's one command allowance. */
export type HeadlessCommand = v.InferOutput<typeof TickCommandSchema>;
/** The same detached player command for both native worker paths; absent optional fields stay absent. */
export function simPlayerCommand(command: Extract<HeadlessCommand, { kind: 'player' }>): SimCommand {
  return { moveX: command.moveX, moveZ: command.moveZ, yaw: command.yaw,
    ...(command.attack === undefined ? {} : { attack: { ...command.attack } }), ...(command.lockTarget === undefined ? {} : { lockTarget: command.lockTarget }),
    ...(command.hover === undefined ? {} : { hover: command.hover }), ...(command.jump === undefined ? {} : { jump: command.jump }),
    ...(command.dodge === undefined ? {} : { dodge: command.dodge }),
    ...(command.dive === undefined ? {} : { dive: command.dive }), ...(command.surface === undefined ? {} : { surface: command.surface }), ...(command.boost === undefined ? {} : { boost: command.boost }),
    ...(command.commandVersion === undefined ? {} : { commandVersion: command.commandVersion }),
    ...(command.steer === undefined ? {} : { steer: { ...command.steer } }),
    ...(command.sprint === undefined ? {} : { sprint: command.sprint }), ...(command.crouch === undefined ? {} : { crouch: command.crouch }) };
}
/** Command provenance is retained for auditing; splitting a batch never grants another allowance. */
export interface HeadlessCommandSource { source: string; commands: readonly HeadlessCommand[] }
/** Detached gameplay facts and coin effects published only after a completed tick. */
export const TickEffectSchema: v.GenericSchema<BoundedTickEffectInput, BoundedTickEffect> = v.variant('kind', [
  v.strictObject({ kind: v.literal('fact'), name: text, actorId: text }),
  v.strictObject({ kind: v.literal('coins'), amount: finite, actorId: text }),
  v.strictObject({ kind: v.literal('item'), item: text, count: finite, actorId: text }),
  v.strictObject({ kind: v.literal('hint'), text: v.pipe(v.string(),v.minLength(1),v.maxLength(4096)) }),
]);
/** Only completed, in-budget ticks can expose these durable quest requests to the parent. */
export type HeadlessEffect = v.InferOutput<typeof TickEffectSchema>;
/** One canonical bounded native tape codec, composed with actual tick/effect authority. */
export const HeadlessTapePlanSchema:v.GenericSchema<HeadlessTapePlan>=headlessTapePlanSchema(TickCommandSchema);
export const HeadlessTapeReportSchema:v.GenericSchema<HeadlessTapeReport>=headlessTapeReportSchema(TickEffectSchema);
/** Character bound of an encoded tick checkpoint, including its metadata. */
export const MAX_TICK_SNAPSHOT_CHARS = 32_000_000;
const tickCommit = v.strictObject({ tick: natural, snapshot: v.pipe(v.string(), v.maxLength(MAX_TICK_SNAPSHOT_CHARS)), effects: v.pipe(v.array(TickEffectSchema), v.maxLength(1024)), fuelUsed: v.exactOptional(natural), scriptMicros: v.exactOptional(v.pipe(finite, v.minValue(0))), decisions: v.exactOptional(DecisionPublicationSchema) });
/** Validated tick result carrying its continuation, effects and optional script cost observations. */
export const TickCommitSchema: v.GenericSchema<BoundedTickCommitInput, BoundedTickCommit> = tickCommit;
/** Complete same-engine continuation and effects from one atomically committed worker tick. */
export type HeadlessTickCommit = v.InferOutput<typeof TickCommitSchema>;
/** A bounded non-terminal tape request publishes its checked full continuation. */
export interface HeadlessTapePartReport { report:HeadlessTapeReport;commit:HeadlessTickCommit }
export const HeadlessTapePartReportSchema:v.GenericSchema<HeadlessTapePartReport>=v.strictObject({report:HeadlessTapeReportSchema,commit:TickCommitSchema});
/** Identical tick/effect/fuel/decision guards when no intermediate save escapes. */
export const TickObservationSchema: v.GenericSchema<Omit<HeadlessTickCommit, 'snapshot'>> = v.omit(tickCommit, ['snapshot']);
export type HeadlessTickObservation = v.InferOutput<typeof TickObservationSchema>;
/** A finite author tape: no host modules, synthetic facts or configurable physics ports. */
export const AuthorProofPlanSchema: v.GenericSchema<BoundedAuthorProofPlanInput, BoundedAuthorProofPlan> = v.pipe(v.strictObject({ version: v.literal(1),
  tape: v.pipe(v.array(v.pipe(v.array(TickCommandSchema), v.maxLength(1024))), v.minLength(1), v.maxLength(4096)),
  checkpointTick: v.pipe(natural, v.minValue(1)),
  requiredFacts: v.pipe(v.array(text), v.minLength(1), v.maxLength(128)),
}), v.check(plan => plan.checkpointTick <= plan.tape.length && new Set(plan.requiredFacts).size === plan.requiredFacts.length, 'Checkpoint inside tape and distinct required facts'));
/** Author-owned input; the host derives every filed fact from real quest completion. */
export type AuthorProofPlan = v.InferOutput<typeof AuthorProofPlanSchema>;
/** Strict host evidence for actual grid admission, save refusal, unload, restore and atomic ledger filing. */
export const AuthorProofReportSchema: v.GenericSchema<BoundedAuthorProofReportInput, BoundedAuthorProofReport> = v.strictObject({
  version: v.literal(1), ticks: natural, checkpointTick: natural,
  grid: v.strictObject({ reserveBeforePhysics: v.literal(true), runtimeFence: v.literal(true), refusedSave: v.literal(true),
    restored: v.literal(true), frozenTicks: v.literal(5), loads: v.literal(2), leasesAfterDispose: v.literal(0) }),
  ledger: v.strictObject({ facts: v.pipe(v.array(v.strictObject({ name: text, actorId: text, tick: natural })), v.maxLength(1024)),
    granted: natural, durableReload: v.literal(true), duplicateStable: v.literal(true) }),
});
/** Detached evidence: booleans are published only after the native assertions succeed. */
export type AuthorProofReport = v.InferOutput<typeof AuthorProofReportSchema>;
/** Worker request grammar for a bounded command step or an explicit finish proof. */
export const WorkerRequestSchema: v.GenericSchema<BoundedWorkerRequestInput, BoundedWorkerRequest> = v.variant('kind', [
  v.strictObject({ kind: v.literal('step'), commands: v.pipe(v.array(TickCommandSchema), v.maxLength(1024)) }),
  v.strictObject({ kind: v.literal('finish') }),
  v.strictObject({ kind: v.literal('observe') }),
  v.strictObject({ kind: v.literal('journey'), plan: HeadlessJourneyPlanSchema }),
  v.strictObject({ kind: v.literal('walk'), plan: HeadlessJourneyPlanSchema }),
  v.strictObject({kind:v.literal('verbTape'),plan:HeadlessTapePlanSchema}),
  v.strictObject({kind:v.literal('verbTapePart'),plan:HeadlessTapePlanSchema}),
  v.strictObject({ kind: v.literal('authorProof'), plan: AuthorProofPlanSchema }),
]);
/** Validate and copy ordered source batches against one aggregate per-tick command allowance. */
export function tickCommands(sources: readonly HeadlessCommandSource[], limit: number): HeadlessCommand[] {
  if (!Number.isInteger(limit) || limit < 0 || limit > 1024 || sources.length > 1024) throw new Error('Invalid tick command allowance');
  let count = 0;
  for (const source of sources) { v.parse(text, source.source); count += source.commands.length; if (count > limit) throw new Error('Aggregate commandsPerTick exceeded'); }
  return sources.flatMap(source => source.commands.map(command => v.parse(TickCommandSchema, command)));
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedTickCommandInput = BoundedTickCommand;
type BoundedTickCommand = {
    kind: "player";
    moveX: number;
    moveZ: number;
    yaw: number;
    attack?: {
        targetId: string;
    } | undefined;
    lockTarget?: string;
    hover?: true | undefined;
    jump?: true | undefined;
    dodge?: true | undefined;
    heavy?: {
        targetId?: string | undefined;
    } | undefined;
    swing?: true;
    secondary?: true;
    seq?: number;
    viewTick?: number;
    pitch?: number;
    boost?: true | undefined;
    dive?: boolean;
    surface?: boolean;
    commandVersion?: 1;
    steer?: {
        keyX: number;
        keyY: number;
        stickX: number;
        stickY: number;
    };
    sprint?: boolean;
    crouch?: boolean;
 } | {
    kind: "launcher"; slot:number; ads:number; pitch:number; fire?:true; reload?:true;
} | {
    kind: "interact";
    id: string;
} | {
    kind: "script";
    actorId: string;
    value: number;
    playerId?: string;
} | {
    kind: "event";
    type: number;
    target: number;
    value: number;
};
type BoundedTickEffectInput = BoundedTickEffect;
type BoundedTickEffect = {
    kind: "fact";
    name: string;
    actorId: string;
} | {
    kind: "coins";
    amount: number;
    actorId: string;
} | {
    kind: "item";
    item: string;
    count: number;
    actorId: string;
} | {
    kind: "hint";
    text: string;
};
type BoundedTickCommitInput = BoundedTickCommit;
interface BoundedTickCommitFields {
    tick: number;
    snapshot: string;
    effects: ({
        kind: "fact";
        name: string;
        actorId: string;
    } | {
        kind: "coins";
        amount: number;
        actorId: string;
     } | {
        kind: "item";
        item: string;
        count: number;
        actorId: string;
    } | {
        kind: "hint";
        text: string;
    })[];
    fuelUsed?: number;
    scriptMicros?: number;
    decisions?: DecisionPublication;
}
type BoundedTickCommit = { [Key in keyof BoundedTickCommitFields]: BoundedTickCommitFields[Key] };
type BoundedAuthorProofPlanInput = BoundedAuthorProofPlan;
interface BoundedAuthorProofPlanFields {
    version: 1;
    tape: BoundedTickCommand[][];
    checkpointTick: number;
    requiredFacts: string[];
}
type BoundedAuthorProofPlan = { [Key in keyof BoundedAuthorProofPlanFields]: BoundedAuthorProofPlanFields[Key] };
type BoundedAuthorProofReportInput = BoundedAuthorProofReport;
interface BoundedAuthorProofReportFields {
    version: 1;
    ticks: number;
    checkpointTick: number;
    grid: {
        reserveBeforePhysics: true;
        runtimeFence: true;
        refusedSave: true;
        restored: true;
        frozenTicks: 5;
        loads: 2;
        leasesAfterDispose: 0;
    };
    ledger: {
        facts: {
            name: string;
            actorId: string;
            tick: number;
        }[];
        granted: number;
        durableReload: true;
        duplicateStable: true;
    };
}
type BoundedAuthorProofReport = { [Key in keyof BoundedAuthorProofReportFields]: BoundedAuthorProofReportFields[Key] };
type BoundedWorkerRequestInput = BoundedWorkerRequest;
type BoundedWorkerRequest = {kind:'walk';plan:HeadlessJourneyPlan} | {kind:'journey';plan:HeadlessJourneyPlan}
  | {kind:'step';commands:BoundedTickCommand[]}
  | {kind:'verbTape';plan:HeadlessTapePlan}
  | {kind:'verbTapePart';plan:HeadlessTapePlan}
  | {kind:'finish'} | {kind:'observe'} | {kind:'authorProof';plan:BoundedAuthorProofPlan};
