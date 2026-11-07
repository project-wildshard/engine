import * as v from 'valibot';
import { isJsonData } from '@wildshard/format/json';
import { HandleIdSchema } from '@wildshard/format/sceneRefs';
import type { SimHost } from '../sim';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { PackBrain } from './pack';
import type { StalkerBrain } from '../../../shared/engine/ai/stalker';
import { NativeEliteKernels, type NativeEliteKernelState, type NativeEliteKernelLoans } from './eliteKernels';

const finite = v.pipe(v.number(), v.finite());
const rowsSchema = v.pipe(v.array(v.object({
  def: v.object({ id: HandleIdSchema, lair: v.object({ x: finite, z: finite }) }),
  member: v.strictObject({ kind: HandleIdSchema, variant: HandleIdSchema, source: v.picklist(['boot', 'spawn']), yaw: finite,
    memory: v.exactOptional(v.record(HandleIdSchema, finite)) }),
  pack: v.exactOptional(v.object({ offset: v.tuple([finite, finite]), variants: v.array(HandleIdSchema) })),
})), v.minLength(1), v.maxLength(64));
/** The existing population owns bodies, allocation records, groups and RNG.
 * Its concrete receiver is bound after population installation, before initialization. */
export interface NativeElitePopulation {
  readonly host: SimHost; readonly bodies: readonly AnimalSim[];
  readonly spawnElite: (kind: string, x: number, z: number, yaw: number, variant: string) => AnimalSim;
  readonly retireElite: (actor: AnimalSim) => void;
  readonly spawnElitePack: (x: number, z: number, variants: readonly string[]) => PackBrain<AnimalSim>;
  readonly retirePack: (pack: PackBrain<AnimalSim>) => void;
}
interface LifecycleScript<D> {
  readonly def: D; readonly animal: AnimalSim | null;
  readonly spawn: () => void; readonly despawn: () => void; readonly reset: () => void; readonly enterPhase2: () => void; readonly trophy: () => void;
  readonly tick: (dt: number, t: number, engaged: boolean, leashing: boolean) => void;
}
interface State extends NativeEliteKernelState { adopted: boolean }
interface Loans {
  readonly host: SimHost; readonly kernels: NativeEliteKernels;
  readonly bindings: { readonly pinned: Set<AnimalSim>; readonly brains: NativeEliteKernelLoans['brains'] };
}
function method<O extends object>(owner: O, key: keyof O): unknown { return owner[key]; }
function methods(population: NativeElitePopulation): readonly unknown[] {
  return [population.spawnElite, population.retireElite, population.spawnElitePack, population.retirePack];
}
/** Native lifecycle over the original member and kernel. This owner adds no
 * body step, save envelope, clock or random stream, and never owns herd policy. */
