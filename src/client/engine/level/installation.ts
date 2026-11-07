import { Group, type Object3D } from 'three';
import type { App } from '../app/app';
import type { Scope } from '../../../shared/engine/app/scope';
import { ownedFacade, withOwner } from '../../../shared/engine/app/ownership';
import { ownSceneResource, sceneResources } from '../app/sceneOwnership';
import type { StepProgress } from '../boot/plan';
import type { ContentRowMap, LevelAdapters, LevelContext } from '../../../server/engine/level/context';

/** One scoped context and its registration window, shared by staged loading and resident level activation. */
export interface LevelInstallation {
  readonly context: LevelContext;
  openKit: () => void;
  closeKit: () => void;
}
/** Construct the ordinary level verbs bound to a supplied scope, without changing the running level or boot loop. */
export function createLevelInstallation(app: App, scope: Scope, adapters: LevelAdapters, progress: () => StepProgress): LevelInstallation {
  let kitOpen = false;
    const live = (): void => { if (scope.disposed) throw new Error('Level was unloaded during load'); };
    const register = <K extends keyof ContentRowMap>(kind: K, values: ContentRowMap[K] | readonly ContentRowMap[K][]): void => {
      live();
      if (!kitOpen) throw new Error(`${kind} rows may only register during level.kit`);
      app.levelRegistrations.add(kind, values, scope);
      if (kind === 'encounter') {
        const rows: readonly ContentRowMap[K][] = Array.isArray(values) ? values : [values as ContentRowMap[K]];
        for (const row of rows) app.encounters.register(row, scope);
      }
    };
    const own = (dispose: () => void): void => { scope.onDispose(dispose); };
    const hud = (): NonNullable<LevelAdapters['hud']> => {
      live();
      if (adapters.hud === undefined) throw new Error('HUD service is not installed');
      // SF57: a verb called after an await still builds under this scope (its buttons, nodes and listeners end with it)
      return ownedFacade(scope, adapters.hud);
    };
    const root = new Group();
    const freeTree = (tree: Object3D): void => {
      for (const resource of sceneResources(tree)) ownSceneResource(resource, scope, app.assets);
      tree.removeFromParent();
    };
    scope.onDispose(() => { freeTree(root); });
    const ctx: LevelContext = {
      app, scope, root, get progress() { return progress(); },
      system: (system) => { live(); app.addContentSystem(system, scope); },
      on: (name, fn, options) => { live(); app.events.on(name, fn, scope, options); },
      answer: (name, fn, options) => { live(); app.events.answer(name, fn, scope, options); },
      rows: {
        weapon: (values) => register('weapon', values), tool: (values) => register('tool', values),
        ammo: (values) => register('ammo', values),
        species: (values) => {
          register('species', values);
          const rows: readonly ContentRowMap['species'][] = Array.isArray(values) ? values : [values as ContentRowMap['species']];
          for (const row of rows) app.species.registerRow(row, scope);
        },
        speciesLook: (values) => {
          register('speciesLook', values);
          const rows: readonly ContentRowMap['speciesLook'][] = Array.isArray(values) ? values : [values as ContentRowMap['speciesLook']];
          for (const row of rows) app.species.registerLook(row, scope);
        },
        effect: (values) => register('effect', values),
        encounter: (values) => register('encounter', values),
        spawnTable: (values) => {
          register('spawnTable', values);
          const rows: readonly ContentRowMap['spawnTable'][] = Array.isArray(values) ? values : [values as ContentRowMap['spawnTable']];
          for (const row of rows) app.encounters.registerSpawn(row, scope);
        },
      },
      inputContext: (def, owner = scope) => {
        live(); const make = adapters.inputContext; if (make === undefined) throw new Error('Input context service is not installed');
        if (owner.disposed || !owner.belongsTo(scope)) throw new Error('Input context requires a live descendant owner');
        owner.onDispose(withOwner(owner, () => make(def)));
      },
      hud: {
        widget: (band, el, order) => own(hud().widget(band, el, order)),
        disc: (opts) => { const result = hud().disc(opts); own(result.dispose); return result.button; },
        relabel: (spot, label, icon, appearance) => {
          const dispose = hud().relabel(spot, label, icon, appearance);
          let active = true;
          let forget = (): void => { /* Assigned before this live scope can dispose. */ };
          const release = (): void => { if (!active) return; active = false; forget(); dispose(); };
          forget = scope.capture('disposers', release);
          return release;
        },
        verb: (slot, opts) => own(hud().verb(slot, opts)),
        pin: (at, el) => own(hud().pin(at, el)),
      },
      piece: (piece) => {
        live(); app.registry.add(piece);
        own(() => {
          const index = app.registry.pieces.indexOf(piece); if (index !== -1) app.registry.pieces.splice(index, 1);
          if (piece.object !== undefined) freeTree(piece.object);
        });
      },
      debugRow: (value) => {
        live(); const make = adapters.debugRow; if (make === undefined) throw new Error('Debug row service is not installed');
        own(withOwner(scope, () => make(value)));
      },
      playground: (value) => {
        live(); const make = adapters.playground; if (make === undefined) throw new Error('Playground service is not installed');
        own(withOwner(scope, () => make(value)));
      },
      strings: (table) => { live(); app.levelRegistrations.strings(table, scope); },
      tiers: { knobs: (schema) => { live(); app.levelRegistrations.knobs(schema, scope); } },
      debug: { expose: (name, value) => { live(); own(withOwner(scope, () => app.debug.scopedExpose(name, value))); } },
    };
  return { context: ctx, openKit: () => { kitOpen = true; app.levelRegistrations.openKit(scope); },
    closeKit: () => { kitOpen = false; app.levelRegistrations.closeKit(scope); } };
}
