import { isJsonData } from '@wildshard/format/json';
import type { InputContextDef } from '@wildshard/engine/level/context';
import { inputWhenMatches, inputExtraRules, type InputObservation } from '@wildshard/format/inputDeclarations';
import * as v from 'valibot';
import { ItemRuntime, type ItemPorts, type ItemSpec } from '@wildshard/engine/combat/items';
import type { ItemFamily } from '@wildshard/engine/combat/itemFamilies';
import type { EquipmentIcon, EquipmentRow, WeaponId } from '@wildshard/engine/combat/Equipment';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import type { Weapon } from '@wildshard/engine/combat/Weapon';
import type { Tool } from '@wildshard/engine/combat/Tool';
import type { InputService } from '@wildshard/engine/input/InputService';
import type { AimCommand } from '@wildshard/engine/input/commands';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ScriptEntity } from '@wildshard/engine/script/effects';

import { ItemContextSchema, ItemFamilyNameSchema as name, parseItems, type ShardItems } from '@wildshard/format/items';

/** Extend an admitted weapon context with bounded author rows. Observations come from the session owner. */
export function declaredItemContext(row: ShardItems['contexts'][number], observation?: InputObservation): InputContextDef {
  if (!isJsonData(row)) throw new Error('Item input requires plain rows');
  v.assert(ItemContextSchema, row);
  if (inputExtraRules(row.extra, row.actions, row.id.split('.')[0] ?? row.id).length > 0) throw new Error('Invalid item input references');
  const extra = row.extra;
  if (extra?.hiddenWhen !== undefined && observation === undefined) throw new Error('Conditional item input requires host observations');
  const show = (): boolean => extra?.hiddenWhen === undefined || observation !== undefined && !inputWhenMatches(extra.hiddenWhen, observation);
  return { id: row.id, actions: [...row.actions, ...(extra?.actions ?? []).map(action => action.id)], keysFrom: row.keysFrom,
    ...(extra?.actions === undefined ? {} : { keys: Object.fromEntries(extra.actions.filter(action => action.keys !== undefined).map(action => [action.id, action.keys])) }),
    ...(extra?.blocks === undefined ? {} : { blocks: extra.blocks }),
    touch: { mode: row.touch, lockable: row.lockable, relabel: extra?.relabel ?? {},
      ...(extra?.verbs === undefined ? {} : { verbs: Object.fromEntries(Object.entries(extra.verbs).map(([slot, verb]) => [slot, { ...verb, show }])) }) } };
}

