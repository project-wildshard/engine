/** Capture owner-resolved ABI v2 observations before entering Wasm. This is a
 * transport boundary, not an actor query service: the caller supplies scoped
 * handles and admitted action/event ids from the existing authority. */
import { relativeTickV2,type V2Layout,type V2Region } from '@wildshard/format/scriptWireV2';

interface Pose { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
interface Pair { readonly x: number; readonly z: number }
interface Sample { readonly atTick: number; readonly pose?: Pose; readonly hpShare?: number }
export interface V2BindingInput {
  readonly identity: string; readonly handle: number; readonly self: number; readonly player: number;
  readonly observed: ReadonlySet<number>; readonly enabled: boolean; readonly due: boolean;
  readonly divisor: 2 | 6; readonly fuel: number; readonly previousTick: number; readonly currentTick: number;
  readonly state: readonly number[]; readonly parameters: readonly { readonly name: string; readonly value: number }[];
  readonly fields: readonly { readonly name: string; readonly id: number; readonly value?: number | undefined }[];
  readonly sample: Sample & { readonly target: number; readonly groundY?: number; readonly walk?: Pair; readonly lineOfSight?: boolean };
}
export interface V2PlayerInput extends Sample {
  readonly identity: string; readonly handle: number; readonly forward?: Pair; readonly walkIntent?: number;
}
export interface V2EdgeInput {
  readonly player: number; readonly action: number; readonly atTick: number; readonly sequence: number;
  readonly phase: 1 | 2 | 3; readonly x: number; readonly y: number;
}
export interface V2EventInput {
  readonly binding: string; readonly kind: number; readonly subject: number; readonly player: number;
  readonly atTick: number; readonly sequence: number; readonly values: readonly [number,number,number,number];
}
export interface V2ObservationBatch {
  readonly bindings: readonly V2BindingInput[]; readonly players: readonly V2PlayerInput[];
  readonly edges: readonly V2EdgeInput[]; readonly events: readonly V2EventInput[];
  readonly actions: ReadonlySet<number>; readonly eventKinds: ReadonlySet<number>;
}
interface Bank { readonly region: V2Region; readonly bytes: Uint8Array; readonly view: DataView; readonly count: number }
function uint(value: number,positive = false): number {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0) || value > 0xffffffff) throw new Error('Invalid v2 unsigned observation');return value;
}
function handle(value: number,absent = false): number {
  uint(value,!absent);if (value > 0x7fffffff) throw new Error('Invalid v2 observation handle');return value;
}
function finite(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite v2 observation');return value; }
function share(value: number): number { finite(value);if (value < 0 || value > 1) throw new Error('Invalid v2 observed share');return value; }
function compare(a: string,b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function unique(values: readonly (string | number)[]): void { if (new Set(values).size !== values.length) throw new Error('Duplicate v2 observation identity'); }
/** `unique` over names already sorted by `compare`: a duplicate sits next to its twin (G639: a projection's few hundred
 *  field names went through a string Set on every call, ~1 ms a frame on Nalati at phone 4x) */
function uniqueSorted(rows: readonly { readonly name: string }[]): void {
  for (let i = 1; i < rows.length; i++) if (rows[i]?.name === rows[i - 1]?.name) throw new Error('Duplicate v2 observation identity');
}
/** rows in `compare` order by name; rows that already arrive in that order (a projection's cached field order) skip the
 *  copy and sort (a 163-field projection with 7 actors sorted ~1,100 rows twice a frame on Nalati's taming probe) */
function byName<T extends { readonly name: string }>(rows: readonly T[]): readonly T[] {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a !== undefined && b !== undefined && compare(a.name,b.name) > 0) return [...rows].sort((x,y) => compare(x.name,y.name));
  }
  return rows;
}
/** `unique` over small unsigned column ids with a byte map instead of a Set; ids that are not small integers fall back */
function uniqueIds(rows: readonly { readonly id: number }[]): void {
  let max = 0;
  for (const row of rows) { if (!Number.isInteger(row.id) || row.id < 0 || row.id > 0xffff) { unique(rows.map(value => value.id));return; } if (row.id > max) max = row.id; }
  const seen = new Uint8Array(max+1);
  for (const row of rows) { if (seen[row.id] === 1) throw new Error('Duplicate v2 observation identity');seen[row.id] = 1; }
}
function sorted<T extends { readonly identity: string; readonly handle: number }>(rows: readonly T[]): T[] {
  for (const row of rows) { if (row.identity.length === 0) throw new Error('Empty v2 observation identity');handle(row.handle); }
  unique(rows.map(row => row.identity));unique(rows.map(row => row.handle));return [...rows].sort((a,b) => compare(a.identity,b.identity));
}
/** Validate and copy a complete snapshot outside guest memory. The returned
 * writer is reusable for a re-step and cannot observe later owner mutations.
 * Only active input bytes are copied, never an extra whole-memory image. */
