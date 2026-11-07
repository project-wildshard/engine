/** Deferred query lifecycle. One afterBodies resolver sees the complete batch;
 * no query can synchronously call back into a guest or replace contact owners. */
import { readV2QueryRequests,prepareV2QueryReplies,validateV2QueryRequest,validateV2QueryAnswer,type V2QueryRequest,type V2QueryAnswer,type V2QueryBinding,type V2QueryOperation,type V2QueryReply } from '@wildshard/format/scriptQueriesV2';
import { parseV2QueryAnswer,parseV2QuerySnapshot,type V2QuerySnapshot } from '@wildshard/format/scriptQueryStateV2';
import type { V2Layout } from '@wildshard/format/scriptWireV2';

interface Rights { readonly pending: number; readonly operations: ReadonlyMap<V2QueryOperation,number> }
interface Entry { readonly request: V2QueryRequest; readonly reply: V2QueryReply | null }
const key = (request: V2QueryRequest): string => JSON.stringify([request.binding,request.id]);
function tick(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid v2 query phase tick'); }
function scalarCount(answer: V2QueryAnswer): number {
  if (answer.status !== 1) return 0;
  switch (answer.kind) { case 'path': return answer.points.length*3;case 'overlap': return answer.bodies.length;case 'ray': return answer.hit === null ? 0 : 4;case 'walkable': case 'nearest': case 'sight': return 0;case 'grass': case 'normal': return answer.samples.length;default: throw new Error('Unknown v2 query answer'); }
}
function order(a: V2QueryRequest,b: V2QueryRequest): number { return a.binding < b.binding ? -1 : a.binding > b.binding ? 1 : a.id-b.id; }

export class QueryRingV2 {
  private readonly rights: ReadonlyMap<string,Rights>;
  private readonly layout: V2Layout;
  private readonly slots: number;
  private readonly scalars: number;
  private entries = new Map<string,Entry>();
  private highWater = new Map<string,number>();
  private phase = -1;
  private revision = 0;
  private busy = false;
  constructor(layout: V2Layout,rights: ReadonlyMap<string,Rights>) {
    const records = layout.regions[11], data = layout.regions[12];if (records === undefined || data === undefined) throw new Error('Missing v2 query reply capacity');
    this.layout = layout;this.slots = records.capacity;this.scalars = data.capacity;
    this.rights = new Map([...rights].map(([identity,row]) => {
      if (identity.length === 0 || !Number.isInteger(row.pending) || row.pending < 0 || row.pending > this.slots) throw new Error('Invalid v2 query binding quota');
      for (const [op,count] of row.operations) if (![4,5,8,9,10,11,12,13].includes(op) || !Number.isInteger(count) || count < 0 || count > this.scalars || (op === 8 && count < 4)) throw new Error('Invalid v2 query data reservation');
      this.highWater.set(identity,0);return [identity,{ pending: row.pending,operations: new Map(row.operations) }];
    }));
  }
  private capacity(entries: ReadonlyMap<string,Entry>): void {
    let data = 0;const counts = new Map<string,number>();
    if (entries.size > this.slots) throw new Error('V2 query request ring full');
    for (const { request } of entries.values()) {
      const rights = this.rights.get(request.binding), reservation = rights?.operations.get(request.op), count = (counts.get(request.binding) ?? 0)+1;
      if (rights === undefined || reservation === undefined || count > rights.pending) throw new Error('Undeclared or full v2 binding query ring');
      counts.set(request.binding,count);data += reservation;if (data > this.scalars) throw new Error('V2 query reply reservation full');
    }
  }
  /** Validate the entire candidate, including replacements for consumed ready
   * replies, before mutation. Accept only after all module candidates pass. */
  prepareFrame(view: DataView,count: number,atTick: number,bindings: ReadonlyMap<number,V2QueryBinding>,consumed: readonly V2QueryRequest[] = [],excluded = 0): (() => void) & { readonly validate: () => void } {
    if (this.busy) throw new Error('V2 query phase re-entry');
    tick(atTick);if (atTick <= this.phase) throw new Error('V2 query admitted after its afterBodies phase');
    const revision = this.revision, next = new Map(this.entries), highWater = new Map(this.highWater);
    const excludedIdentity = bindings.get(excluded)?.identity;if (excluded !== 0 && excludedIdentity === undefined) throw new Error('Unknown v2 query exclusion');
    for (const request of consumed) {
      if (request.binding === excludedIdentity) continue;
      const id = key(request), entry = next.get(id);if (entry?.reply === undefined || entry.reply === null || entry.reply.atTick >= atTick) throw new Error('V2 reply is not ready to consume');next.delete(id);
    }
    const requests = [...readV2QueryRequests(view,this.layout,count,atTick,bindings)].sort(order);
    for (const request of requests) {
      if (request.binding === excludedIdentity) throw new Error('Excluded binding emitted a v2 query');
      const previous = highWater.get(request.binding);if (previous === undefined || request.id <= previous) throw new Error('Reused or exhausted v2 query id');
      highWater.set(request.binding,request.id);next.set(key(request),{ request,reply: null });
    }
    this.capacity(next);
    const validate = (): void => { if (this.busy || this.revision !== revision) throw new Error('Stale v2 query preparation'); };
    return Object.assign(() => { validate();this.entries = next;this.highWater = highWater;this.revision++; },{ validate });
  }
  /** Hold one ring stable while the authority gathers all module requests for
   * one afterBodies physics/navmesh pass. Always release the returned loan. */
  openAfterBodies(atTick: number): {
    readonly requests: readonly V2QueryRequest[];
    readonly prepare: (answers: readonly V2QueryAnswer[]) => () => void;
    readonly release: () => void;
  } {
    if (this.busy) throw new Error('V2 query phase re-entry');
    tick(atTick);if (atTick <= this.phase) throw new Error('Repeated v2 afterBodies phase');
    this.busy = true;
    const pending = [...this.entries.values()].filter(entry => entry.reply === null && entry.request.atTick <= atTick).sort((a,b) => order(a.request,b.request));
    const revision = this.revision, loan = { active: true };
    return { requests: Object.freeze(pending.map(entry => entry.request)),prepare: answers => {
    if (!loan.active) throw new Error('Released v2 query answer preparation');
    if (answers.length !== pending.length) throw new Error('Incomplete v2 query answer batch');
    const next = new Map(this.entries);
    for (const [i,entry] of pending.entries()) {
      const answer = answers[i], limit = this.rights.get(entry.request.binding)?.operations.get(entry.request.op);
      if (answer === undefined || limit === undefined) throw new Error('Missing v2 query answer');
      const checked = parseV2QueryAnswer(scalarCount(answer) > limit ? { status: 3 } : answer,this.scalars);
      validateV2QueryAnswer(entry.request,checked);
      next.set(key(entry.request),{ request: entry.request,reply: { request: entry.request,atTick,answer: checked } });
    }
    return () => { if (!loan.active || !this.busy || this.revision !== revision) throw new Error('Stale v2 query answer preparation');this.entries = next;this.phase = atTick;this.revision++; };
    },release: () => { if (loan.active) { loan.active = false;this.busy = false; } } };
  }
  /** Single-module form; the shared authority uses answerV2QueryBatch below. */
  afterBodies(atTick: number,resolve: (requests: readonly V2QueryRequest[]) => readonly V2QueryAnswer[]): void {
    const batch = this.openAfterBodies(atTick);
    try { batch.prepare(batch.requests.length === 0 ? [] : resolve(batch.requests))(); }
    finally { batch.release(); }
  }
  /** A captured reply batch can be retried unchanged. Consume its ids together
   * with new requests in prepareFrame only when the module entry succeeds. */
  delivery(atTick: number,bindings: ReadonlyMap<string,V2QueryBinding>,due: ReadonlySet<string>): { readonly banks: ReturnType<typeof prepareV2QueryReplies>; readonly consumed: readonly V2QueryRequest[] } {
    tick(atTick);const replies = [...this.entries.values()].flatMap(entry => entry.reply === null || entry.reply.atTick >= atTick || !due.has(entry.request.binding) ? [] : [entry.reply]).sort((a,b) => order(a.request,b.request));
    return { banks: prepareV2QueryReplies(this.layout,atTick,replies,bindings),consumed: Object.freeze(replies.map(reply => reply.request)) };
  }
  snapshot(): V2QuerySnapshot {
    return parseV2QuerySnapshot({ phase: this.phase,highWater: [...this.highWater].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([binding,id]) => ({ binding,id })),
      entries: [...this.entries.values()].sort((a,b) => order(a.request,b.request)).map(entry => ({ request: entry.request,reply: entry.reply === null ? null : { atTick: entry.reply.atTick,answer: entry.reply.answer } })),
    },{ bindings: this.rights.size,requests: this.slots,scalars: this.scalars });
  }
  /** Restore admits stable ids and pending phases without init, re-querying or
   * replaying a result. Native world owners supply the restored observed ids. */
  restore(input: unknown,observed: ReadonlyMap<string,ReadonlySet<string>>): void { this.prepareRestore(input,observed)(); }
  /** Prepare detached native continuation state with a nonmutating lifetime
   * fence, so its existing owner can publish it with state and input. */
  prepareRestore(input: unknown,observed: ReadonlyMap<string,ReadonlySet<string>>): (() => void) & { readonly validate: () => void } {
    if (this.busy) throw new Error('V2 query phase re-entry');
    const revision = this.revision;
    const saved = parseV2QuerySnapshot(input,{ bindings: this.rights.size,requests: this.slots,scalars: this.scalars }), highWater = new Map<string,number>(), entries = new Map<string,Entry>();
    for (const row of saved.highWater) { if (!this.rights.has(row.binding) || highWater.has(row.binding)) throw new Error('Invalid v2 query high-water identity');highWater.set(row.binding,row.id); }
    if (highWater.size !== this.rights.size) throw new Error('Incomplete v2 query high-water registry');
    for (const entry of saved.entries) {
      const request = Object.freeze({ ...entry.request,values: Object.freeze(entry.request.values),
        ...(entry.request.points === undefined ? {} : { points: Object.freeze(entry.request.points.map(point => Object.freeze(point))) }) }), id = key(request), latest = highWater.get(request.binding), limit = this.rights.get(request.binding)?.operations.get(request.op);
      validateV2QueryRequest(request);
      if (entries.has(id) || latest === undefined || request.id > latest || limit === undefined || (request.target !== null && !observed.get(request.binding)?.has(request.target))) throw new Error('Invalid v2 pending query identity');
      if (entry.reply === null ? request.atTick <= saved.phase : entry.reply.atTick < request.atTick || entry.reply.atTick > saved.phase) throw new Error('Invalid v2 pending query phase');
      if (entry.reply !== null) { if (scalarCount(entry.reply.answer) > limit) throw new Error('Invalid v2 saved query answer');validateV2QueryAnswer(request,entry.reply.answer); }
      entries.set(id,{ request,reply: entry.reply === null ? null : { request,atTick: entry.reply.atTick,answer: entry.reply.answer } });
    }
    this.capacity(entries);
    const validate = (): void => { if (this.busy || this.revision !== revision) throw new Error('Stale v2 query restore'); };
    return Object.assign(() => { validate();this.entries = entries;this.highWater = highWater;this.phase = saved.phase;this.revision++; },{ validate });
  }
}

