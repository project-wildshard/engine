import { HeadlessObservationReportSchema, type HeadlessObservationReport } from '../../shared/host/headlessObservation';
import type {HeadlessTapePlan,HeadlessTapeReport,HeadlessTapeSegment} from '../../shared/host/headlessTape';
import { HeadlessJourneyPlanSchema, HeadlessJourneyReportSchema, type HeadlessJourneyPlan, type HeadlessJourneyReport } from '../../shared/host/headlessJourney';
// oxlint-disable-next-line import/no-nodejs-modules -- A separate isolate makes blocked WASM and native host queries preemptible.
import { Worker } from 'node:worker_threads';
// oxlint-disable-next-line import/no-nodejs-modules -- Same monotonic wall clock as the worker, independent of its event loop.
import { hrtime } from 'node:process';
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { tickCommands, TickCommitSchema, HeadlessTapePlanSchema, HeadlessTapeReportSchema, AuthorProofPlanSchema, AuthorProofReportSchema, HeadlessTapePartReportSchema, type HeadlessTapePartReport, type AuthorProofPlan, type AuthorProofReport, type HeadlessCommandSource, type HeadlessTickCommit } from '../../shared/host/tickProtocol';

import {TapePartBudget} from '../../shared/host/headlessTapeParts';

const proofSchema: v.StrictObjectSchema<{ readonly ticks: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 0, undefined>]>; readonly lanes: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 0, undefined>]>; readonly steps: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 0, undefined>]>; readonly liftRides: v.ExactOptionalSchema<v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 0, undefined>, v.MaxValueAction<number, 8, undefined>]>, undefined>; readonly liftCalls: v.ExactOptionalSchema<v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 0, undefined>, v.MaxValueAction<number, 8, undefined>]>, undefined>; readonly portalTransfers: v.ExactOptionalSchema<v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 0, undefined>, v.MaxValueAction<number, 8, undefined>]>, undefined>; }, undefined> = v.strictObject({ ticks: v.pipe(v.number(), v.integer(), v.minValue(0)), lanes: v.pipe(v.number(), v.integer(), v.minValue(0)), steps: v.pipe(v.number(), v.integer(), v.minValue(0)),
  liftRides: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8))), liftCalls: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8))),
  portalTransfers: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8))) });