/** Build trusted item-handle aliases for the one script lane; actor identity comes from the host session. */
export function declaredItemScriptEntities(input: unknown, actorId: string): { entities: readonly ScriptEntity[]; actors: ReadonlyMap<number, string> } {
  if (actorId.length === 0) throw new Error('Item owner required');
  const items = parseItems(input), entities: ScriptEntity[] = [];
  const actors = new Map<number, string>();
  for (const row of items.rows) if (row.hook !== null) {
    entities.push({ id: row.hook.entity, name: row.id, position: [0, 0, 0], fields: {}, frozen: false, interactive: true });
    actors.set(row.hook.entity, actorId);
  }
  return { entities, actors };
}
/** Trusted loader dependencies; factories and icons are resolved below the game layer. */
export interface DeclaredItemPorts {
  scope: Scope; actorId: string; input: Pick<InputService, 'bind' | 'held' | 'register' | 'has'>; aim: () => AimCommand;
  /** Resolve charged static models before creating any equipment. */
  models?: ReadonlyMap<string, unknown>;
  families: ReadonlyMap<string, ItemFamily>; icon: (name: string) => EquipmentIcon;
  runtime: (row: ShardItems['rows'][number]) => ItemPorts;
  /** A trusted shard's own families (M3): each named `<slug>.<name>`, never shadowing a kit family; resolved like the kit's. */
  shardFamilies?: { readonly slug: string; readonly families: ReadonlyMap<string, ItemFamily> };
  /** `runtime`: a hybrid runtime registers the declared input contexts through its own entered-input path (hybridRows.ts). */
  contexts?: 'install' | 'runtime';
  observation?: InputObservation;
  bindings?: Pick<InputService['bindings'], 'describe'>;
}
/** Merge a trusted shard's own item families over the kit's, refusing a foreign or shadowing name. */
export function shardItemFamilies(kit: ReadonlyMap<string, ItemFamily>, shard: NonNullable<DeclaredItemPorts['shardFamilies']>): ReadonlyMap<string, ItemFamily> {
  if (!/^[a-z][a-z0-9-]*$/u.test(shard.slug)) throw new Error('Shard item families need a shard slug');
  const merged = new Map(kit);
  for (const [id, family] of shard.families) {
    if (!id.startsWith(`${shard.slug}.`) || id.length <= shard.slug.length + 1 || !v.is(name, id)) throw new Error(`Shard item family ${id} must be named ${shard.slug}.<name>`);
    if (merged.has(id)) throw new Error(`Shard item family ${id} shadows a registered family`);
    merged.set(id, family);
  }
  return merged;
}
/** Normal equipment factory result plus authoritative fixed-step runtimes, scoped to the one session. */
export interface DeclaredItems {
  primary: Weapon | null; secondary: Weapon | null; extras: readonly Weapon[]; tools: readonly Tool[]; order: readonly WeaponId[];
  runtimes: ReadonlyMap<string, ItemRuntime>; install: (equipment: EquipmentService) => void; step: (tick: number, dt: number) => void;
}
/** Runtime-owned tools keep their native input controller; declared toggle tools retain the numeric action path. */
function bindToolAction(spec: Extract<ItemSpec, { kind: 'tool' }>, ports: DeclaredItemPorts, runtime: ItemRuntime, scope: Scope, instance: Tool): void {
  if (spec.action !== null) ports.input.bind(spec.action, () => { runtime.queue(3); }, scope, () => instance.enabled);
}
/** A native controller is admitted only through a runtime-owned items installation. */
function nativeTool(spec: ItemSpec): boolean { return spec.kind === 'tool' && spec.action === null; }
/** Resolve every family before construction, register baseline contexts, and expose the normal buildEquipment handoff. */
export function installDeclaredItems(input: unknown, ports: DeclaredItemPorts): DeclaredItems {
  const data = parseItems(input);
  if (data.rows.some(nativeTool) && ports.contexts !== 'runtime') throw new Error('Native tools require runtime-owned items');
  const runtimeContexts = data.runtimeContexts ?? [];
  if (ports.contexts !== 'runtime') {
    for (const row of data.contexts) {
      declaredItemContext(row, ports.observation);
      if ((row.extra?.describe?.length ?? 0) > 0 && ports.bindings === undefined) throw new Error('Item binding descriptions require the session binding owner');
    }
  }
  if (runtimeContexts.length > 0 && ports.contexts !== 'runtime') throw new Error('Existing runtime input contexts require a runtime-owned items installer');
  for (const id of runtimeContexts) if (!ports.input.has(id)) throw new Error(`Unresolved runtime input context ${id}`);
  const resolved = ports.shardFamilies === undefined ? ports.families : shardItemFamilies(ports.families, ports.shardFamilies);
  const families = data.rows.map((row) => {
    const family = resolved.get(row.family);
    if (family?.kind !== row.kind) throw new Error(`Unresolved item family ${row.family}`);
    if (row.kind === 'weapon' && row.profile !== undefined && !family.profiles?.includes(row.profile.family)) throw new Error(`Unhosted weapon profile ${row.profile.family}`);
    return family;
  });
  const models = data.rows.map(row => {
    if (row.view.asset === undefined) return undefined;
    const model = ports.models?.get(row.view.asset);
    if (model === undefined) throw new Error(`Unresolved item model ${row.view.asset}`);
    return model;
  });
  const icons = data.rows.map((row) => ports.icon(row.ui.icon));
  const runtimePorts = data.rows.map((row) => {
    const deps = ports.runtime(row);
    if (deps.actor.id !== ports.actorId) throw new Error('Item actor must be host-bound');
    if (row.hook !== null && deps.hook === null) throw new Error('Missing admitted item hook');
    return deps;
  });
  const scope = ports.scope.child('declared-items');
  const weapons = new Map<string, Weapon>(), tools = new Map<string, Tool>(), runtimes = new Map<string, ItemRuntime>();
  try {
    if (ports.contexts !== 'runtime') for (const ctx of data.contexts) {
      ports.input.register(declaredItemContext(ctx, ports.observation), scope);
      if (ctx.extra?.describe !== undefined) ports.bindings?.describe({ rows: ctx.extra.describe }, scope);
    }
    for (const [index, declaration] of data.rows.entries()) {
      const family = families[index], icon = icons[index]; if (family === undefined || icon === undefined) throw new Error('Missing resolved item');
      const deps = runtimePorts[index]; if (deps === undefined) throw new Error('Missing resolved runtime');
      const itemScope = scope.child(declaration.id);
      const runtime = new ItemRuntime(declaration, { ...deps, active: () => !itemScope.disposed && (deps.active?.() ?? true) }); runtimes.set(declaration.id, runtime);
      const { ui: presentationUi, ...presentation } = family.presentation ?? {};
      const row: EquipmentRow = { ...presentation, id: declaration.id, ui: { touch: 'melee', lockOn: declaration.kind === 'weapon', melee: declaration.kind === 'weapon', tracers: false,
        ...presentationUi, name: declaration.ui.name, icon, swapIcon: declaration.ui.swapIcon,
        ...(declaration.kind === 'weapon' ? { inputContext: declaration.context } : {}) }, meta: { name: declaration.ui.name, icon, blurb: declaration.ui.blurb, category: declaration.kind },
        ...(declaration.kind === 'weapon' ? { legacySlot: declaration.slot } : {}) };
      const args = { scope: itemScope, runtime, input: ports.input, aim: ports.aim, view: declaration.view,
        ...(models[index] === undefined ? {} : { model: models[index] }),
        ...(deps.hook === null ? {} : { hook: deps.hook }),
        ...(declaration.kind === 'weapon' && declaration.contacts !== undefined ? { contacts: declaration.contacts } : {}),
        ...(declaration.kind === 'weapon' && declaration.secondary !== undefined ? { secondary: declaration.secondary } : {}),
        ...(declaration.kind === 'weapon' && declaration.profile !== undefined ? { profile: declaration.profile } : {}) };
      if (declaration.kind === 'weapon' && family.kind === 'weapon') weapons.set(declaration.id, family.create(row, declaration, args));
      else if (declaration.kind === 'tool' && family.kind === 'tool') {
        const instance = family.create(row, declaration, args); tools.set(declaration.id, instance);
        bindToolAction(declaration, ports, runtime, itemScope, instance);
      }
    }
    const primary = data.loadout.primary === null ? null : weapons.get(data.loadout.primary) ?? null;
    const secondary = data.loadout.secondary === null ? null : weapons.get(data.loadout.secondary) ?? null;
    return { primary, secondary, extras: [...weapons.values()].filter((w) => w !== primary && w !== secondary), tools: [...tools.values()], order: [...weapons.values()].map((w) => w.id), runtimes,
      install: (equipment) => { for (const w of weapons.values()) equipment.unlock(w.id); for (const id of data.loadout.tools) { const t = tools.get(id); if (t !== undefined) equipment.add(t, { locked: false }); } },
      step: (tick, dt) => { if (!scope.disposed) for (const runtime of runtimes.values()) runtime.step(tick, dt); } };
  } catch (error) { scope.dispose(); throw error; }
}
