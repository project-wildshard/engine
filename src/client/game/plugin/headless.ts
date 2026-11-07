import { installPageItems, installPageItemContexts } from '../shardfile/pageItems';
import { macrotask, slicer } from '@wildshard/engine/boot/plan';
import { parseItems } from '@wildshard/format/items';
import { requireBound, sameRuntimeProfile } from '../../../shared/game/plugin/runtimeRows';
import type { EquipmentIcon } from '@wildshard/engine/combat/Equipment';
import type { ItemFamily, ItemFamilyPresentation } from '@wildshard/engine/combat/itemFamilies';
import type { ShardContext } from './context';
import type { DeclaredItems, DeclaredItemPorts } from "../../../shared/game/shardfile/items";
import type { Shardfile } from "@wildshard/format/shardSchema";


/**
 * The runtime-owner binding (SHARD-PLATFORM M3, E435). A hybrid shard's trusted runtime owns its world and its play scope;
 * the behaviour sections it names in `runtime.binds` stay declared data, and these installers put them into that scope
 * (the entered `runtime:<instance>` scope in a grid cell, the level scope standalone) through the template's own
 * installers: the platform `Ledger`, engine `QuestState`, `installDeclaredItems`, the platform `Purse`, and the home keeper
 * for its declared creatures (`runtime.spawns`). The runtime binds to the result; it never
 * rebuilds the rows. The data client installs none of a bound section (`withoutRuntimeRows`).
 */

/** What a runtime lends its declared items: its own families (`<slug>.<name>`) and the icon resolver. */
export interface RuntimeItemPorts {
  readonly families: ReadonlyMap<string, ItemFamily>;
  readonly icon: (name: string) => EquipmentIcon;
  /** The platform kit's families, when the shard's rows also name `kit.*` ones. */
  readonly kit?: ReadonlyMap<string, ItemFamily>;
  /** Actor-owned hooks bound to the runtime's existing composed lane; every declared hook must resolve. */
  readonly hooks?: ReadonlyMap<string, ReturnType<DeclaredItemPorts['runtime']>['hook']>;
}

/**
 * Install declared items inside the runtime's equipment flow. Trusted families own contacts;
 * optional hooks come from the already admitted composed lane, so the item runtime sees no targets.
 */
export function bindRuntimeItems(ctx: Pick<ShardContext, 'app' | 'scope' | 'game'>, source: Shardfile, ports: RuntimeItemPorts): DeclaredItems {
  requireBound(source, 'items');
  return installPageItems(ctx, source, ports);
}

type RuntimeWeaponFamily = Extract<ItemFamily, { kind: 'weapon' }>;
/** One declared primary melee family, created or adopted inside the existing equipment flow. */
export interface RuntimeMeleePorts<W extends ReturnType<RuntimeWeaponFamily['create']>> {
  readonly create: (...args: Parameters<RuntimeWeaponFamily['create']>) => W;
  readonly icon: RuntimeItemPorts['icon']; readonly hooks?: RuntimeItemPorts['hooks'];
  readonly presentation?: RuntimeWeaponFamily['presentation'];
}

/**
 * Resolve declared item input definitions in the runtime's play stage. Retained homes keep definitions until disposal,
 * with actions enabled and binding descriptions installed only while entered; ordinary levels keep their level scope.
 */
export function bindRuntimeItemContexts(ctx: ShardContext, source: Shardfile): void {
  requireBound(source, 'items');
  installPageItemContexts(ctx, source);
}

type BuildEquipment = NonNullable<NonNullable<ShardContext['game']['runtime']>['buildEquipment']>;
/** Adopt already constructed ranged owners into admitted item rows, retaining
 * their original controllers, legacy slots, profiles and optional presentation.
 */
/** An existing native view/controller factory; item numbers come from the admitted row. */
export interface RuntimeEquipmentFactory {
  readonly prepare?: (due: () => Promise<void> | null) => Promise<void>;
  readonly create: (item: Extract<Shardfile['items']['rows'][number], { kind: 'weapon' }>, ...args: Parameters<BuildEquipment>) => Awaited<ReturnType<BuildEquipment>>['primary'];
}
interface RuntimeEquipmentOwner { readonly id: string; readonly weapon: Awaited<ReturnType<BuildEquipment>>['primary']; readonly profile: unknown; readonly presentation?: boolean }
/** Construct and admit native owners in DATA order, keeping native pickup rows when requested. */
export function bindRuntimeEquipment(ctx: Parameters<typeof bindRuntimeItems>[0], source: Shardfile,
  ports: { readonly factories: ReadonlyMap<string, RuntimeEquipmentFactory> }): BuildEquipment;
export function bindRuntimeEquipment(ctx: Parameters<typeof bindRuntimeItems>[0], source: Shardfile,
  owners: readonly RuntimeEquipmentOwner[]): DeclaredItems;