/** One native query pass across every due module, with all-or-none reply
 * publication. The resolver lends existing physics/navmesh owners; no guest or
 * renderer can synchronously participate in this phase. */
export function answerV2QueryBatch(rings: readonly { readonly identity: string; readonly ring: QueryRingV2 }[],atTick: number,resolve: (requests: readonly { readonly module: string; readonly request: V2QueryRequest }[]) => readonly V2QueryAnswer[]): void {
  if (new Set(rings.map(row => row.identity)).size !== rings.length || new Set(rings.map(row => row.ring)).size !== rings.length || rings.some(row => row.identity.length === 0)) throw new Error('Duplicate or empty v2 query module identity');
  const batches: { readonly identity: string; readonly batch: ReturnType<QueryRingV2['openAfterBodies']> }[] = [];
  try {
    for (const row of [...rings].sort((a,b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)) batches.push({ identity: row.identity,batch: row.ring.openAfterBodies(atTick) });
    const requests = Object.freeze(batches.flatMap(({ identity,batch }) => batch.requests.map(request => Object.freeze({ module: identity,request })))), answers = requests.length === 0 ? [] : resolve(requests);
    if (answers.length !== requests.length) throw new Error('Incomplete v2 authority query batch');
    let offset = 0;const commits: (() => void)[] = [];
    for (const { batch } of batches) { commits.push(batch.prepare(answers.slice(offset,offset+batch.requests.length)));offset += batch.requests.length; }
    for (const commit of commits) commit();
  } finally { for (const { batch } of batches) batch.release(); }
}