const replySchema = v.variant('kind', [v.strictObject({kind:v.literal('verbTapePart'),value:HeadlessTapePartReportSchema}), v.strictObject({kind:v.literal('observation'),value:HeadlessObservationReportSchema}), v.strictObject({kind:v.literal('verbTape'),value:HeadlessTapeReportSchema}), v.strictObject({ kind: v.literal('commit'), value: TickCommitSchema }), v.strictObject({ kind: v.literal('journey'), value: HeadlessJourneyReportSchema }), v.strictObject({ kind: v.literal('walk'), value: v.strictObject({report:HeadlessJourneyReportSchema,commit:TickCommitSchema}) }), v.strictObject({ kind: v.literal('proof'), value: proofSchema }), v.strictObject({ kind: v.literal('authorProof'), value: AuthorProofReportSchema })]);
type Reply = v.InferOutput<typeof replySchema>;
/** A deadline failure quarantines the worker while retaining the last fully committed continuation. */
export class HeadlessDeadlineError extends Error {
  readonly checkpoint: HeadlessTickCommit | undefined;
  readonly elapsedMicros: number;
  constructor(checkpoint: HeadlessTickCommit | undefined, elapsedMicros: number) { super(`Headless tick deadline exceeded at ${elapsedMicros.toFixed(0)} us; worker quarantined`); this.name = 'HeadlessDeadlineError'; this.checkpoint = checkpoint === undefined ? undefined : structuredClone(checkpoint); this.elapsedMicros = elapsedMicros; }
}
/** Internal parent-side runner; its module URL is selected only by trusted platform code. */
export class TickWorkerHost {
  private readonly worker: Worker;
  private readonly clock = new BigInt64Array(new SharedArrayBuffer(24));
  private last: HeadlessTickCommit | undefined;
  private pending: { resolve: (value: Reply) => void; reject: (error: Error) => void } | undefined;
  private requestStarted = 0n;
  private streamStarted = 0n;
  private parts:TapePartBudget|undefined;
  private streamReject:((error:Error)=>void)|undefined;
  private closed = false;
  private cold = true;
  private tickBudgetMicros: number;
  private readonly scope = new Scope('headless watchdog');
  private readonly ready: Promise<Reply>;
  private readonly budget: { tickMicros: number; commandsPerTick: number };
  private readonly deadline: 'runtime' | 'advisory';
  /** preparePayload overlaps trusted module imports with parent admission. The
   * worker receives no payload until it succeeds; the original request clock
   * starts before both operations and is never reset by payload delivery. */
  constructor(url: URL, payload: unknown, budget: { tickMicros: number; commandsPerTick: number }, execArgv: string[] = [], deadline: 'runtime' | 'advisory' = 'runtime', preparePayload?: () => Promise<unknown>) {
    this.budget = budget; this.deadline = deadline;
    if (!Number.isInteger(budget.tickMicros) || budget.tickMicros < 1 || budget.tickMicros > 16_666 || !Number.isInteger(budget.commandsPerTick) || budget.commandsPerTick < 0 || budget.commandsPerTick > 1024) throw new Error('Invalid headless budget');
    if (preparePayload !== undefined && payload !== undefined) throw new Error('Deferred worker payload must have one owner');
    this.tickBudgetMicros = budget.tickMicros;
    this.ready = this.wait();
    this.worker = new Worker(url, { workerData: { payload, ...budget, clock: this.clock.buffer, enforceTickDeadline: deadline === 'runtime', ...(preparePayload === undefined ? {} : {deferredPayload: true}) }, execArgv });
    this.worker.on('message', (raw: unknown) => {
      try {
        const message = v.parse(v.union([v.strictObject({observation:HeadlessObservationReportSchema}), v.strictObject({verbTape:HeadlessTapeReportSchema}), v.strictObject({verbTapePart:HeadlessTapePartReportSchema}), v.strictObject({ commit: TickCommitSchema }), v.strictObject({ proof: proofSchema }), v.strictObject({ journey: HeadlessJourneyReportSchema }), v.strictObject({walk:v.strictObject({report:HeadlessJourneyReportSchema,commit:TickCommitSchema})}), v.strictObject({ authorProof: AuthorProofReportSchema }), v.strictObject({ error: v.string() })]), raw);
        if ('error' in message) { this.fail(message.error.includes('tick deadline') ? new HeadlessDeadlineError(this.last, Number(Atomics.load(this.clock, 2)) / 1000) : new Error(message.error)); return; }
        const reply: Reply = 'verbTapePart' in message ? {kind:'verbTapePart',value:message.verbTapePart} : 'observation' in message ? {kind:'observation',value:message.observation} : 'verbTape' in message ? {kind:'verbTape',value:message.verbTape} : 'commit' in message ? { kind: 'commit', value: message.commit } : 'proof' in message ? { kind: 'proof', value: message.proof } : 'journey' in message ? { kind: 'journey', value: message.journey } : 'walk' in message ? {kind:'walk',value:message.walk} : { kind: 'authorProof', value: message.authorProof };
        if(this.parts!==undefined&&!this.finished&&reply.kind!=='verbTapePart')throw new Error('Missing native tape part checkpoint');
        if (reply.kind === 'commit') this.last = structuredClone(reply.value);
        else if(reply.kind==='walk'||reply.kind==='observation')this.last=structuredClone(reply.value.commit);
        const pending = this.pending; this.pending = undefined; pending?.resolve(reply);
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    this.worker.on('error', (error: unknown) => { this.fail(error instanceof Error ? error : new Error(String(error))); });
    this.worker.on('exit', code => { if (!this.closed) this.fail(new Error(`Headless worker exited: ${code}`)); });
    this.scope.interval(1, () => {
      const now = hrtime.bigint();
      if (this.deadline === 'runtime' && Atomics.load(this.clock, 0) === 1n && now - Atomics.load(this.clock, 1) > BigInt(this.tickBudgetMicros) * 1000n) this.fail(new HeadlessDeadlineError(this.last, Number(now - Atomics.load(this.clock, 1)) / 1000));
      else if ((this.streamStarted!==0n&&now-this.streamStarted>30_000_000_000n)||(this.pending !== undefined && now - this.requestStarted > 30_000_000_000n)) this.fail(new Error('Headless worker request deadline exceeded; quarantined'));
    });
    if (preparePayload !== undefined) {
      const worker = this.worker;
      // Observe admission immediately, including synchronous factory refusal.
      void (async () => {
        try {
          const admitted = await preparePayload();
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
          if (!this.closed) worker.postMessage({initialize: admitted});
        } catch (error) { this.fail(error instanceof Error ? error : new Error('Worker payload preparation refused', {cause: error})); }
      })();
    }
  }
  private wait(): Promise<Reply> {
    this.requestStarted = hrtime.bigint();
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true; this.scope.dispose();this.streamReject?.(error);
    const pending = this.pending; this.pending = undefined; pending?.reject(error); void this.worker.terminate();
  }
  async initialized(): Promise<void> { const reply = await this.ready; if (reply.kind !== 'commit') throw new Error('Missing initial worker checkpoint'); }
  get quarantined(): boolean { return this.closed; }
  get checkpoint(): HeadlessTickCommit | undefined { return this.last === undefined ? undefined : structuredClone(this.last); }
  get lastTickMicros(): number { return Number(Atomics.load(this.clock, 2)) / 1000; }
  async step(sources: readonly HeadlessCommandSource[] = []): Promise<HeadlessTickCommit> {
    const commands = tickCommands(sources, this.budget.commandsPerTick);
    if (this.finished) throw new Error('Headless validation finished; resume a fresh worker from the committed checkpoint');
    await this.initialized(); if (this.closed || this.pending !== undefined || this.streamStarted!==0n||this.parts!==undefined) throw new Error('Headless worker unavailable or busy');
    this.tickBudgetMicros = this.cold ? 16_666 : this.budget.tickMicros; this.cold = false;
    Atomics.store(this.clock, 0, 0n); const result = this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
    this.worker.postMessage({ kind: 'step', commands });
    const reply = await result; if (reply.kind !== 'commit') throw new Error('Missing worker tick checkpoint'); return reply.value;
  }
  /** Fixed terminal offline observation; only initial/final continuations escape. */
  async observe(): Promise<HeadlessObservationReport> {
    if (this.deadline !== 'advisory') throw new Error('Observation requires trusted offline timing');
    if (this.finished) throw new Error('Headless validation already finished');
    await this.initialized(); if (this.closed || this.pending !== undefined || this.streamStarted!==0n||this.parts!==undefined) throw new Error('Headless worker unavailable or busy');
    this.finished = true; const result = this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
    this.worker.postMessage({ kind: 'observe' });
    const reply = await result; if (reply.kind !== 'observation') throw new Error('Missing offline observation report');
    return reply.value;
  }
  /** Terminal offline route; retains the original request watchdog and entry checkpoint. */
  async journey(input:HeadlessJourneyPlan):Promise<HeadlessJourneyReport> {
    const plan=v.parse(HeadlessJourneyPlanSchema,input);
    if(this.deadline!=='advisory')throw new Error('Journey requires trusted offline timing');
    if(this.budget.commandsPerTick<1)throw new Error('Journey needs one player command per tick');
    if(this.finished)throw new Error('Headless validation already finished');
    await this.initialized();if(this.closed||this.pending!==undefined||this.streamStarted!==0n||this.parts!==undefined)throw new Error('Headless worker unavailable or busy');
    this.finished=true;const result=this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
    this.worker.postMessage({kind:'journey',plan});
    const reply=await result;if(reply.kind!=='journey')throw new Error('Missing headless journey report');return reply.value;
  }
  /** One bounded native physics leg, with a full checked continuation for the next leg. */
  async walkLeg(input:HeadlessJourneyPlan):Promise<HeadlessJourneyReport> {
    const plan=v.parse(HeadlessJourneyPlanSchema,input);
    if(this.deadline!=='advisory')throw new Error('Walk requires trusted offline timing');
    if(this.budget.commandsPerTick<1)throw new Error('Walk needs one player command per tick');
    if(this.finished)throw new Error('Headless validation already finished');
    await this.initialized();if(this.closed||this.pending!==undefined||this.streamStarted!==0n||this.parts!==undefined)throw new Error('Headless worker unavailable or busy');
    const result=this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
    this.worker.postMessage({kind:'walk',plan});
    const reply=await result;if(reply.kind!=='walk')throw new Error('Missing native walk checkpoint');return reply.value.report;
  }
  /** Terminal native command tape; its observations never replace the last committed checkpoint. */
  async verbTape(input:HeadlessTapePlan):Promise<HeadlessTapeReport>{
    const plan=v.parse(HeadlessTapePlanSchema,input);
    if(this.deadline!=='advisory')throw new Error('Verb tape requires trusted offline timing');
    for(const segment of plan.segments){
      for(const commands of segment.frames??[segment.commands]){
        tickCommands([{source:'verb-tape',commands}],this.budget.commandsPerTick);
        if(commands.length+(segment.route===undefined?0:1)>this.budget.commandsPerTick)throw new Error('Aggregate commandsPerTick exceeded');
      }
    }
    if(this.finished)throw new Error('Headless validation already finished');
    await this.initialized();if(this.closed||this.pending!==undefined||this.streamStarted!==0n||this.parts!==undefined)throw new Error('Headless worker unavailable or busy');
    this.finished=true;const result=this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser origin.
    this.worker.postMessage({kind:'verbTape',plan});
    const reply=await result;if(reply.kind!=='verbTape')throw new Error('Missing native verb tape report');return reply.value;
  }
  /** One non-terminal offline part, under the unchanged per-request watchdog.
   * The first part pins this worker to the tape until finish or disposal. */
  async verbTapePart(input:HeadlessTapePlan):Promise<HeadlessTapePartReport>{
    const plan=v.parse(HeadlessTapePlanSchema,input);
    if(this.deadline!=='advisory')throw new Error('Verb tape requires trusted offline timing');
    for(const segment of plan.segments)for(const commands of segment.frames??[segment.commands]){
      tickCommands([{source:'verb-tape',commands}],this.budget.commandsPerTick);
      if(commands.length+(segment.route===undefined?0:1)>this.budget.commandsPerTick)throw new Error('Aggregate commandsPerTick exceeded');
    }
    if(this.finished)throw new Error('Headless validation already finished');
    await this.initialized();if(this.closed||this.pending!==undefined||this.streamStarted!==0n)throw new Error('Headless worker unavailable or busy');
    const before=this.last;if(before===undefined)throw new Error('Tape part requires its initial checkpoint');
    const guard=this.parts??new TapePartBudget(before.tick);guard.admit(plan);this.parts=guard;
    const result=this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser origin.
    this.worker.postMessage({kind:'verbTapePart',plan});
    try{
      const reply=await result;if(reply.kind!=='verbTapePart')throw new Error('Missing native tape part checkpoint');
      guard.accept(reply.value);this.last=structuredClone(reply.value.commit);return reply.value;
    }catch(error){this.fail(error instanceof Error?error:new Error(String(error)));throw error;}
  }
  /** Terminal bounded tape produced incrementally. Prefetch only the next
   * recorded segment while the same fresh worker executes its predecessor. */
  async streamVerbTape(observe:readonly string[],source:AsyncIterable<HeadlessTapeSegment>):Promise<HeadlessTapeReport>{
    if(this.deadline!=='advisory')throw new Error('Verb tape requires trusted offline timing');
    if(this.finished)throw new Error('Headless validation already finished');
    await this.initialized();if(this.closed||this.pending!==undefined||this.streamStarted!==0n||this.parts!==undefined)throw new Error('Headless worker unavailable or busy');
    const iterator=source[Symbol.asyncIterator]();
    this.finished=true;this.streamStarted=hrtime.bigint();
    const failed=new Promise<never>((_resolve,reject)=>{this.streamReject=reject;});
    const observations:HeadlessTapeReport['observations']=[],ids=new Set<string>(),encoder=new TextEncoder();
    let ticks=0,commands=0,bytes=0,committed=0;
    try{
      let current=await Promise.race([(async()=>{const next=await iterator.next();return next;})(),failed]);
      while(!current.done){
        const plan=v.parse(HeadlessTapePlanSchema,{version:1,observe:[...observe],segments:[current.value]}),segment=plan.segments[0];
        if(segment===undefined)throw new Error('Missing streamed tape segment');
        ticks+=segment.ticks;commands+=segment.frames?.reduce((sum,frame)=>sum+frame.length,0)??segment.commands.length;
        if(ids.has(segment.id)||ids.size>=128||ticks>60_000||commands>60_000)throw new Error('Streamed tape aggregate allowance exceeded');
        ids.add(segment.id);
        for(const frame of segment.frames??[segment.commands]){
          tickCommands([{source:'verb-tape',commands:frame}],this.budget.commandsPerTick);
          if(frame.length+(segment.route===undefined?0:1)>this.budget.commandsPerTick)throw new Error('Aggregate commandsPerTick exceeded');
        }
        const pending=this.wait();
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser origin.
        this.worker.postMessage({kind:'verbTape',plan});
        const upcoming=(async()=>{try{return {value:await iterator.next()};}catch(error){return {error};}})();
        const reply=await Promise.race([pending,failed]);
        if(hrtime.bigint()-this.streamStarted>30_000_000_000n)throw new Error('Headless worker request deadline exceeded; quarantined');
        if(reply.kind!=='verbTape')throw new Error('Missing native verb tape report');
        committed+=reply.value.ticks;
        for(const row of reply.value.observations){bytes+=encoder.encode(JSON.stringify(row)).byteLength;observations.push(row);}
        if(bytes>8_000_000)throw new Error('Tape observation allowance exceeded');
        const next=await Promise.race([upcoming,failed]);if('error' in next)throw next.error;current=next.value;
      }
      if(ids.size===0)throw new Error('Empty streamed tape');
      return v.parse(HeadlessTapeReportSchema,{version:1,ticks:committed,observations});
    }catch(error){this.fail(error instanceof Error?error:new Error(String(error)));throw error;}
    finally{this.streamStarted=0n;this.streamReject=undefined;void (async()=>{try{await iterator.return?.();}catch{ /* Producer cleanup cannot replace the original failure. */ }})();}
  }
  async finish(): Promise<v.InferOutput<typeof proofSchema>> {
    if (this.finished) throw new Error('Headless validation already finished');
    await this.initialized(); if (this.closed || this.pending !== undefined || this.streamStarted!==0n) throw new Error('Headless worker unavailable or busy');
    this.finished = true;
    const result = this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
    this.worker.postMessage({ kind: 'finish' });
    const reply = await result; if (reply.kind !== 'proof') throw new Error('Missing headless validation proof'); return reply.value;
  }
  /** Terminal offline proof, under the same independent request watchdog. */
  async authorProof(input: AuthorProofPlan): Promise<AuthorProofReport> {
    const plan = v.parse(AuthorProofPlanSchema, input);
    for (const commands of plan.tape) tickCommands([{ source: 'author-proof', commands }], this.budget.commandsPerTick);
    if (this.finished) throw new Error('Headless validation already finished');
    await this.initialized(); if (this.closed || this.pending !== undefined || this.streamStarted!==0n||this.parts!==undefined) throw new Error('Headless worker unavailable or busy');
    this.finished = true; const result = this.wait();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messages have no browser target origin.
    this.worker.postMessage({ kind: 'authorProof', plan });
    const reply = await result; if (reply.kind !== 'authorProof') throw new Error('Missing author proof'); return reply.value;
  }
  async dispose(): Promise<void> { this.closed = true; this.scope.dispose();this.streamReject?.(new Error('Headless worker disposed')); this.pending?.reject(new Error('Headless worker disposed')); this.pending = undefined; await this.worker.terminate(); }
  private finished = false;
}
