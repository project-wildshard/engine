export interface StateDef<S extends string, C> {
  parent?: S;
  enter?: (ctx: C) => void;
  exit?: (ctx: C) => void;
  tick?: (ctx: C, dt: number) => void;
}
export interface StateChange<S extends string> { previous: S; next: S; path: readonly S[] }

/** Explicit parent paths; transitions exit leaf-first and enter root-first. */
export class Hfsm<S extends string, C = undefined> {
  private current: S;
  private readonly definitions: Readonly<Record<S, StateDef<S, C>>>;
  private readonly context: C;
  private readonly changed: ((change: StateChange<S>) => void) | undefined;
  constructor(definitions: Readonly<Record<S, StateDef<S, C>>>, initial: S, context: C,
    changed?: (change: StateChange<S>) => void) {
    this.definitions = definitions; this.current = initial; this.context = context; this.changed = changed;
    for (const name of this.ancestry(initial)) definitions[name].enter?.(context);
  }
  get state(): S { return this.current; }
  get path(): readonly S[] { return this.ancestry(this.current); }
  in(state: S): boolean { return this.path.includes(state); }
  transition(next: S, restart = false): void {
    if (next === this.current && !restart) return;
    const previous = this.current, before = this.ancestry(previous), after = this.ancestry(next);
    let common = 0;
    while (common < before.length && common < after.length && before[common] === after[common]) common++;
    if (restart && next === previous) common = Math.max(0, common - 1);
    for (let i = before.length - 1; i >= common; i--) {
      const name = before[i]; if (name !== undefined) this.definitions[name].exit?.(this.context);
    }
    this.current = next;
    for (const name of after.slice(common)) this.definitions[name].enter?.(this.context);
    this.changed?.({ previous, next, path: after });
  }
  tick(dt: number): void {
    for (const name of this.path) {
      const current = this.current; this.definitions[name].tick?.(this.context, dt);
      if (this.current !== current) break;
    }
  }
  private ancestry(state: S): S[] {
    const names: S[] = []; let next: S | undefined = state;
    while (next !== undefined) {
      if (names.includes(next)) throw new Error(`HFSM parent cycle at ${next}`);
      if (!Object.hasOwn(this.definitions, next)) throw new Error(`HFSM state missing: ${next}`);
      names.unshift(next); next = this.definitions[next].parent;
    }
    return names;
  }
}
