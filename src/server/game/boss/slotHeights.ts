/** Native slot heights run the shard's creature view guest. Its mutable globals and memory drive both living
 * bob and a corpse's sink, and remain owned while no body is out. Continue them with the host clock after its first call. */
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { ViewLane, ViewLaneStateSchema, type ViewLaneState } from '@wildshard/engine/script/viewLane';
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import { ViewProgramSchema } from '@wildshard/format/viewProgram';

const SPECIES = 'species:';
/** Each pooled slot's columns ahead of its fields: present, x, y, z, yaw, alive and the ground. */
const SLOT_COLUMNS = 7;
/** The view lane's own floor on a schedule: a server has no display to halve for. */
const LANE_RATE = 15;
const natural = v.pipe(v.number(), v.integer(), v.minValue(0)), byte = v.pipe(natural, v.maxValue(255));
const Saved = v.strictObject({ frames: natural, ids: v.array(v.array(v.nullable(v.string()))), memory: v.array(v.tuple([natural, v.array(byte)])), lane: v.optional(ViewLaneStateSchema) });
export interface SavedSlotHeights {readonly frames: number; readonly ids: (string | null)[][]; readonly memory: [number, number[]][]; readonly lane?: ViewLaneState}
/** Where a memory isn't zero: a page of it is mostly nothing, and a save carries each run by where it starts. */
function runsOf(bytes: Uint8Array): [number, number[]][] {
  const runs: [number, number[]][] = [];
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] === 0) continue;
    let end = at;
    while (bytes[end] !== 0 && end < bytes.length) end++;
    runs.push([at, Array.from(bytes.subarray(at, end))]);
    at = end;
  }
  return runs;
}

export class SlotHeights {
  private readonly rows;
  private readonly pools;
  private readonly lane: ViewLane;
  private readonly columns: number;
  private frames = 0;
  private readonly initialLane: ViewLaneState;
  private readonly bodies: () => readonly AnimalSim[];
  private readonly ground: (x: number, z: number) => number;
  constructor(bytes: Uint8Array, input: unknown, kind: string, scope: Scope, bodies: () => readonly AnimalSim[], ground: (x: number, z: number) => number) {
    this.bodies = bodies; this.ground = ground;
    const rows = this.rows = v.parse(ViewProgramSchema, input);
    admitScriptV2(bytes, { lane: 'view', ioBytes: rows.budget.ioBytes });
    this.pools = rows.pools.map(row => ({ row, ours: row.group === `${SPECIES}${kind}`, ids: Array.from<string | null>({ length: row.count }).fill(null) }));
    this.columns = rows.samples.reduce((sum, row) => {
      if (row.kind === 'constant') return sum + 1;
      if (row.kind !== 'pool') throw new Error('A slot view reads only constants and pools');
      const pool = rows.pools.find(entry => entry.id === row.pool);
      if (pool === undefined) throw new Error('Missing slot view pool');
      return sum + pool.count * (SLOT_COLUMNS + pool.fields.length);
    }, 0);
    this.lane = new ViewLane(bytes, rows.budget.pages, { bindings: [{ handle: 1, columns: this.columns }], transforms: [], channels: rows.channels.length, bounds: rows.bounds, targetMs: rows.budget.targetMs, fuel: rows.budget.fuel },
      { write: () => { throw new Error('A slot view has no transforms'); }, upload: () => undefined, channels: values => { this.land(values); } }, [0, 0], undefined, scope);
    this.initialLane = this.lane.snapshotState();
  }
  private land(values: Float64Array): void {
    for (const [index, row] of this.rows.channels.entries()) {
      if (row.kind !== 'field') continue;
      const pool = this.pools.find(entry => entry.row.id === row.pool), id = pool?.ours === true ? pool.ids[row.slot] : undefined, value = values[index];
      if (id === undefined || id === null || value === undefined || !Number.isFinite(value)) continue;
      const body = this.bodies().find(actor => actor.entityId === id);
      if (body !== undefined) body.yOffset = value;
    }
  }
  private field(body: AnimalSim, field: string): number {
    if (field.startsWith('has:')) return Number(Number.isFinite(body.mem[field.slice(4)]));
    const memory = body.mem[field];
    if (Number.isFinite(memory)) return memory ?? 0;
    return field === 'attackPhase' ? body.attackPhase : field === 'seed' ? body.seed : field === 'scale' ? body.scale : field === 'yOffset' ? body.yOffset : 0;
  }
  /** A guest that has run keeps its continuation even between spawns. */
  snapshot(): SavedSlotHeights | null {
    if (this.frames === 0) return null;
    return { frames: this.frames, ids: this.pools.map(pool => [...pool.ids]), memory: runsOf(new Uint8Array(this.lane.memory.buffer)), lane: this.lane.snapshotState() };
  }
  restore(input: unknown): void {
    const saved = v.parse(Saved, input), memory = new Uint8Array(this.lane.memory.buffer);
    if (saved.ids.length !== this.pools.length || this.pools.some((pool, index) => saved.ids[index]?.length !== pool.ids.length)) throw new Error('A slot height continuation lost its pools');
    for (const [at, run] of saved.memory) if (at + run.length > memory.length) throw new Error('A slot height continuation exceeds its memory');
    // Older native saves predate host clocks. This lane runs every frame at a fixed 15 Hz with a zero cost clock.
    this.lane.restoreState(saved.lane ?? { ...this.initialLane, sequence: saved.frames, frames: saved.frames });
    memory.fill(0);
    for (const [at, run] of saved.memory) memory.set(run, at);
    this.frames = saved.frames;
    for (const [index, pool] of this.pools.entries()) pool.ids.splice(0, pool.ids.length, ...saved.ids[index] ?? []);
  }
  frame(dt: number): void {
    const out = this.bodies().filter(body => this.pools.some(pool => pool.ours && pool.row.group === `${SPECIES}${body.kind}`));
    if (out.length === 0) { for (const pool of this.pools) pool.ids.fill(null); return; }
    for (const pool of this.pools) {
      if (!pool.ours) continue;
      for (const [index, id] of pool.ids.entries()) if (id !== null && !out.some(body => body.entityId === id)) pool.ids[index] = null;
      for (const body of out) { if (pool.ids.includes(body.entityId)) continue; const free = pool.ids.indexOf(null); if (free === -1) break; pool.ids[free] = body.entityId; }
    }
    const values: number[] = [];
    for (const row of this.rows.samples) {
      if (row.kind === 'constant') { values.push(row.value); continue; }
      if (row.kind !== 'pool') throw new Error('A slot view reads only constants and pools');
      const pool = this.pools.find(entry => entry.row.id === row.pool);
      if (pool === undefined) throw new Error('Missing slot view pool');
      for (const id of pool.ids) {
        const body = id === null ? undefined : out.find(actor => actor.entityId === id);
        values.push(Number(body !== undefined), body?.position.x ?? 0, body?.position.y ?? 0, body?.position.z ?? 0, body?.yaw ?? 0, Number(body?.alive === true), body === undefined ? 0 : this.ground(body.position.x, body.position.z));
        for (const field of pool.row.fields) values.push(body === undefined ? 0 : this.field(body, field));
      }
    }
    this.frames++;
    this.lane.frame(dt, 1, this.frames, [{ previousTick: this.frames - 1, currentTick: this.frames, values: [...values, ...values] }], LANE_RATE, () => 0);
  }
}
