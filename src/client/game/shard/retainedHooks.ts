import type { Scope } from '@wildshard/engine/app/scope';
import { currentOwner, withOwner } from '@wildshard/engine/app/ownership';
import type { ShardContext } from "../plugin/context";
import { bindPlayerEffects } from '@wildshard/engine/combat/effects/EffectService';
import { enteredServices, installEnteredService } from '../../../shared/game/shard/enteredServices';
import type { Vector3 } from 'three';

const ownerBelongsTo = (owner: Scope | null, entered: Scope): boolean => owner?.belongsTo(entered) === true;
type InputDefinition = Parameters<ShardContext['inputContext']>[0];
const residentInputs = new WeakMap<ShardContext, (definition: InputDefinition) => void>();
const playerBindings = new WeakSet<ShardContext>();

/** Whether this trusted context retains its home resources while entered services are independently scoped. */
export function retainsRuntimeServices(context: ShardContext): boolean { return enteredServices.has(context); }

/** Keep status movement and damage attached to a retained home's player while shard callbacks come and go. */
export function installRetainedPlayerEffects(context: ShardContext, player: {
  movement: { effectMoveLocked: boolean; effectMoveScale: number }; position: () => Vector3;
}): void {
  if (!retainsRuntimeServices(context)) throw new Error('Player lifetime binding needs a retained context');
  if (playerBindings.has(context)) throw new Error('Player effects already bound');
  const target = context.app.player, effects = context.app.effects;
  if (target === null || effects === null) throw new Error('Player lifetime binding needs health and effects');
  bindPlayerEffects({ effects, target, movement: player.movement, combat: context.app.combat, position: player.position, scope: context.scope });
  context.app.events.on('player.died', ({ actor }) => {
    if (actor !== target) return;
    for (const effect of effects.active(target)) if (effect.def.tags.some((tag) => tag.startsWith('status.'))) effects.remove(target, effect.def.id);
  }, context.scope);
  playerBindings.add(context);
  context.scope.onDispose(() => { playerBindings.delete(context); });
}

/** Install a transient service for each home entry; ordinary staged contexts keep their original level scope. */
export function installEnteredRuntimeService(context: ShardContext, install: (scope: Scope) => void): void { installEnteredService(context, install); }
/** The same for a level-facing host that holds the trusted context as its LevelContext (riding, page owners). */
export function installEnteredLevelService(context: { readonly scope: Scope }, install: (scope: Scope) => void): void { installEnteredService(context, install); }

/** Resolve a retained kit's input definition during construction; enable actions and binding labels only on entry. */
export function installEnteredRuntimeInput(context: ShardContext, definition: Parameters<ShardContext['inputContext']>[0],
  description: Parameters<ShardContext['app']['input']['bindings']['describe']>[0]): void {
  if (!retainsRuntimeServices(context)) throw new Error('Entered input needs a retained context');
  const define = residentInputs.get(context);
  if (define === undefined) throw new Error('Entered input needs a retained input owner');
  define(definition);
  installEnteredRuntimeService(context, scope => {
    context.app.input.bindings.describe(description, scope);
  });
}

/** Register entered-only updates on a clock that does not advance while the resident is parked. */
export function installEnteredRuntimeUpdate(context: ShardContext, spec: Parameters<ShardContext['system']>[0]): void {
  if (!retainsRuntimeServices(context)) throw new Error('Entered clock needs a retained context');
  let time = context.app.clock.now;
  context.system({ ...spec, run: (dt) => { time += dt; spec.run(dt, time); } });
}

/** Keep a resident HUD root's exact slot while detaching it outside the entered home. */
export function installEnteredRuntimeAttachment(context: ShardContext, root: HTMLElement): void {
  if (!retainsRuntimeServices(context)) throw new Error('Entered attachment needs a retained context');
  const parent = root.parentNode;
  if (parent === null) throw new Error('Entered attachment needs a mounted root');
  const anchor = root.ownerDocument.createComment('runtime.entered');
  root.before(anchor);
  root.remove();
  context.scope.onDispose(() => { root.remove(); anchor.remove(); });
  installEnteredRuntimeService(context, (scope) => {
    if (anchor.parentNode !== parent) throw new Error('Entered attachment lost its resident slot');
    anchor.after(root);
    scope.onDispose(() => { root.remove(); });
  });
}

