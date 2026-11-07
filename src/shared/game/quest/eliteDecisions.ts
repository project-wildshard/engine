import * as v from 'valibot';
import { readStrikeState } from '@wildshard/engine/ai/strikeState';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { EliteCoreScript } from '../eliteSystem';
import { Rng, type RngState } from '@wildshard/engine/core/rng';
import type { EliteFeatureRows } from '@wildshard/format/eliteFeature';
import { eliteStream } from './eliteStreams';
import type { SpawnScript } from '../../../server/game/population/spawnScript';

type Fight = EliteFeatureRows['fights'][number];
/** Internal lifecycle adapter. Only built-in page/native feature factories supply an already bound script owner. */
export class EliteDecisions implements EliteCoreScript<AnimalSim> {
  readonly def: { id: string; name: string; epithet: string; lair: { x: number; z: number; r: number; }; awareR: number; engageR: number; leashR: number; rule: "always" | "dusk" | "night" | "storm"; respawnMin: number; once?: boolean; signature: string; phase2: string; drop: { skin: (string) | null; skinName: string; weapon: string; blurb: string; trophyName?: string; }; };
  readonly spawnStream: Rng;
  private readonly frameRows;
  private readonly tickRows;
  private readonly frameValues: Record<string, number>;
  private readonly tickValues: Record<string, number>;
  private phase2 = false;
  /** PF5: idle far from the player (`cadence`): its fixed steps pause */
  private far = false;
  /** PF5: a paused elite's latest frame inputs, handed to its program when it wakes (before its next tick) */
  private held = false; private heldPoint: Readonly<{ x: number; y: number; z: number }> = { x: 0, y: 0, z: 0 };
  private heldDusk = 0; private heldNight = 0; private heldGod = false; private heldYaw = 0;
  private built: SpawnScript | null = null;
  /** The fight's programme, made when a fight first asks: a page on a server never does. */
  get program(): SpawnScript { this.built ??= this.make(); return this.built; }
  constructor(readonly row: Fight, private readonly make: () => SpawnScript, feature: EliteFeatureRows, seed: number) {
    this.def = row.def;
    this.spawnStream = eliteStream(feature, seed, 'spawn', row.def.id);
    this.frameRows = row.observations.filter(observation => ['dusk', 'night', 'god'].includes(observation.source));
    this.tickRows = row.observations.filter(observation => ['engaged', 'leashing', 'phase2', 'clock'].includes(observation.source));
    this.frameValues = Object.seal(Object.fromEntries(this.frameRows.map(observation => [observation.field, 0])));
    this.tickValues = Object.seal(Object.fromEntries(this.tickRows.map(observation => [observation.field, 0])));
  }
  get isPhase2(): boolean { return this.phase2; }
  get animal(): AnimalSim | null { return this.program.body(this.row.main); }
  get brainState(): string { return this.row.modes[Number(this.program.state(this.row.main)[this.row.mode])] ?? this.row.modes[0] ?? ''; }
  spawn(): void {
    this.program.activate(this.row.spawn, this.spawnStream.next() * Math.PI * 2); this.phase2 = false;
  }
  despawn(): void { this.program.retire(this.row.main); }
  enterPhase2(): void { this.phase2 = true; }
  reset(): void { this.phase2 = false; this.program.interrupt(); }
  trophy(): void { this.program.interrupt(); }
  force(move: string): void { this.program.signal(this.row.main, this.row.forces[move] ?? this.row.defaultForce); }
  frame(point: Readonly<{ x: number; y: number; z: number }>, dusk: number, night: number, god: boolean, yaw: number): void {
    if (this.far) { this.held = true; this.heldPoint = point; this.heldDusk = dusk; this.heldNight = night; this.heldGod = god; this.heldYaw = yaw; return; }
    for (const row of this.frameRows) this.frameValues[row.field] = row.source === 'dusk' ? dusk : row.source === 'night' ? night : Number(god);
    this.program.frame(point, night, this.frameValues, yaw);
  }
  /** PF5 (G941): an idle elite far from the player pauses its program's fixed steps (decisions, steering, strikes) and holds
   *  where it stands, its steering stopped so it never walks on unsteered; nearer, aware, engaged or hit, it steps again */
  cadence(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    const body = this.animal; if (far && body !== null) body.setMotion(body.yaw, 0);
    if (!far && this.held) { this.held = false; this.frame(this.heldPoint, this.heldDusk, this.heldNight, this.heldGod, this.heldYaw); }
  }
  tick(dt: number, t: number, engaged: boolean, leashing: boolean): void {
    if (this.far) return;
    for (const row of this.tickRows) this.tickValues[row.field] = row.source === 'engaged' ? Number(engaged)
      : row.source === 'leashing' ? Number(leashing) : row.source === 'phase2' ? Number(this.phase2) : t;
    this.program.observe(this.tickValues);
    this.program.advanceFrame(dt);
  }
  prepareRestore(state: { readonly program: string; readonly spawn: RngState; readonly phase2: boolean }): () => void {
    const stream = new Rng(0); stream.restore(state.spawn);
    if (stream.snapshot().initial !== this.spawnStream.snapshot().initial) throw new Error('Incompatible elite spawn stream');
    const commit = this.program.prepareRestore(state.program);
    return () => { commit(); this.spawnStream.restore(state.spawn); this.phase2 = state.phase2; };
  }
  /** Admit the retired controller wire using row-declared slot, lane and actor mappings. */
  prepareLegacy(input: unknown): () => void {
    const finite = v.pipe(v.number(), v.finite());
    const state = v.parse(v.strictObject({ id: v.string(), animal: v.nullable(v.string()), mode: v.string(),
      fields: v.record(v.string(), v.union([finite, v.boolean(), v.null()])),
      lanes: v.array(v.strictObject({ tellT: v.pipe(finite, v.minValue(0), v.maxValue(60)), runner: v.unknown() })),
      rngs: v.array(v.strictObject({ version: v.literal(1), state: finite, initial: finite, scrambledFork: v.boolean() })) }), input);
    const mapping = this.row.legacy, mode = this.row.modes.indexOf(state.mode);
    if (state.id !== this.def.id || mode === -1 || state.rngs.length !== 2 || state.lanes.length !== mapping.lanes.length) throw new Error('Invalid historical elite identity');
    const spawn = state.rngs[0], fight = state.rngs[1];
    if (spawn === undefined || fight === undefined) throw new Error('Missing historical streams');
    new Rng(0).restore(spawn); new Rng(0).restore(fight);
    if (spawn.initial !== this.spawnStream.snapshot().initial || fight.initial !== this.row.program.seed || spawn.scrambledFork || fight.scrambledFork) throw new Error('Foreign elite stream');
    const phase = v.parse(v.boolean(), state.fields[mapping.phase]), main: Record<string, number | boolean> = { [this.row.mode]: mode };
    for (const row of mapping.fields) main[row.slot] = row.kind === 'boolean' ? v.parse(v.boolean(), state.fields[row.field])
      : state.fields[row.field] === null && row.never !== undefined ? row.never : v.parse(finite, state.fields[row.field]);
    const actors = state.animal === null ? [] : [{ slot: this.row.main, id: state.animal, state: main, rng: fight.state }];
    for (const rival of mapping.rivals) {
      const id = state.fields[rival.field], charge = v.parse(v.boolean(), state.fields[rival.charge]);
      if (id === null) { if (charge) throw new Error('Absent rival has active charge'); continue; }
      const number = v.parse(v.pipe(finite, v.integer(), v.minValue(1)), id);
      actors.push({ slot: rival.slot, id: `${mapping.actorPrefix}${number}`, state: { [this.row.mode]: charge ? mapping.rivalMode : 0 }, rng: fight.state });
    }
    const allowed = new Set([mapping.phase, ...(mapping.hidden === undefined ? [] : [mapping.hidden]), ...mapping.fields.map(row => row.field), ...mapping.rivals.flatMap(row => [row.field, row.charge])]);
    if (Object.keys(state.fields).some(key => !allowed.has(key))) throw new Error('Unknown historical elite field');
    const fields = mapping.hidden === undefined ? [] : [{ slot: this.row.main, field: this.row.program.fields.find(row => row.source === 'hidden')?.id ?? '', value: Number(v.parse(v.boolean(), state.fields[mapping.hidden])) }];
    const strikes: { actor: number; id: number; runner: ReturnType<typeof readStrikeState>; windup: number }[] = [];
    state.lanes.forEach((lane, index) => {
      const row = mapping.lanes[index], strike = this.row.program.strikes?.find(item => item.id === row?.strike);
      if (row === undefined || strike === undefined) throw new Error('Missing historical lane');
      const runner = readStrikeState(lane.runner, [{ ...strikeFromData(strike.row), windup: lane.tellT }]);
      if (runner.currentId === null) return;
      if (!actors.some(actor => actor.slot === row.slot)) throw new Error('Active lane has no actor');
      const actor = this.row.program.slots.find(item => item.id === row.slot)?.handle;
      if (actor === undefined) throw new Error('Missing historical lane actor');
      strikes.push({ actor, id: (this.row.program.strikes ?? []).indexOf(strike) + 1, runner, windup: lane.tellT });
    });
    const commit = this.program.prepareLegacy({ actors, fields, strikes });
    return () => { commit(); this.spawnStream.restore(spawn); this.phase2 = phase; };
  }
  /** Legacy public values remain readable during migration; the v1 wire owns staged commands and per-actor RNG. */
  fields(): Record<string, number | boolean | null> {
    const slots = this.program.state(this.row.main), result: Record<string, number | boolean | null> = { [this.row.legacy.phase]: this.phase2 };
    for (const row of this.row.legacy.fields) {
      const value = slots[row.slot]; if (value === undefined) throw new Error('Missing elite state field');
      result[row.field] = row.kind === 'boolean' ? Boolean(value) : row.never !== undefined && Number(value) <= row.never ? null : Number(value);
    }
    return result;
  }
}