export function prepareV2Observations(layout: V2Layout,tick: number,batch: V2ObservationBatch): {
  readonly counts: ReadonlyMap<number,number>; readonly due: number;
  readonly bindings: readonly { readonly identity: string; readonly handle: number }[];
  readonly write: (view: DataView) => void;
} {
  relativeTickV2(tick,tick);const origin = Math.floor(tick/2**30)*2**30, banks: Bank[] = [];
  const stamp = (value: number): number => { const result = relativeTickV2(value,origin);if (value > tick) throw new Error('Future v2 observation');return result; };
  const bank = (kind: number,count: number): Bank => {
    const region = layout.regions[kind-1];if (region === undefined || !Number.isSafeInteger(count) || count < 0 || count > region.capacity) throw new Error('V2 observation capacity exceeded');
    const bytes = new Uint8Array(count*region.stride), result = { region,bytes,view: new DataView(bytes.buffer),count };banks.push(result);return result;
  };
  // Bound every top-level collection before sorting or copying owner data.
  const bindings = bank(1,batch.bindings.length), observations = bank(5,batch.bindings.length), players = bank(7,batch.players.length), edges = bank(8,batch.edges.length), events = bank(9,batch.events.length);
  const ordered = sorted(batch.bindings), playerRows = sorted(batch.players), playerHandles = new Set(playerRows.map(row => row.handle));
  const scoped = new Map(ordered.map(row => [row.identity,row]));
  let stateCount = 0,parameterCount = 0,fieldCount = 0;
  for (const row of ordered) { stateCount += row.state.length;parameterCount += row.parameters.length;fieldCount += row.fields.length; }
  const states = bank(2,stateCount), parameters = bank(4,parameterCount), fields = bank(6,fieldCount);
  // Candidate columns are a whole bank with the same host-owned shape.
  const candidates = layout.regions[2];if (candidates === undefined || candidates.capacity !== states.region.capacity) throw new Error('Mismatched v2 state banks');
  let stateBase = 0,paramBase = 0,fieldBase = 0,due = 0;
  const scope = (row: V2BindingInput,value: number,player = false): number => {
    handle(value,true);if (value !== 0 && (!row.observed.has(value) || (player && !playerHandles.has(value)))) throw new Error('Stale or unobserved v2 handle');return value;
  };
  const pose = (view: DataView,at: number,value: Pose | undefined): void => {
    if (value !== undefined) [value.x,value.y,value.z,value.yaw].forEach((v,i) => view.setFloat64(at+i*8,finite(v),true));
  };
  for (const [index,row] of ordered.entries()) {
    for (const value of row.observed) handle(value);
    if (![2,6].includes(row.divisor) || row.divisor !== ordered[0]?.divisor || row.fuel < 1 || row.fuel > 0x7fffffff || !Number.isInteger(row.fuel) || (row.due && !row.enabled) || row.previousTick > row.currentTick) throw new Error('Invalid v2 binding schedule');
    const at = index*64, sample = row.sample, o = index*96;
    [row.handle,scope(row,row.self),scope(row,row.player,true),(row.enabled ? 1 : 0)|(row.due ? 2 : 0),stateBase,row.state.length,paramBase,row.parameters.length,index,fieldBase,row.fields.length,row.divisor].forEach((value,i) => bindings.view.setUint32(at+i*4,uint(value),true));
    bindings.view.setInt32(at+48,stamp(row.previousTick),true);bindings.view.setInt32(at+52,stamp(row.currentTick),true);bindings.view.setUint32(at+56,row.fuel,true);
    const bits = (sample.pose === undefined ? 0 : 1)|(sample.hpShare === undefined ? 0 : 2)|(sample.groundY === undefined ? 0 : 4)|(sample.walk === undefined ? 0 : 8)|(sample.lineOfSight === undefined ? 0 : 16);
    [row.handle,row.self,scope(row,sample.target),bits].forEach((value,i) => observations.view.setUint32(o+i*4,value,true));observations.view.setInt32(o+16,stamp(sample.atTick),true);pose(observations.view,o+24,sample.pose);
    observations.view.setFloat64(o+56,sample.hpShare === undefined ? 0 : share(sample.hpShare),true);observations.view.setFloat64(o+64,sample.groundY === undefined ? 0 : finite(sample.groundY),true);
    observations.view.setFloat64(o+72,sample.walk === undefined ? 0 : finite(sample.walk.x),true);observations.view.setFloat64(o+80,sample.walk === undefined ? 0 : finite(sample.walk.z),true);observations.view.setFloat64(o+88,sample.lineOfSight ? 1 : 0,true);
    row.state.forEach((value,i) => states.view.setFloat64((stateBase+i)*8,finite(value),true));
    const params = byName(row.parameters), named = byName(row.fields);
    uniqueSorted(params);uniqueSorted(named);uniqueIds(named);
    for (const value of [...params,...named]) if (value.name.length === 0) throw new Error('Empty v2 declared column');
    params.forEach((value,i) => parameters.view.setFloat64((paramBase+i)*8,finite(value.value),true));
    named.forEach((value,i) => { const f = (fieldBase+i)*16;fields.view.setUint32(f,uint(value.id,true),true);fields.view.setUint32(f+4,value.value === undefined ? 0 : 1,true);fields.view.setFloat64(f+8,value.value === undefined ? 0 : finite(value.value),true); });
    stateBase += row.state.length;paramBase += params.length;fieldBase += named.length;if (row.due) due++;
  }
  for (const [i,row] of playerRows.entries()) {
    const at = i*80,bits = (row.pose === undefined ? 0 : 1)|(row.hpShare === undefined ? 0 : 2)|(row.forward === undefined ? 0 : 4)|(row.walkIntent === undefined ? 0 : 8);
    players.view.setUint32(at,row.handle,true);players.view.setUint32(at+4,bits,true);players.view.setInt32(at+8,stamp(row.atTick),true);pose(players.view,at+16,row.pose);
    players.view.setFloat64(at+48,row.hpShare === undefined ? 0 : share(row.hpShare),true);players.view.setFloat64(at+56,row.forward === undefined ? 0 : finite(row.forward.x),true);players.view.setFloat64(at+64,row.forward === undefined ? 0 : finite(row.forward.z),true);players.view.setFloat64(at+72,row.walkIntent === undefined ? 0 : share(row.walkIntent),true);
  }
  const edgeRows = [...batch.edges].sort((a,b) => a.atTick-b.atTick || a.sequence-b.sequence);
  unique(edgeRows.map(row => `${row.atTick}/${row.sequence}`));
  for (const [i,row] of edgeRows.entries()) {
    if (!playerHandles.has(row.player) || !batch.actions.has(row.action) || ![1,2,3].includes(row.phase)) throw new Error('Undeclared v2 input edge');
    handle(row.player);uint(row.action,true);uint(row.sequence);const at = i*32;
    edges.view.setUint32(at,row.player,true);edges.view.setUint32(at+4,row.action,true);edges.view.setInt32(at+8,stamp(row.atTick),true);edges.view.setUint32(at+12,row.phase,true);edges.view.setFloat64(at+16,finite(row.x),true);edges.view.setFloat64(at+24,finite(row.y),true);
  }
  const eventRows = [...batch.events].sort((a,b) => a.atTick-b.atTick || a.sequence-b.sequence || compare(a.binding,b.binding));
  unique(eventRows.map(row => JSON.stringify([row.atTick,row.sequence,row.binding])));
  for (const [i,row] of eventRows.entries()) {
    const owner = scoped.get(row.binding);if (owner === undefined || !batch.eventKinds.has(row.kind)) throw new Error('Undeclared v2 event');
    const at = i*56;events.view.setUint32(at,uint(row.kind,true),true);events.view.setUint32(at+4,owner.handle,true);events.view.setUint32(at+8,scope(owner,row.subject),true);events.view.setUint32(at+12,scope(owner,row.player,true),true);events.view.setInt32(at+16,stamp(row.atTick),true);events.view.setUint32(at+20,uint(row.sequence),true);
    row.values.forEach((value,j) => events.view.setFloat64(at+24+j*8,finite(value),true));
  }
  return { counts: new Map(banks.map(value => [value.region.kind,value.count])),due,bindings: Object.freeze(ordered.map(({ identity,handle: id }) => Object.freeze({ identity,handle: id }))),
    write: view => { if (view.byteLength !== layout.pages*65536) throw new Error('Wrong v2 observation memory');for (const value of banks) new Uint8Array(view.buffer,view.byteOffset+layout.io+value.region.offset,value.bytes.length).set(value.bytes); },
  };
}
