/** H4 input capture for one admitted module. The existing authority owns this
 * inbox and includes snapshot() in its own save; this installs no scheduler. */
import { parseScriptInputStateV2,type ScriptInputStateV2 } from '@wildshard/format/scriptInputStateV2';
import type { V2Layout } from '@wildshard/format/scriptWireV2';
import type { V2EdgeInput,V2EventInput } from '../../../shared/engine/script/observationsV2';

type Edge = ScriptInputStateV2['edges'][number];
type Event = ScriptInputStateV2['events'][number];
export interface V2InputBinding {
  readonly handle: number; readonly due: boolean; readonly observed: ReadonlyMap<number,string>;
}
export interface V2InputRights {
  readonly bindings: ReadonlySet<string>; readonly players: ReadonlySet<string>;
  readonly actions: ReadonlyMap<string,number>; readonly eventKinds: ReadonlySet<number>;
  /** Remote claimed ticks may lag receipt by at most six authoritative ticks. */
  readonly lagTicks: number;
}
function tick(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid v2 input tick'); }
function handle(value: number): void { if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff) throw new Error('Invalid v2 input handle'); }
function eventValues(values: readonly number[]): boolean { return values.length === 4 && values.every(Number.isFinite); }

export class InputInboxV2 {
  private state: ScriptInputStateV2 = { version: 1,sequence: 0,receiptTick: -1,deliveryTick: -1,edges: [],events: [] };
  private generation = 0;
  private readonly edgeLimit: number;
  private readonly eventLimit: number;
  private readonly rights: V2InputRights;
  constructor(layout: V2Layout,rights: V2InputRights) {
    const edges = layout.regions[7], events = layout.regions[8], bindings = layout.regions[0], players = layout.regions[6];
    if (edges === undefined || events === undefined || bindings === undefined || players === undefined || edges.capacity > 4096 || events.capacity > 4096
      || rights.bindings.size > bindings.capacity || rights.players.size > players.capacity
      || rights.bindings.size > 64 || rights.players.size > 64 || !Number.isInteger(rights.lagTicks) || rights.lagTicks < 0 || rights.lagTicks > 6
      || [...rights.bindings,...rights.players,...rights.actions.keys()].some(id => id.length === 0 || id.length > 256)
      || new Set(rights.actions.values()).size !== rights.actions.size) throw new Error('Invalid v2 input declaration');
    for (const value of [...rights.actions.values(),...rights.eventKinds]) handle(value);
    this.edgeLimit = edges.capacity;this.eventLimit = events.capacity;
    this.rights = { bindings: new Set(rights.bindings),players: new Set(rights.players),actions: new Map(rights.actions),eventKinds: new Set(rights.eventKinds),lagTicks: rights.lagTicks };
  }
  private receipt(atTick: number): number {
    tick(atTick);
    if (atTick < this.state.receiptTick || atTick < this.state.deliveryTick || this.state.sequence === 0xffffffff) throw new Error('Stale or exhausted v2 input receipt');return this.state.sequence+1;
  }
  /** Local input always uses receiptTick. A server may supply an already
   * authenticated claimed tick; an out-of-window stamp refuses, never rewinds
   * the world or changes a previous input. Values are copied at the receipt. */
  edge(receiptTick: number,input: Omit<Edge,'atTick' | 'sequence'>,claimedTick: number = receiptTick): void {
    const sequence = this.receipt(receiptTick);tick(claimedTick);
    if (this.state.edges.length === this.edgeLimit || claimedTick > receiptTick || claimedTick < Math.max(0,receiptTick-this.rights.lagTicks)
      || !this.rights.players.has(input.player) || !this.rights.actions.has(input.action) || ![1,2,3].includes(input.phase)
      || !Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new Error('Invalid or full v2 input edge');
    this.state.edges.push({ player: input.player,action: input.action,atTick: claimedTick,sequence,phase: input.phase,x: input.x,y: input.y });
    this.state.sequence = sequence;this.state.receiptTick = receiptTick;
  }
  /** Native events carry the exact authoritative tick of their original slot. */
  event(atTick: number,input: Omit<Event,'atTick' | 'sequence' | 'values'> & { readonly values: readonly [number,number,number,number] }): void {
    const sequence = this.receipt(atTick);
    if (this.state.events.length === this.eventLimit || !this.rights.bindings.has(input.binding) || !this.rights.eventKinds.has(input.kind)
      || (input.player !== null && !this.rights.players.has(input.player)) || !eventValues(input.values)
      || (input.subject !== null && (input.subject.length === 0 || input.subject.length > 256))) throw new Error('Invalid or full v2 input event');
    this.state.events.push({ binding: input.binding,kind: input.kind,subject: input.subject,player: input.player,atTick,sequence,values: [...input.values] });
    this.state.sequence = sequence;this.state.receiptTick = atTick;
  }
  /** A retry reuses these detached records. accept runs only after the whole
   * guest candidate succeeds. It consumes this module's edges when a due binding
   * observes their player; events for sleeping bindings remain pending. New
   * arrivals after capture remain pending, even if they share the same tick. */
  capture(atTick: number,bindings: ReadonlyMap<string,V2InputBinding>,players: ReadonlyMap<string,number>): {
    readonly edges: readonly V2EdgeInput[]; readonly events: readonly V2EventInput[]; readonly validate: () => void; readonly accept: () => void;
  } {
    tick(atTick);if (atTick < this.state.deliveryTick) throw new Error('Stale v2 input delivery');
    for (const [id,value] of players) { if (!this.rights.players.has(id)) throw new Error('Unowned v2 input player');handle(value); }
    if (new Set(players.values()).size !== players.size) throw new Error('Duplicate v2 input player handle');
    const due = new Map<string,V2InputBinding>(), observers = new Set<string>();
    for (const [id,binding] of bindings) {
      if (!this.rights.bindings.has(id)) throw new Error('Unowned v2 input binding');handle(binding.handle);
      if (binding.due) { due.set(id,binding);for (const identity of binding.observed.values()) observers.add(identity); }
    }
    if (new Set([...bindings.values()].map(row => row.handle)).size !== bindings.size) throw new Error('Duplicate v2 input binding handle');
    const selectedEdges = this.state.edges.filter(row => row.atTick <= atTick && observers.has(row.player)), selectedEvents = this.state.events.filter(row => row.atTick <= atTick && due.has(row.binding));
    const player = (identity: string | null): number => {
      if (identity === null) return 0;const value = players.get(identity);if (value === undefined) throw new Error('Missing v2 input player');return value;
    };
    const edges = selectedEdges.map((row): V2EdgeInput => {
      const action = this.rights.actions.get(row.action);if (action === undefined) throw new Error('Missing v2 input action');
      return { player: player(row.player),action,atTick: row.atTick,sequence: row.sequence,phase: row.phase,x: row.x,y: row.y };
    });
    const events = selectedEvents.map((row): V2EventInput => {
      const binding = due.get(row.binding);if (binding === undefined) throw new Error('Missing v2 input binding');
      const resolve = (id: string | null): number => {
        if (id === null) return 0;
        const matches = [...binding.observed].filter(([,identity]) => identity === id), found = matches[0]?.[0];
        if (matches.length !== 1 || found === undefined) throw new Error('Stale v2 input event subject');handle(found);return found;
      };
      const playerHandle = player(row.player);if (row.player !== null && resolve(row.player) !== playerHandle) throw new Error('Unobserved v2 input event player');
      return { binding: row.binding,kind: row.kind,subject: resolve(row.subject),player: playerHandle,atTick: row.atTick,sequence: row.sequence,values: [...row.values] };
    });
    const edgeIds = new Set(selectedEdges.map(row => row.sequence)), eventIds = new Set(selectedEvents.map(row => row.sequence)), generation = this.generation;
    const validate = (): void => { if (generation !== this.generation) throw new Error('Stale v2 input acceptance'); };
    return { edges,events,validate,accept: () => {
      validate();
      this.state.edges = this.state.edges.filter(row => !edgeIds.has(row.sequence));this.state.events = this.state.events.filter(row => !eventIds.has(row.sequence));
      this.state.deliveryTick = atTick;this.generation++;
    } };
  }
  snapshot(): ScriptInputStateV2 { return structuredClone(this.state); }
  /** Existing native save authority restores this continuation without entering
   * Wasm, replaying an input or saving any transient actor/player handles. */
  restore(input: unknown): void {
    const saved = parseScriptInputStateV2(input), rows = [...saved.edges,...saved.events];
    if (saved.edges.length > this.edgeLimit || saved.events.length > this.eventLimit || new Set(rows.map(row => row.sequence)).size !== rows.length
      || rows.some(row => row.atTick > saved.receiptTick || row.sequence > saved.sequence)
      || saved.edges.some(row => !this.rights.players.has(row.player) || !this.rights.actions.has(row.action))
      || saved.events.some(row => !this.rights.bindings.has(row.binding) || !this.rights.eventKinds.has(row.kind) || (row.player !== null && !this.rights.players.has(row.player)))) throw new Error('Incompatible v2 input continuation');
    this.state = saved;this.generation++;
  }
}
