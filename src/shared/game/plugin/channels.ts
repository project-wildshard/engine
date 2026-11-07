import { NumericInputError } from '@wildshard/engine/core/faults';
import { parseClientChannelInputs, parseClientChannels, type ClientChannelProgram, type ClientChannelProperty } from '@wildshard/format/clientChannels';
import { checkBorrowedOwnerPath, resolveBorrowedValue } from './borrowed';

/** Detached coordinate outputs for a private geometry kernel. */
export interface ClientTubeFrame { readonly fromX: number; readonly fromY: number; readonly fromZ: number;
  readonly toX: number; readonly toY: number; readonly toZ: number; readonly extent: number; readonly wave: number }

/** Detached connector values; only scalar DAG outputs cross into private presentation. */
export interface ClientConnectorFrame {
  readonly fromX: number; readonly fromY: number; readonly fromZ: number;
  readonly toX: number; readonly toY: number; readonly toZ: number;
  readonly atX: number; readonly atY: number; readonly atZ: number;
  readonly scaleX: number; readonly scaleY: number; readonly scaleZ: number;
  readonly enabled: number; readonly cache?: number;
}


export interface ClientChannelObservation { readonly time: number; readonly delta: number; readonly values: readonly number[] }
/** Read-only visual output; property getters expose no writable storage or authoritative object. */
export type ClientChannelFrame = Readonly<Partial<Record<ClientChannelProperty, number>>>;
/** A capability-limited numeric lane; it has no state setter, physics port, event writer or player reference. */
export function createClientChannels(input: unknown): ClientChannelLane {
  const program = parseClientChannels([input])[0]; if (program === undefined) throw new Error('Missing client channel program');
  return admittedClientChannels(program);
}
/** A numeric lane. */
export interface ClientChannelLane {
  readonly reads: readonly string[]; readonly frame: ClientChannelFrame; readonly geometry?: ClientTubeFrame; readonly connectors?: readonly ClientConnectorFrame[]; evaluate: (observation: ClientChannelObservation) => void;
  bindNumeric: (rows: readonly ClientNumericPortRow[], targets: ReadonlyMap<string, unknown>) => ClientNumericPorts;
  /** no private locals: an evaluation depends only on its observation, so a skipped one loses nothing (T10) */
  readonly stateless: boolean;
  /** it sets a node's visibility (a view of it, clientChannelView): it may be what shows a hidden model again */
  readonly toggles?: boolean;
}
/** A lane over a program its caller has just admitted with `parseClientChannels` (G639: a table installed group by group
 *  re-validated every row it had parsed; Nalati's entry spent 0.3-0.65 s frames in it). Its arrays are copied, never kept. */
/** each expression's operand slots (-1: none); a frozen node list's are made once and shared by every lane over it (G639:
 *  a herd's first pose frame made them once per body), never written */
/** the evaluator's operations in opcode order (an unknown op is 255 and refuses at evaluation) */
const OPS = ['constant', 'clock', 'read', 'local', 'neg', 'sin', 'cos', 'sqrt', 'abs', 'add', 'sub', 'mul', 'pow', 'div', 'mod', 'min', 'max',
  'atan2', 'hypot', 'hypot3', 'sample', 'gt', 'select'] as const;