export class NativeEliteLifecycle {
  private readonly rows: v.InferOutput<typeof rowsSchema>; private readonly loans; private readonly host; private readonly scope; private readonly kernels; private readonly bindings;
  private readonly pinned; private readonly brains; private readonly bindingMethods; private readonly kernelMethods;
  private population: NativeElitePopulation | undefined;
  private bodies: readonly AnimalSim[] | undefined;
  private populationMethods: readonly unknown[] = [];
  private readonly created = new Set<string>();
  constructor(input: unknown, loans: Loans) {
    this.loans = loans;
    if (!isJsonData(input)) throw new Error('Elite lifecycle requires plain JSON rows');
    this.rows = v.parse(rowsSchema, input);
    this.host = loans.host; this.scope = loans.host.scope; this.kernels = loans.kernels; this.bindings = loans.bindings;
    this.pinned = loans.bindings.pinned; this.brains = loans.bindings.brains;
    this.bindingMethods = [method(this.pinned, 'add'), method(this.pinned, 'delete'), method(this.brains, 'delete')];
    this.kernelMethods = [method(this.kernels, 'create'), method(this.kernels, 'bind'), method(this.kernels, 'enterPhase2'), method(this.kernels, 'validateController')];
    if (!(this.kernels instanceof NativeEliteKernels) || !(this.pinned instanceof Set) || !(this.brains instanceof Map)
      || new Set(this.rows.map(row => row.def.id)).size !== this.rows.length
      || this.rows.length !== this.kernels.declaredRows.length || this.rows.some(row => !this.kernels.declaredRows.some(kernel => kernel.id === row.def.id && kernel.lair.x === row.def.lair.x && kernel.lair.z === row.def.lair.z)
        || (row.pack !== undefined && (!Number.isFinite(row.def.lair.x + row.pack.offset[0]) || !Number.isFinite(row.def.lair.z + row.pack.offset[1]))))
      || [...this.bindingMethods, ...this.kernelMethods].some(callable => typeof callable !== 'function')) throw new Error('Invalid elite lifecycle rows or owners');
    this.validate();
  }
  /** Pin the same late-installed native population on both fresh and restored boots. */
  bindPopulation(population: NativeElitePopulation): void {
    this.validate();
    if (this.population !== undefined || population.host !== this.host || !Array.isArray(population.bodies) || methods(population).some(callable => typeof callable !== 'function')) throw new Error('Foreign or duplicate elite population');
    this.population = population; this.bodies = population.bodies; this.populationMethods = methods(population);
  }
  /** Lifetime checks also run around continuation preparation and commit. */
  validate(): void {
    this.kernels.validate();
    if (this.scope.disposed || this.scope.disposing || this.host.scope !== this.scope || this.loans.host !== this.host || this.loans.kernels !== this.kernels
      || this.loans.bindings !== this.bindings || this.bindings.pinned !== this.pinned || this.bindings.brains !== this.brains
      || [method(this.pinned, 'add'), method(this.pinned, 'delete'), method(this.brains, 'delete')].some((callable, i) => callable !== this.bindingMethods[i])
      || [method(this.kernels, 'create'), method(this.kernels, 'bind'), method(this.kernels, 'enterPhase2'), method(this.kernels, 'validateController')].some((callable, i) => callable !== this.kernelMethods[i])
      || (this.population !== undefined && (this.population.host !== this.host || this.population.bodies !== this.bodies || methods(this.population).some((callable, i) => callable !== this.populationMethods[i])))) throw new Error('Retired or replaced elite lifecycle owner');
  }
  create<D extends { readonly id: string; readonly lair: { readonly x: number; readonly z: number } }>(def: D, state: State): { readonly controller: StalkerBrain<AnimalSim>; readonly script: LifecycleScript<D> } {
    this.validate();
    if (!isJsonData(def)) throw new Error('Elite lifecycle definition requires plain JSON');
    const row = this.rows.find(candidate => candidate.def.id === def.id);
    if (row === undefined || this.created.has(def.id) || row.def.lair.x !== def.lair.x || row.def.lair.z !== def.lair.z) throw new Error('Foreign or duplicate elite lifecycle member');
    const controller = this.kernels.create(def.id, state), lair = def.lair;
    this.created.add(def.id);
    const controllerMethods = [method(controller, 'spawned'), method(controller, 'disposeTell'), method(controller, 'reset'), method(controller, 'advance')];
    const check = (): void => {
      this.validate(); this.kernels.validateController(row.def.id, controller, state);
      if (def.id !== row.def.id || def.lair !== lair || lair.x !== row.def.lair.x || lair.z !== row.def.lair.z
        || [method(controller, 'spawned'), method(controller, 'disposeTell'), method(controller, 'reset'), method(controller, 'advance')].some((callable, i) => callable !== controllerMethods[i])) throw new Error('Replaced elite lifecycle member');
    };
    const population = (): NativeElitePopulation => { check(); if (this.population === undefined) throw new Error('Unbound elite population'); return this.population; };
    const script = {
      def, get animal() { return state.animal; },
      spawn: (): void => {
        const owner = population();
        const boot = row.member.source === 'boot' && !state.adopted ? owner.bodies.find(actor => actor.kind === row.member.kind && actor.variant === row.member.variant) : undefined;
        state.adopted = true;
        const actor = boot ?? owner.spawnElite(row.member.kind, lair.x, lair.z, row.member.yaw, row.member.variant);
        check(); if (this.host.entities.get(actor.entityId) !== actor || actor.kind !== row.member.kind || actor.variant !== row.member.variant) throw new Error('Foreign elite lifecycle body');
        state.animal = actor; actor.herd = -1;
        for (const [key, value] of Object.entries(row.member.memory ?? {})) actor.mem[key] = value;
        controller.spawned(actor); check(); this.kernels.bind(row.def.id, controller, state, actor);
        if (row.pack !== undefined) {
          state.pack = owner.spawnElitePack(lair.x + row.pack.offset[0], lair.z + row.pack.offset[1], row.pack.variants);
          check(); state.pack.homeX = lair.x; state.pack.homeZ = lair.z;
        }
      },
      despawn: (): void => {
        const owner = population(); controller.disposeTell(); check();
        if (state.pack !== null) owner.retirePack(state.pack); check(); state.pack = null;
        check(); const actor = state.animal; if (actor !== null) this.pinned.delete(actor);
        if (actor !== null) { this.brains.delete(actor); owner.retireElite(actor); check(); } state.animal = null;
      },
      reset: (): void => { check(); state.phase2 = false; controller.reset(state.animal); },
      enterPhase2: (): void => { check(); state.phase2 = true; this.kernels.enterPhase2(row.def.id, controller, state); },
      trophy: (): void => undefined,
      tick: (dt: number, t: number, engaged: boolean, leashing: boolean): void => {
        check(); const actor = state.animal;
        if (actor !== null) { if (engaged) this.pinned.add(actor); else this.pinned.delete(actor); }
        controller.advance(actor, dt, t, engaged, leashing);
      },
    };
    return { controller, script };
  }
}
