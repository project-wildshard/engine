import type { Scope } from '../app/scope';
import type { Events } from '../events/events';

declare module '../../../client/engine/events/maps' {
  interface AskMap {
    'ai.claim': readonly [object, boolean];
    'ai.mayAttack': readonly [object, boolean];
  }
}

/** A fixed pool of attack tokens: at most `max` holders at once. No allocation after construction. */
export class AttackTokens<T> {
  private readonly held: (T | null)[];
  private n = 0;
  readonly max: number;

  constructor(max: number) {
    this.max = max;
    this.held = Array.from({ length: Math.max(0, max) }, (): T | null => null);
  }

  /** how many tokens are out */
  get count(): number { return this.n; }

  /** `who` holds a token */
  holds(who: T): boolean {
    for (const h of this.held) if (h === who) return true;
    return false;
  }

  /** `who` may attack now: it holds a token, or one is free */
  free(who: T): boolean { return this.n < this.max || this.holds(who); }

  /** take a token for `who` (true if it holds one afterwards; a holder asking again keeps its own) */
  take(who: T): boolean {
    if (this.holds(who)) return true;
    for (let i = 0; i < this.held.length; i++) {
      if (this.held[i] !== null) continue;
      this.held[i] = who; this.n++;
      return true;
    }
    return false;
  }

  /** give `who`'s token back (a no-op if it holds none) */
  release(who: T): void {
    for (let i = 0; i < this.held.length; i++) if (this.held[i] === who) { this.held[i] = null; this.n--; }
  }

  /** take back every token whose holder is no longer attacking (`still(holder)` false) */
  sweep(still: (who: T) => boolean): void {
    for (let i = 0; i < this.held.length; i++) {
      const h = this.held[i];
      if (h === null || h === undefined || still(h)) continue;
      this.held[i] = null; this.n--;
    }
  }

  clear(): void { this.held.fill(null); this.n = 0; }
}

/** Omitted caps are unlimited and allocate no token slots. */
export class AggressionDirector<T> {
  readonly max: number;
  private readonly tokens: AttackTokens<T> | null;
  constructor(max: typeof Infinity = Infinity) {
    if (Number.isFinite(max) && (!Number.isInteger(max) || max < 0)) throw new Error('Attack cap must be a nonnegative integer');
    if (!Number.isFinite(max) && max !== Infinity) throw new Error('Invalid attack cap');
    this.max = max; this.tokens = Number.isFinite(max) ? new AttackTokens<T>(max) : null;
  }
  get enabled(): boolean { return this.tokens !== null; }
  get count(): number { return this.tokens?.count ?? 0; }
  holds(actor: T): boolean { return this.tokens?.holds(actor) ?? true; }
  free(actor: T): boolean { return this.tokens?.free(actor) ?? true; }
  take(actor: T): boolean { return this.tokens?.take(actor) ?? true; }
  release(actor: T): void { this.tokens?.release(actor); }
  sweep(still: (actor: T) => boolean): void { this.tokens?.sweep(still); }
  clear(): void { this.tokens?.clear(); }
}

interface AttackPolicy { claim: () => boolean; mayAttack: () => boolean }
/** One engine answerer per request; resident levels register policies rather than competing answerers. */
export class AggressionService {
  private readonly policies = new WeakMap<object, AttackPolicy>();
  constructor(events: Events, scope: Scope) {
    events.answer('ai.claim', (actor) => this.policies.get(actor)?.claim() ?? true, scope);
    events.answer('ai.mayAttack', (actor) => this.policies.get(actor)?.mayAttack() ?? true, scope);
  }
  register<T extends object>(actor: T, director: AggressionDirector<T>, scope?: Scope): void {
    const policy = { claim: () => director.take(actor), mayAttack: () => director.free(actor) };
    this.policies.set(actor, policy);
    scope?.onDispose(() => { this.policies.delete(actor); director.release(actor); });
  }
}