const frozenData = (value: object): boolean => Object.isFrozen(value) && Object.values(Object.getOwnPropertyDescriptors(value)).every(field => 'value' in field);
const operandTables = new WeakMap<object, { readonly a: Int32Array; readonly b: Int32Array; readonly codes: Uint8Array; readonly sources: Float64Array; readonly dynamic: readonly number[] }>();
function operandsOf(nodes: ClientChannelProgram['nodes'], privateNodes: boolean): { readonly a: Int32Array; readonly b: Int32Array; readonly codes: Uint8Array; readonly sources: Float64Array; readonly dynamic: readonly number[] } {
  const known = operandTables.get(nodes); if (known !== undefined) return known;
  // Only immutable expressions can keep a result across observations. Private
  // copies qualify; a caller's shallow-frozen table may still contain live rows.
  const invariant: boolean[] = [], dynamic: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const fixed = node !== undefined && (privateNodes || frozenData(node)
      && (node.op !== 'sample' || frozenData(node.keys) && node.keys.every(frozenData)))
      && node.op !== 'read' && node.op !== 'clock' && node.op !== 'local'
      && (!('a' in node) || invariant[node.a] === true) && (!('b' in node) || invariant[node.b] === true)
      && (!('c' in node) || invariant[node.c] === true) && (!('test' in node) || invariant[node.test] === true)
      && (!('yes' in node) || invariant[node.yes] === true) && (!('no' in node) || invariant[node.no] === true);
    invariant.push(fixed); if (!fixed) dynamic.push(i);
  }
  const ops: readonly string[] = OPS;
  const sources = new Float64Array(privateNodes ? nodes.length : 0);
  const made = { dynamic, sources, a: Int32Array.from(nodes, node => 'a' in node ? node.a : -1), b: Int32Array.from(nodes, node => 'b' in node ? node.b : -1),
    codes: Uint8Array.from(nodes, (node, index) => { const code = ops.indexOf(node.op);
      // Only a lane's detached data specializes a source. Borrowed frozen
      // rows retain their original opcode, field reads and 255 fallback.
      if (privateNodes) {
        if (node.op === 'constant' && typeof node.value === 'number') { sources[index] = node.value; return 24; }
        if (node.op === 'clock') { sources[index] = Number(node.value !== 'time'); return 25; }
        if ((node.op === 'read' || node.op === 'local') && typeof node.index === 'number') {
          sources[index] = node.index; return node.op === 'read' ? 26 : 27;
        }
      }
      // Simple mutable/accessor rows retain rowValue's single live opcode read.
      return code === -1 || code < 4 && !privateNodes && !frozenData(node) ? 255 : code; }) };
  if (Object.isFrozen(nodes)) operandTables.set(nodes, made);
  return made;
}
/** A lane's published values and a reset to its first-frame state, for a merged evaluation of lanes a host steps together. */
const internals = new WeakMap<ClientChannelLane, { readonly published: Float64Array; readonly reset: () => void }>();
export function admittedClientChannels(program: ClientChannelProgram): ClientChannelLane {
  // a frozen (admitted, shared) table is read in place; any other caller's arrays are copied
  const nodes = Object.isFrozen(program.nodes) ? program.nodes : structuredClone(program.nodes), scratch = new Float64Array(nodes.length), published = new Float64Array(nodes.length), reads = new Float64Array(program.reads.length);
  const slots = program.locals !== undefined && Object.isFrozen(program.locals) ? program.locals : structuredClone(program.locals ?? []), locals = new Float64Array(slots.length), previous = new Float64Array(slots.length), next = new Float64Array(slots.length);
  let initialized = false;
  // FC CPU cut: a lane with no locals, no clock and fixed rows (frozen, or this lane's own copy) publishes the same values
  // for the same reads, so a call whose reads all equal the last call's keeps its published values without a walk
  let settled = false;   // the last call published (a refused one may have taken its reads, never its values)
  const repeatable = slots.length === 0 && nodes.every(node => node.op !== 'clock') && (nodes !== program.nodes
    || nodes.every(node => frozenData(node) && (node.op !== 'sample' || frozenData(node.keys) && node.keys.every(frozenData))));
  // each expression's operand slots, read once (-1: none), so the evaluator never asks a node which fields it has
  const { a: operandA, b: operandB, codes, sources, dynamic } = operandsOf(nodes, nodes !== program.nodes);
  const frame: Partial<Record<ClientChannelProperty, number>> = {}, index = new Map<ClientChannelProperty, number>();
  for (const channel of program.channels) { Object.defineProperty(frame, channel.property, { enumerable: true, get: () => published[channel.value] }); index.set(channel.property, channel.value); }
  Object.freeze(frame);
  const own: OwnFrame = { frame, published, index };
  const tube = program.geometry;
  const geometry: ClientTubeFrame | undefined = tube === undefined ? undefined : Object.freeze({
    get fromX() { return published[tube.from[0]] ?? Number.NaN; }, get fromY() { return published[tube.from[1]] ?? Number.NaN; }, get fromZ() { return published[tube.from[2]] ?? Number.NaN; },
    get toX() { return published[tube.to[0]] ?? Number.NaN; }, get toY() { return published[tube.to[1]] ?? Number.NaN; }, get toZ() { return published[tube.to[2]] ?? Number.NaN; },
    get extent() { return published[tube.extent] ?? Number.NaN; }, get wave() { return published[tube.wave] ?? Number.NaN; },
  });
  const connectors = program.connectors?.map(row => {
    const connectorFrame: ClientConnectorFrame = {
    get fromX() { return published[row.from[0]] ?? Number.NaN; }, get fromY() { return published[row.from[1]] ?? Number.NaN; }, get fromZ() { return published[row.from[2]] ?? Number.NaN; },
    get toX() { return published[row.to[0]] ?? Number.NaN; }, get toY() { return published[row.to[1]] ?? Number.NaN; }, get toZ() { return published[row.to[2]] ?? Number.NaN; },
    get atX() { return published[(row.at ?? row.from)[0]] ?? Number.NaN; }, get atY() { return published[(row.at ?? row.from)[1]] ?? Number.NaN; }, get atZ() { return published[(row.at ?? row.from)[2]] ?? Number.NaN; },
    get scaleX() { return published[row.scale[0]] ?? Number.NaN; }, get scaleY() { return published[row.scale[1]] ?? Number.NaN; }, get scaleZ() { return published[row.scale[2]] ?? Number.NaN; },
    get enabled() { return published[row.enabled] ?? Number.NaN; },
    };
    const cache = row.cache;
    if (cache !== undefined) Object.defineProperty(connectorFrame, 'cache', { enumerable: true, get: () => published[cache] ?? Number.NaN });
    return Object.freeze(connectorFrame);
  });
  if (connectors !== undefined) Object.freeze(connectors);
  /** one node's value by its row: the ops with operands or tables of their own, and any op off the opcode fast path */
  const rowValue = (node: ClientChannelProgram['nodes'][number], a: number, b: number, time: number, delta: number): number => {
    switch (node.op) {
      case 'constant': return node.value;
      case 'clock': return node.value === 'time' ? time : delta;
      case 'read': return reads[node.index] ?? Number.NaN;
      case 'local': return previous[node.index] ?? Number.NaN;
      case 'neg': return -a;
      case 'sin': return Math.sin(a);
      case 'cos': return Math.cos(a);
      case 'sqrt': return Math.sqrt(a);
      case 'abs': return Math.abs(a);
      case 'add': return a + b;
      case 'sub': return a - b;
      case 'mul': return a * b;
      // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
      case 'pow': return Math.pow(a, b);
      case 'div': return a / b;
      case 'mod': return a % b;
      case 'min': return Math.min(a, b);
      case 'max': return Math.max(a, b);
      case 'atan2': return Math.atan2(a, b);
      case 'hypot': return Math.hypot(a, b);
      case 'hypot3': return Math.hypot(a, b, scratch[node.c] ?? Number.NaN);
      case 'sample': {
        const last = node.keys.at(-1); if (last === undefined) throw new Error('Missing keyframe endpoint');
        for (let segment = 1; segment < node.keys.length; segment++) {
          const start = node.keys[segment - 1], end = node.keys[segment];
          if (start === undefined || end === undefined) throw new Error('Missing keyframe segment');
          if (a > end[0]) continue;
          const u = Math.max(0, Math.min(1, (a - start[0]) / Math.max(1e-6, end[0] - start[0])));
          const eased = node.interpolation === 'smoothstep' ? u * u * (3 - 2 * u) : u;
          return start[1] + (end[1] - start[1]) * eased;
        }
        return last[1];
      }
      case 'gt': return Number(a > b);
      case 'select': return (scratch[node.test] ?? Number.NaN) !== 0 ? scratch[node.yes] ?? Number.NaN : scratch[node.no] ?? Number.NaN;
      default: throw new Error('Unknown client operation');
    }
  };
  const evaluate = (observation: ClientChannelObservation): void => {
    const { time, delta, values } = observation;
    if (values.length !== reads.length) throw new Error('Invalid copied client observation');
    if (!Number.isFinite(time) || !Number.isFinite(delta) || delta < 0 || Math.abs(time) > 1e12 || delta > 1e12) throw new NumericInputError('time/delta', 'Invalid copied client observation');
    let same = initialized && repeatable && settled; settled = false;
    for (let i = 0; i < reads.length; i++) { const value = values[i]; if (value === undefined || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new NumericInputError(program.reads[i] ?? String(i), 'Invalid copied client state'); if (same && !Object.is(reads[i], value)) same = false; reads[i] = value; }
    if (same) { settled = true; return; }
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]; if (slot === undefined) throw new Error('Missing private client slot');
      previous[i] = initialized ? locals[i] ?? Number.NaN : slot.initial.op === 'constant' ? slot.initial.value : reads[slot.initial.index] ?? Number.NaN;
    }
    // The first successful frame still evaluates every expression, including
    // unused invalid arithmetic. Refusal never initializes the retained bank.
    const count = initialized ? dynamic.length : nodes.length;
    for (let j = 0; j < count; j++) {
      const i = initialized ? dynamic[j] ?? -1 : j;
      let value: number;
      const code = codes[i] ?? 255;
      switch (code) {
        case 24: value = sources[i] ?? Number.NaN; break;
        case 25: value = sources[i] === 0 ? time : delta; break;
        case 26: value = reads[sources[i] ?? -1] ?? Number.NaN; break;
        case 27: value = previous[sources[i] ?? -1] ?? Number.NaN; break;
        default: {
          const node = nodes[i]; if (node === undefined) throw new Error('Missing client expression');
          const ai = operandA[i] ?? -1, bi = operandB[i] ?? -1;
          const a = ai >= 0 ? scratch[ai] ?? Number.NaN : 0, b = bi >= 0 ? scratch[bi] ?? Number.NaN : 0;
          // G639: the arithmetic ops by their small opcode (one per node, shared like the operands), the rest by their row
          switch (code) {
            case 0: value = node.op === 'constant' ? node.value : rowValue(node, a, b, time, delta); break;
            case 1: value = node.op === 'clock' ? node.value === 'time' ? time : delta : rowValue(node, a, b, time, delta); break;
            case 2: value = node.op === 'read' ? reads[node.index] ?? Number.NaN : rowValue(node, a, b, time, delta); break;
            case 3: value = node.op === 'local' ? previous[node.index] ?? Number.NaN : rowValue(node, a, b, time, delta); break;
            case 4: value = -a; break;
            case 5: value = Math.sin(a); break;
            case 6: value = Math.cos(a); break;
            case 7: value = Math.sqrt(a); break;
            case 8: value = Math.abs(a); break;
            case 9: value = a + b; break;
            case 10: value = a - b; break;
            case 11: value = a * b; break;
            // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
            case 12: value = Math.pow(a, b); break;
            case 13: value = a / b; break;
            case 14: value = a % b; break;
            case 15: value = Math.min(a, b); break;
            case 16: value = Math.max(a, b); break;
            case 17: value = Math.atan2(a, b); break;
            case 18: value = Math.hypot(a, b); break;
            case 21: value = Number(a > b); break;
            default: value = rowValue(node, a, b, time, delta); break;
          }
          break;
        }
      }
      if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new NumericInputError(String(i), 'Non-finite or excessive client expression');
      scratch[i] = value;
    }
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]; if (slot === undefined) throw new Error('Missing private client slot');
      next[i] = scratch[slot.next] ?? Number.NaN;
    }
    published.set(scratch); locals.set(next); initialized = true; settled = true;
  };
  const lane: ClientChannelLane = Object.freeze({ bindNumeric: (rows: readonly ClientNumericPortRow[], targets: ReadonlyMap<string, unknown>) => createClientNumericPorts(rows, targets, own), reads: Object.freeze([...program.reads]), frame, evaluate, stateless: slots.length === 0, ...(geometry === undefined ? {} : { geometry }), ...(connectors === undefined ? {} : { connectors }) });
  internals.set(lane, { published, reset: () => { initialized = false; settled = false; } });
  return lane;
}

