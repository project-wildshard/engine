/** ABI-v2 module scheduling and atomic publication. Existing sim authorities
 * supply/copy observations and prepare their own state/command/RNG transaction;
 * this kernel neither installs a scheduler nor bypasses those validators. */
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import { writeV2Frame,validateV2Frame,relativeTickV2,type V2Layout,type V2FrameAuthority } from '@wildshard/format/scriptWireV2';
import type { FloatColumnV2 } from '@wildshard/format/scriptMemoryV2';
import { ScriptModuleV2 } from '../../../shared/engine/script/moduleV2';
import { prepareV2Observations,type V2ObservationBatch } from '../../../shared/engine/script/observationsV2';

export interface V2BatchCapture {
  readonly observations: V2ObservationBatch;
  /** Additional host-owned query replies, native grid or RNG input banks. */
  readonly extra?: readonly { readonly kind: number; readonly count: number; readonly bytes: Uint8Array }[];
}
export interface V2PreparedTransaction {
  /** After every candidate validates, atomically consume delivered input and
   * enqueue pure query work for this tick's afterBodies phase. Non-throwing. */
  readonly accept?: () => void;
  /** All domain/ownership/quota checks have already passed. Commit is an atomic,
   * non-throwing operation of the existing owner, at the next fixed step. */
  readonly commit: () => void;
}
export interface V2BatchCandidate {
  readonly view: DataView; readonly counts: readonly number[]; readonly tick: number;
  readonly bindings: readonly { readonly identity: string; readonly handle: number }[];
  readonly excluded: number;
}
export interface V2BatchResult { readonly status: 'idle' | 'staged' | 'refused' | 'disabled'; readonly attempts: number; readonly remaining: number; readonly excluded: number }

