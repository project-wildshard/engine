/**
 * A grid data cell's declared items, in hand while the feet stand in it (TEMPLATE-E2E TC-E1b). Standalone, a shardfile shard's
 * client builds its `items` rows into the page's equipment (`client.ts` `buildEquipment`); in the grid a data cell (no runtime,
 * no declared client page: the templates) has no client of its own, so it held bare hands (G68) and Brasscap's lever never came
 * to hand. Entering the cell now builds its rows (kit families, item models) into one equipment service bound under the page's
 * controls (`EnteredEquipment.bind`); leaving disposes it and the road's bare hands come back.
 *
 * On the wire the server owns every round: the kit takes the road's weapon wire, so a press, a reload and the held row go to the
 * server's seat for this cell (its slots are the cell's `enteredItems`), and a declared lever follows the server's owned lines
 * (rounds, reserve, taken) as the standalone client's does. An item request (a rack's take) is the scene the server runs it by.
 */
import { Object3D, Vector3 } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Actor, CombatTarget } from '@wildshard/engine/combat/pipeline';
import type { ItemTarget } from '@wildshard/engine/combat/items';
import { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import type { Weapon } from '@wildshard/engine/combat/Weapon';
import { playerModes } from '@wildshard/engine/player/modes';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { installDeclaredItems, leverLines, rackMeleeRows, takenLine } from '../../../shared/game/shardfile/items';
import { declaredItemIcon, declaredKitItemFamilies, declaredLever } from '../plugin/weaponFamily';
import { itemScene } from '../shardfile/clientItems';
import { loadItemModels } from '../shardfile/itemModels';
import { wirePage } from '../shardfile/wirePage';
import type { RegionalRuntimePage } from './regionalRuntime';

function isItemModel(value: unknown): value is Object3D { return value instanceof Object3D; }

/** Whether a data cell has anything to hold: a declared weapon (a kit is built around one). */
export function holdsItems(source: Pick<Shardfile, 'items'>): boolean {
  return source.items.rows.some(row => row.kind === 'weapon');
}

/** Build the cell's declared kit under `entry` and bind it as the page's held equipment until `entry` is disposed. */
/** `here`: whether the wire's frames are this cell's (a crossing's frames are another's, and their lines are not this kit's). */
export async function enterDataCellKit(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, page: RegionalRuntimePage, entry: Scope, here: () => boolean = () => true): Promise<EquipmentService | null> {
  const controls = page.equipment;
  if (controls === undefined || !holdsItems(source)) return null;
  const models = await loadItemModels(source.items, assets, entry);
  if (entry.disposed || entry.disposing) return null;
  const { app } = page.context, camera = page.world.game.camera, player = page.world.player;
  const health = (): NonNullable<typeof app.player> => { const actor = app.player; if (actor === null) throw new Error('Player health has not entered play'); return actor; };
  const actor: Actor = { id: 'actor.player', get tags() { return health().tags; }, get state() { return health().state; }, get attributes() { return health().attributes; }, get alive() { return health().alive; }, applyDamage: (request) => health().applyDamage(request) };
  const aimTarget = (target: CombatTarget): ItemTarget => {
    const { dims, scale = 1 } = target.target;
    return { ...target, aimPoint: target.position.clone().add(new Vector3(0, dims === undefined ? 0.9 : dims.bodyY * scale, 0)), reach: (dims?.bodyRadius ?? 0) * scale };
  };
  const items = installDeclaredItems(source.items, { scope: entry, actorId: actor.id, input: app.input, bindings: app.input.bindings,
    observation: { get mode() { return playerModes(player).current(); }, get item() { return app.equipment?.current.row.id ?? null; }, get flags() { return wirePage.client === null ? [] : [...wirePage.client.flags()]; } },
    families: declaredKitItemFamilies(), models, icon: declaredItemIcon, racked: rackMeleeRows(source),
    aim: () => ({ origin: camera.getWorldPosition(new Vector3()), direction: camera.getWorldDirection(new Vector3()) }),
    // SR11 (C9): on the wire an item request is the scene the server takes it by
    relay: (item, action) => { const scene = itemScene(source, item, action); if (scene === undefined || wirePage.client === null) return false; wirePage.send(scene); return true; },
    runtime: row => ({ actor, combat: app.combat, active: () => app.state === 'play',
      targets: () => app.combat.targets().map(aimTarget),
      effect: (target, effect, from) => { const service = app.effects; if (service === null) throw new Error('Missing normal effect host'); service.apply(target, effect, from); },
      hook: row.hook === null ? null : (command) => command.action, // the server runs an item's script on the wire
    }),
  });
  const weapons: readonly Weapon[] = [items.primary, items.secondary, ...items.extras].filter((weapon): weapon is Weapon => weapon !== null);
  const first = weapons[0];
  if (first === undefined) return null;
  const kit = new EquipmentService(first, { scope: entry, events: app.events, input: { bind: (action, run, _scope, allowed) => { app.input.bind(action, run, entry, allowed ?? (() => kit.enabled)); } }, order: [...items.order] });
  for (const weapon of weapons) if (weapon !== first) kit.add(weapon, { locked: true });
  items.install(kit);
  // the held models hang off the page's viewmodel, as a standalone page's do (client.ts)
  const host = app.equipmentHost;
  if (host !== null) for (const item of [...weapons, ...items.tools]) {
    const model: unknown = Reflect.get(item, 'model');
    if (isItemModel(model)) { host.viewmodel.add(model); entry.onDispose(() => { model.removeFromParent(); }); }
  }
  // the road's switches, read before the kit takes the controls: the page's reveal, menu and safe zone set them on the controls,
  // which set both while a kit is bound, so the kit starts where the road stands; it takes the road's wire with it
  const road = controls.service, enabled = road.enabled, visible = road.visible;
  controls.bind(kit, entry, { wire: true });
  kit.enabled = enabled; kit.visible = visible; kit.stowed = false;
  // TE-ENG2: a lever follows the server's owned lines; taken, it unlocks and comes to hand
  const levers = weapons.flatMap(weapon => { const lever = declaredLever(weapon); return lever === null ? [] : [lever]; });
  // TEMPLATE-E2E TC-E4: a melee weapon on a rack follows its owned taken line the same way
  // the server's set exactly (never the loadout primary). A kit with no primary whose first weapon is racked still draws it
  // in hand (a kit cannot lock its first); the server refuses its blows until it is taken
  // by the row's id (`weapon.sword-iron`), as the server's taken line names it, not the page's (`declared.weapon.sword-iron`)
  const onRacks = rackMeleeRows(source), racked = new Set(weapons.filter(weapon => onRacks.has(weapon.row.id)));
  app.addContentSystem({ id: 'grid.data-cell-kit', phase: 'update', run: (dt, t) => {
    for (const lever of levers) {
      if (wirePage.client !== null && here()) {
        const lines = leverLines(lever.row.id);
        lever.mirror(wirePage.line(lines.rounds), wirePage.line(lines.reserve), wirePage.line(lines.reloading) > 0, wirePage.line(lines.taken) > 0);
      }
      if (lever.taken && !kit.has(lever.id)) { kit.unlock(lever.id); kit.select(lever.id); }
    }
    if (wirePage.client !== null && here()) for (const weapon of racked) {
      if (wirePage.line(takenLine(weapon.row.id)) <= 0) continue;
      racked.delete(weapon); if (!kit.has(weapon.id)) { kit.unlock(weapon.id); kit.select(weapon.id); }
    }
    kit.update(dt, t);
  } }, entry);
  entry.onDispose(() => { kit.enabled = false; kit.visible = false; kit.adsHeld = false; kit.altHeld = false; });
  return kit;
}