/** One evaluation for programs a host steps together over one copied read vector (a creature rig's pose programs): their
 *  structurally identical expressions (the same op and row data over the same canonical operands, reads by vector slot)
 *  share one node, so each is computed once a frame. Every node is a pure function of the reads, the clock and its row,
 *  so a merged node equals each copy it stands for, bit for bit; a refused merged frame reruns the lanes themselves. */
export interface MergedChannelPlan { readonly program: ClientChannelProgram; readonly outputs: readonly (readonly [lane: number, slot: number, merged: number])[] }
const exactNumber = (value: number): string => Object.is(value, -0) ? '-0' : String(value);
export function planMergedChannels(programs: readonly ClientChannelProgram[], readNames: readonly string[]): MergedChannelPlan | null {
  if (programs.some(program => program.locals !== undefined)) return null;
  const nodes: ClientChannelProgram['nodes'][number][] = [], byKey = new Map<string, number>(), outputs: [number, number, number][] = [];
  for (const [laneIndex, program] of programs.entries()) {
    const canonical: number[] = [];
    const at = (index: number): number => { const merged = canonical[index]; if (merged === undefined) throw new Error('Invalid merged channel operand'); return merged; };
    for (const node of program.nodes) {
      let row: ClientChannelProgram['nodes'][number];
      switch (node.op) {
        case 'constant': case 'clock': case 'local': row = node; break;
        case 'read': { const slot = readNames.indexOf(program.reads[node.index] ?? ''); if (slot === -1) return null; row = { op: 'read', index: slot }; break; }
        case 'neg': case 'sin': case 'cos': case 'sqrt': case 'abs': row = { op: node.op, a: at(node.a) }; break;
        case 'hypot3': row = { op: 'hypot3', a: at(node.a), b: at(node.b), c: at(node.c) }; break;
        case 'sample': row = { op: 'sample', a: at(node.a), interpolation: node.interpolation, keys: node.keys.map(([x, y]) => [x, y]) }; break;
        case 'select': row = { op: 'select', test: at(node.test), yes: at(node.yes), no: at(node.no) }; break;
        case 'add': case 'sub': case 'mul': case 'div': case 'mod': case 'min': case 'max': case 'atan2': case 'hypot': case 'gt': case 'pow':
          row = { op: node.op, a: at(node.a), b: at(node.b) }; break;
        default: return null;
      }
      const key = row.op === 'constant' ? `constant ${exactNumber(row.value)}` : row.op === 'sample'
        ? `sample ${row.a} ${row.interpolation} ${row.keys.map(([x, y]) => `${exactNumber(x)},${exactNumber(y)}`).join(' ')}` : JSON.stringify(row);
      let merged = byKey.get(key);
      if (merged === undefined) { merged = nodes.length; nodes.push(row); byKey.set(key, merged); }
      canonical.push(merged);
    }
    for (const channel of program.channels) outputs.push([laneIndex, channel.value, at(channel.value)]);
  }
  const program: ClientChannelProgram = { id: 'merged', reads: [...readNames], nodes, channels: [] };
  const deep = <T,>(value: T): T => { if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) { for (const field of Object.values(value)) deep(field); Object.freeze(value); } return value; };
  return deep({ program, outputs });
}
/** Publish a merged lane's last frame into the lanes it stands for, at their channels' slots. Each lane returns to its
 *  first-frame state, so a frame it later evaluates itself recomputes every expression from its own reads. */
