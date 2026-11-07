import type { AnimalSim as Animal } from '../../../shared/engine/entities/AnimalSim';
import type { ThinkCtx } from '../../../shared/engine/entities/species/registry';
import { Hfsm } from '../../../shared/engine/ai/hfsm';
import { inspectBrain } from '../../../shared/engine/ai/inspect';

/** Authored creature goals share an inspectable HFSM; movement and strike clocks remain separate.
 * C accepts a trusted renderer-free context; existing subclasses keep ThinkCtx by default.
 */
export abstract class CreatureBrain<S extends string, A extends Animal = Animal, C = ThinkCtx> {
  private readonly machine: Hfsm<S>;
  protected readonly actor: A;
  constructor(actor: A, states: readonly S[]) {
    const first = states[0];
    if (first === undefined) throw new Error('A creature brain requires at least one state');
    const definitions = Object.fromEntries(states.map((state) => [state, {}])) as Record<S, object>;
    this.actor = actor; this.machine = new Hfsm(definitions, first, undefined);
    inspectBrain(actor, () => ({ state: this.machine.path.join('/'), picks: [], brainHz: 20, pinned: false }));
  }
  get state(): S { return this.machine.state; }
  protected transition(state: S): void { this.machine.transition(state); }
  abstract think(ctx: C): void;
  abstract act(ctx: C): void;
}