export class SimBatchV2 {
  private readonly module: ScriptModuleV2;
  private readonly registry: readonly { readonly identity: string; readonly handle: number }[];
  private readonly layout: V2Layout;
  private readonly ordinal: number;
  private readonly handle: number;
  private readonly divisor: 2 | 6;
  private readonly fuel: number;
  private tick = -1;
  private sequence = 0;
  private failureCount = 0;
  private stopped = false;
  private busy = false;
  private pending: V2PreparedTransaction | null = null;
  private refusal: Error | null = null;
  constructor(bytes: Uint8Array,options: {
    readonly layout: V2Layout; readonly ordinal: number; readonly handle: number; readonly divisor: 2 | 6;
    readonly bindings: readonly { readonly identity: string; readonly handle: number }[];
    readonly fuel: number; readonly initFuel: number; readonly seed: readonly [number,number];
    readonly output: readonly FloatColumnV2[];
  }) {
    if (!Number.isSafeInteger(options.ordinal) || options.ordinal < 0 || ![2,6].includes(options.divisor) || !Number.isInteger(options.fuel) || options.fuel < 1 || options.fuel > 0x7fffffff) throw new Error('Invalid v2 module schedule');
    if (!Number.isInteger(options.handle) || options.handle < 1 || options.handle > 0x7fffffff) throw new Error('Invalid v2 module handle');
    this.layout = options.layout;this.ordinal = options.ordinal;this.handle = options.handle;this.divisor = options.divisor;this.fuel = options.fuel;
    this.registry = Object.freeze(options.bindings.map(({ identity,handle }) => Object.freeze({ identity,handle })).sort((a,b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
    if (new Set(this.registry.map(row => row.identity)).size !== this.registry.length || new Set(this.registry.map(row => row.handle)).size !== this.registry.length
      || this.registry.some(row => row.identity.length === 0 || !Number.isInteger(row.handle) || row.handle < 1 || row.handle > 0x7fffffff)) throw new Error('Invalid v2 module registry');
    const source = Uint8Array.from(bytes), admitted = admitScriptV2(source,{ lane: 'sim',ioBytes: options.layout.bytes });
    if (admitted.io !== options.layout.io || admitted.initialPages !== options.layout.pages) throw new Error('Mismatched v2 module layout');
    this.module = new ScriptModuleV2(source,{ seed: options.seed,initFuel: options.initFuel,ioBytes: options.layout.bytes,output: options.output });
  }
  get failures(): number { return this.failureCount; }
  get disabled(): boolean { return this.stopped; }
  get lastRefusal(): Error | null { return this.refusal; }
  /** The existing native save owner restores its tick and quarantine count.
   * No guest call, memory snapshot or transaction survives this boundary. */
  resumeAt(tick: number,failures: number): void {
    if (this.busy || !Number.isSafeInteger(tick) || tick < 0 || !Number.isInteger(failures) || failures < 0 || failures > 3) throw new Error('Invalid v2 native continuation');
    this.tick = tick;this.sequence = 0;this.pending = null;this.failureCount = failures;this.stopped = failures === 3;this.refusal = null;
  }
  /** Consecutive authoritative 60 Hz ticks only. Capture runs once, only on an
   * eligible active module tick. It must not drain a saved inbox; the prepared
   * transaction consumes input and stages all state/commands/RNG together. */
  advance(tick: number,capture: () => V2BatchCapture,prepare: (candidate: V2BatchCandidate) => V2PreparedTransaction): V2BatchResult {
    if (this.busy) throw new Error('V2 batch re-entry');
    if (!Number.isSafeInteger(tick) || tick < 0 || tick !== this.tick+1) throw new Error('V2 batch requires consecutive ticks');
    this.busy = true;
    try {
      this.pending?.commit();this.pending = null;this.tick = tick;
      if (this.stopped) return { status: 'disabled',attempts: 0,remaining: 0,excluded: 0 };
      if (tick%this.divisor !== this.ordinal%this.divisor) return { status: 'idle',attempts: 0,remaining: 0,excluded: 0 };
      const input = capture(), observations = prepareV2Observations(this.layout,tick,input.observations);
      if (observations.bindings.length !== this.registry.length || observations.bindings.some((row,i) => { const declared = this.registry[i];return declared === undefined || row.identity !== declared.identity || row.handle !== declared.handle; })
        || input.observations.bindings.some(row => row.divisor !== this.divisor)) throw new Error('V2 capture changed the declared registry');
      if (observations.due === 0) return { status: 'idle',attempts: 0,remaining: 0,excluded: 0 };
      if (this.sequence === 0xffffffff) throw new Error('V2 call sequence requires a quiescent epoch');
      const sequence = ++this.sequence, counts = new Map(observations.counts);
      // Capture extra data once too, outside the guest, so a re-step cannot
      // resample the world or advance a borrowed RNG. Copy only active banks.
      const extra: { readonly offset: number; readonly bytes: Uint8Array }[] = [];
      for (const { kind,count,bytes } of input.extra ?? []) {
        if (![12,13,14,21].includes(kind) || counts.has(kind)) throw new Error('Unexpected or duplicate v2 sim input bank');
        const region = this.layout.regions[kind-1];if (region === undefined || !Number.isSafeInteger(count) || count < 0 || count > region.capacity || bytes.length !== count*region.stride) throw new Error('Invalid v2 extra input capacity');
        counts.set(kind,count);extra.push({ offset: this.layout.io+region.offset,bytes: bytes.slice() });
      }
      const due = new Set(input.observations.bindings.filter(row => row.enabled && row.due).map(row => row.handle));
      const origin = Math.floor(tick/2**30)*2**30;let excluded = 0;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const call: { authority: V2FrameAuthority | undefined; entered: boolean } = { authority: undefined,entered: false };
        try {
          const result = this.module.step(relativeTickV2(tick,origin),this.fuel,view => {
            call.authority = writeV2Frame(view,this.layout,{ lane: 1,module: this.handle,sequence,tick,due: observations.due-(excluded === 0 ? 0 : 1) },counts);observations.write(view);
            for (const bank of extra) new Uint8Array(view.buffer,view.byteOffset+bank.offset,bank.bytes.length).set(bank.bytes);
            if (excluded !== 0) {
              const index = observations.bindings.findIndex(row => row.handle === excluded), region = this.layout.regions[0];if (index === -1 || region === undefined) throw new Error('Unknown v2 excluded binding');
              const at = this.layout.io+region.offset+index*64+12;view.setUint32(at,view.getUint32(at,true)&~2,true);
            }
            call.entered = true;
          },view => {
            if (call.authority === undefined) throw new Error('Missing v2 frame authority');
            return prepare({ view,counts: validateV2Frame(view,this.layout,call.authority),tick,bindings: observations.bindings,excluded });
          });
          result.value.accept?.();this.pending = result.value;return { status: 'staged',attempts: attempt,remaining: result.remaining,excluded };
        } catch (error) {
          if (!call.entered) throw error;
          this.refusal = error instanceof Error ? error : new Error('V2 candidate refused');
          this.failureCount++;if (this.failureCount >= 3) this.stopped = true;
          const hint = new DataView(this.module.memory.buffer).getUint32(this.layout.io+64,true);
          if (attempt === 2 || this.stopped || !due.has(hint)) return { status: this.stopped ? 'disabled' : 'refused',attempts: attempt,remaining: 0,excluded };
          excluded = hint;
        }
      }
      throw new Error('Unreachable v2 retry state');
    } finally { this.busy = false; }
  }
}