export function publishMergedChannels(plan: MergedChannelPlan, merged: ClientChannelLane, lanes: readonly ClientChannelLane[]): void {
  const source = internals.get(merged)?.published; if (source === undefined) throw new Error('Unknown merged channel lane');
  for (const lane of lanes) internals.get(lane)?.reset();
  for (const [laneIndex, slot, at] of plan.outputs) {
    const lane = lanes[laneIndex], target = lane === undefined ? undefined : internals.get(lane)?.published;
    if (target === undefined) throw new Error('Unknown merged channel target');
    target[slot] = source[at] ?? Number.NaN;
  }
}


/** A numeric visual loan: a copied channel writes one named field, never a script-state grant. */
export interface ClientNumericPortRow {
  readonly property: ClientChannelProperty; readonly target: string; readonly path: readonly string[];
  readonly restore?: boolean; readonly nullable?: boolean;
}
/** Bind a bounded list of explicitly loaned visual fields. Unknown roots, prototypes, non-numeric fields,
 * authoritative actor classes and readonly fields refuse. Capture restores only declared borrowed values;
 * this binder owns no clock, scene object, listener or simulation state. */
export interface ClientNumericPorts { apply: (frame: ClientChannelFrame) => void; capture: () => () => void }
/** a lane's own frame as its published values: a port applying that frame reads the value, not the frame's getter */
interface OwnFrame { readonly frame: ClientChannelFrame; readonly published: Float64Array; readonly index: ReadonlyMap<ClientChannelProperty, number> }
function createClientNumericPorts(rows: readonly ClientNumericPortRow[], targets: ReadonlyMap<string, unknown>, own?: OwnFrame): ClientNumericPorts {
  if (rows.length > 32) throw new Error('Numeric visual port roster exceeds its bound');
  const ports = rows.flatMap(row => {
    const root = targets.get(row.target); if (root === null) return [];
    if (/^(?:player|shared|state)(?:[.:]|$)/u.test(row.target) || row.path.length === 0 || row.path.length > 2
      || row.path.some(key => key.length === 0 || key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid numeric visual loan');
    if (typeof root !== 'object') throw new Error('Missing numeric visual target');
    const scene = 'isObject3D' in root && root.isObject3D === true; // three's own marker: this module loads no scene class
    const prototype: unknown = Object.getPrototypeOf(root);
    if (!scene && prototype !== Object.prototype && prototype !== null) throw new Error('Numeric ports require plain visual fields');
    if (scene && (row.path.length !== 2 || !['position', 'rotation', 'scale'].includes(row.path[0] ?? '') || !['x', 'y', 'z'].includes(row.path[1] ?? ''))) throw new Error('Numeric scene port must be a transform');
    let parent: unknown = root;
    for (const key of row.path.slice(0, -1)) {
      if (typeof parent !== 'object' || parent === null || !Object.hasOwn(parent, key)) throw new Error('Missing numeric visual owner');
      parent = Reflect.get(parent, key);
    }
    const key = row.path.at(-1);
    if (typeof parent !== 'object' || parent === null || key === undefined || (!scene && !Object.hasOwn(parent, key))) throw new Error('Missing numeric visual field');
    const value: unknown = Reflect.get(parent, key);
    if (typeof value !== 'number' && !(row.nullable === true && value === null)) throw new Error('Visual field is not numeric');
    return [{ row, target: parent, key, slot: own?.index.get(row.property) ?? -1 }];
  });
  return {
    apply: frame => { const mine = own !== undefined && frame === own.frame; for (const { row, target, key, slot } of ports) {
      const value = mine && slot >= 0 ? own.published[slot] : frame[row.property];
      if (value === undefined || !Number.isFinite(value) || Math.abs(value) > 1e12 || !Reflect.set(target, key, value)) throw new Error('Numeric visual write refused');
    } },
    capture: () => { const saved = ports.filter(port => port.row.restore === true).map(port => {
      const value: unknown = Reflect.get(port.target, port.key); return { target: port.target, key: port.key, value };
    }); return () => { for (const row of saved) if (!Reflect.set(row.target, row.key, row.value)) throw new Error('Numeric visual restore refused'); }; },
  };
}

/** Borrow admitted scalar fields from supplied owners, never publishing their objects to the channel evaluator. */
export function bindClientChannelInputs(input: unknown, owners: ReadonlyMap<string, unknown>, reads: ReadonlySet<string>): ReadonlyMap<string, () => number> {
  return new Map([...bindClientChannelInputRows(input, owners, reads)].map(([id, row]) => [id, row.read]));
}
/** `bindClientChannelInputs` with each read's owner path as a key: reads of one field by many lanes share one value */
export function bindClientChannelInputRows(input: unknown, owners: ReadonlyMap<string, unknown>, reads: ReadonlySet<string>): ReadonlyMap<string, { readonly key: string; readonly read: () => number }> {
  const rows = parseClientChannelInputs(input), bound = new Map<string, { readonly key: string; readonly read: () => number }>();
  for (const row of rows) {
    if (!reads.has(row.input)) throw new Error(`Unused numeric input ${row.input}`);
    // the row's path is checked once here; every later read resolves it
    checkBorrowedOwnerPath(row);
    const read = (): number => {
      const value = resolveBorrowedValue(owners, row);
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new NumericInputError(row.input);
      return value;
    };
    read(); bound.set(row.input, { key: JSON.stringify([row.owner, row.path]), read });
  }
  return bound;
}