export function bindRuntimeEquipment(ctx: Parameters<typeof bindRuntimeItems>[0], source: Shardfile,
  input: readonly RuntimeEquipmentOwner[] | { readonly factories: ReadonlyMap<string, RuntimeEquipmentFactory> }): BuildEquipment | DeclaredItems {
  if ('factories' in input) {
    const policy = parseItems(source.items).loadout.runtime;
    if (policy === undefined) throw new Error('Missing runtime equipment factory policy');
    const steps = policy.owners.map(owner => {
      const item = source.items.rows.find(row => row.id === owner.item), factory = input.factories.get(owner.item);
      if (item?.kind !== 'weapon' || factory === undefined) throw new Error('Unresolved runtime equipment factory');
      return { owner, item, factory };
    });
    return async (...args) => {
      const due = policy.sliceMs === undefined ? () => null : slicer(policy.sliceMs).due;
      const owners: RuntimeEquipmentOwner[] = [];
      const kit: { primary: Awaited<ReturnType<BuildEquipment>>['primary'] | null; rifle: Awaited<ReturnType<BuildEquipment>>['rifle']; secondary: Awaited<ReturnType<BuildEquipment>>['secondary'] } = { primary: null, rifle: null, secondary: null };
      for (const [index, { owner, item, factory }] of steps.entries()) {
        if (factory.prepare !== undefined) { await factory.prepare(due); if (policy.pause) await macrotask(); }
        const weapon = factory.create(item, ...args);
        owners.push({ id: item.id, weapon, profile: item.profile, ...(owner.presentation === undefined ? {} : { presentation: owner.presentation }) });
        if (owner.slot !== 'extra') kit[owner.slot] = weapon;
        if (index + 1 < steps.length && policy.pause) await macrotask();
      }
      const bound = bindRuntimeEquipment(ctx, source, owners);
      if (kit.primary === null || bound.primary !== kit.primary) throw new Error('Runtime equipment requires its declared primary first');
      return { primary: kit.primary, rifle: kit.rifle, secondary: kit.secondary,
        extras: owners.filter(owner => owner.weapon !== kit.primary && owner.weapon !== kit.rifle && owner.weapon !== kit.secondary).map(owner => owner.weapon) };
    };
  }
  const owners = input;
  if (owners.length === 0 || owners.length > 16 || new Set(owners.map(owner => owner.id)).size !== owners.length) throw new Error('Invalid runtime item owners');
  const entries = owners.map(owner => {
    const declaration = source.items.rows.find(row => row.id === owner.id), native = owner.weapon.row;
    if (declaration?.kind !== 'weapon' || !sameRuntimeProfile(declaration.profile, owner.profile)) throw new Error('Runtime item profile differs from its constructed owner');
    const { name: _name, icon: _icon, inputContext: _context, swapIcon: _swap, ...ui } = native.ui;
    const presentation: ItemFamilyPresentation = { ui, ...(native.cues === undefined ? {} : { cues: native.cues }),
      ...(native.hitStop === undefined ? {} : { hitStop: native.hitStop }), ...(native.rangedFeel === undefined ? {} : { rangedFeel: native.rangedFeel }) };
    return { owner, declaration, native, presentation };
  });
  const families = new Map<string, ItemFamily>();
  for (const { declaration } of entries) families.set(declaration.family, { kind: 'weapon', profiles: entries.filter(entry => entry.declaration.family === declaration.family)
    .flatMap(entry => entry.declaration.profile === undefined ? [] : [entry.declaration.profile.family]), create: (row, _spec, ports) => {
      const entry = entries.find(value => value.owner.id === row.id);
      if (entry === undefined || !sameRuntimeProfile(ports.profile, entry.owner.profile)) throw new Error('Unbound runtime item profile');
      const { weapon } = entry.owner;
      if (source.items.loadout.runtime?.owners.find(owner => owner.item === entry.owner.id)?.row !== 'native') weapon.row = entry.owner.presentation === true ? { ...entry.presentation, ...row, ui: { ...row.ui, ...entry.presentation.ui }, legacySlot: weapon.id, meta: entry.native.meta }
        : { ...row, legacySlot: weapon.id, meta: entry.native.meta };
      return weapon;
    } });
  // A sole family can lend presentation before row construction (the bow path).
  for (const [name, family] of families) {
    const matches = entries.filter(entry => entry.declaration.family === name), first = matches[0];
    if (matches.length === 1 && first !== undefined) family.presentation = first.presentation;
  }
  return bindRuntimeItems(ctx, source, { families: new Map(), kit: families, icon: name => {
    const entry = entries.find(value => value.native.ui.icon === name); if (entry === undefined) throw new Error('Unknown runtime item icon'); return entry.native.ui.icon;
  } });
}