/** Publish a trusted browser debug observer only during its cell entry, restoring the exact borrowed descriptor. */
export function installEnteredRuntimeObserver(context: ShardContext, name: string, observer: object): void {
  installEnteredRuntimeService(context, (scope) => {
    if (typeof window === 'undefined') throw new Error('Browser debug observer needs a window');
    scope.expose(window, name, observer);
  });
}

/** Reinstall entered callbacks while a borrowed home's models and authored state remain resident. */
export class RetainedRuntimeHooks {
  readonly context: ShardContext;
  private readonly resident: Scope;
  private readonly installers: ((scope: Scope) => void)[] = [];
  private entered: Scope | undefined;
  private generation = 0;
  private preparing: boolean;
  private installing = 0;
  private readonly ownedInputs = new Set<string>();
  private readonly pushes = new Map<string, Scope>();
  private readonly inputService: ShardContext['app']['input'];

  /** Defer entered services while a budget-admitted resident constructs its world on the road.
   * Construction may queue registrations until activation or cancellation; it never runs those installers. */
  constructor(base: ShardContext, preparation: { deferActivation?: boolean } = {}) {
    this.resident = base.scope; this.inputService = base.app.input;
    this.preparing = preparation.deferActivation === true;
    const generation = this.generation;
    const register = (install: (scope: Scope) => void): void => {
      const entered = this.entered;
      if (this.preparing && generation === this.generation && !base.scope.disposed) {
        this.installers.push(install); return;
      }
      // Existing callbacks re-enter their new owner. A yielded old hook has no such owner and cannot publish here. The owner
      // is read only for that check (SF57: a read on every registration counted as a stray read during owned builds).
      if (base.scope.disposed || entered === undefined || (generation !== this.generation
        && !ownerBelongsTo(currentOwner(), entered))) throw new Error('Trusted callback registration left its cell');
      const nested = this.installing > 0;
      this.install(install, entered);
      // A replayed service owns its nested registrations; replaying them separately would duplicate callbacks.
      if (!nested) this.installers.push(install);
    };
    // G580 T1: an input context id is page-global, and two live copies of one product share every id, so a retained
    // definition exists only in the entered scope (one runtime is entered at a time). A push of one of its ids made while
    // parked (native construction pushes at once) waits for entry, and every push it remembers is replayed on each entry
    // while its owner lives; a pop forgets it.
    const input = (definition: InputDefinition, install: (definition: InputDefinition, scope: Scope) => void): void => {
      this.ownedInputs.add(definition.id);
      register(scope => { install({ ...definition, enabled: () => this.entered !== undefined && definition.enabled?.() !== false }, scope); });
    };
    const inputs = base.app.input;
    const push = (id: string, scope: Scope): void => {
      if (this.ownedInputs.has(id)) { this.pushes.delete(id); this.pushes.set(id, scope); if (this.entered === undefined) return; }
      inputs.push(id, scope);
    };
    const pop = (id: string): void => { this.pushes.delete(id); inputs.pop(id); };
    const through = <T extends object>(target: T, own: (key: PropertyKey) => unknown): T => new Proxy(target, {
      get: (object, key) => { const mine = own(key); if (mine !== undefined) return mine; const value: unknown = Reflect.get(object, key, object);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(object) : value; },
      set: (object, key, value: unknown) => Reflect.set(object, key, value, object),
    });
    const input$ = through(inputs, key => key === 'push' ? push : key === 'pop' ? pop : undefined);
    const app = through(base.app, key => key === 'input' ? input$ : undefined);
    // HUD elements are page-global: a retained runtime's widgets and discs stand in the HUD only while it is entered.
    // Parked, an element leaves a comment anchor in its slot; entered, it returns to that slot. One not yet mounted is left.
    const anchors = new WeakMap<Element, Comment>();
    const park = (el: HTMLElement): void => {
      const away = (): void => {
        if (el.parentNode === null || anchors.has(el)) return;
        const anchor = el.ownerDocument.createComment('runtime.parked'); el.before(anchor); el.remove(); anchors.set(el, anchor);
      };
      if (this.entered === undefined && this.installing === 0) away();
      register((scope) => {
        const anchor = anchors.get(el);
        if (anchor !== undefined) { if (anchor.parentNode !== null) anchor.replaceWith(el); anchors.delete(el); }
        scope.onDispose(away);
      });
      base.scope.onDispose(() => { anchors.get(el)?.remove(); anchors.delete(el); });
    };
    this.context = { ...base, app, get progress() { return base.progress; },
      hud: {
        relabel: (spot, label, icon, appearance) => base.hud.relabel(spot, label, icon, appearance), verb: (slot, opts) => { base.hud.verb(slot, opts); },
        widget: (band, el, order) => { base.hud.widget(band, el, order); park(el); },
        disc: (opts) => { const button = base.hud.disc(opts); park(button); return button; },
        pin: (at, el) => { base.hud.pin(() => this.entered === undefined ? null : typeof at === 'function' ? at() : at, el); },
      },
      system: (spec) => { register((scope) => { base.app.addSystem(spec, scope); }); },
      on: (name, fn, options) => { register((scope) => { base.app.events.on(name, fn, scope, options); }); },
      answer: (name, fn, options) => { register((scope) => { base.app.events.answer(name, fn, scope, options); }); },
      inputContext: definition => { input(definition, (def, scope) => { base.inputContext(def, scope); }); },
      debug: { expose: (name, value) => { register((scope) => { scope.onDispose(base.app.debug.scopedExpose(name, value)); }); } },
      // the page's Bag is one per page: a retained runtime's tabs and fragments show only while it is entered
      bag: { tab: (spec) => { register((scope) => { scope.onDispose(base.game.bag.tab(spec)); }); },
        fragment: (tab, fragment) => { register((scope) => { scope.onDispose(base.game.bag.fragment(tab, fragment)); }); } },
    };
    enteredServices.set(this.context, register);
    // The entered-input helper historically owns its InputService registration directly, without a level adapter.
    residentInputs.set(this.context, definition => { input(definition, (def, scope) => {
      base.app.input.register(def, scope.child(`input.${def.id}`));
    }); });
    if (!this.preparing) this.activate();
    base.scope.onDispose(() => { enteredServices.delete(this.context); residentInputs.delete(this.context); this.deactivate(); this.installers.length = 0; });
  }
  private install(install: (scope: Scope) => void, scope: Scope): void {
    this.installing++;
    try { withOwner(scope, () => install(scope)); } finally { this.installing--; }
  }
  /** Publish each recorded callback in a fresh entered scope, once; failure rolls back every partial registration. */
  activate(): void {
    if (this.resident.disposed) throw new Error('Retained home is disposed');
    if (this.entered !== undefined) return;
    this.preparing = false;
    const scope = this.resident.child('runtime.entered');
    this.entered = scope;
    try {
      for (const install of this.installers) this.install(install, scope);
      // the pushes its runtime made while parked or on an earlier entry, onto the definitions this entry made
      for (const [id, owner] of this.pushes) { if (owner.disposed) this.pushes.delete(id); else this.inputService.push(id, owner); }
      this.context.app.input.refresh(false); this.context.app.input.repaint();
    } catch (error) {
      this.entered = undefined; scope.dispose();
      this.context.app.input.refresh(false); this.context.app.input.repaint();
      throw error;
    }
  }
  /** Remove every system/listener/answerer before another cell becomes active; resident geometry is untouched. */
  deactivate(): void {
    if (this.preparing) { this.preparing = false; this.generation++; this.installers.length = 0; }
    const scope = this.entered; if (scope === undefined) return;
    this.entered = undefined; this.generation++; scope.dispose();
    this.context.app.input.refresh(false); this.context.app.input.repaint();
  }
}
