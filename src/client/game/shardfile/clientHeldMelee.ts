import { parse } from 'valibot';
import { Mesh } from 'three';
import { ClientHeldMeleeSchema } from '@wildshard/format/clientNative';
import type { ShardContext } from '../plugin/context';
import { createDeclaredHeldMelee } from '../plugin/weaponFamily';
import { runtimeEquipment } from '../../../shared/game/plugin/runtimeRows';
import { resolveSceneHeld } from '../models/sceneSpecimens';
import { folderPainterLight, folderPaintedImage } from '../looks/paintedLook';
import { sceneModelSource } from './sceneSources';
import { bindPageMelee, installPageItemContexts } from './pageItems';
import { clientNativeBook } from './clientNativeBook';

type EquipmentBuilder = NonNullable<NonNullable<ShardContext['game']['runtime']>['buildEquipment']>;
type EquipmentTargets = Parameters<EquipmentBuilder>[0];
/** Compiled held.melee kit feature. The item and model definitions select one
 * original controller at its authored kit/equipment boundary. */
export function installClientHeldMelee(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientHeldMeleeSchema, input), source = ctx.product.shardfile, book = clientNativeBook(ctx);
  const runtime = ctx.game.runtime;
  if (runtime === undefined || book.held !== null) throw new Error('Held feature needs one actual kit owner');
  const item = source.items.rows.find(candidate => candidate.id === row.item);
  if (source.items.loadout.primary !== row.item || item?.kind !== 'weapon' || item.contacts === undefined)
    throw new Error('Held feature requires its admitted primary contact item');
  const { recipe, model } = resolveSceneHeld(ctx.product, row.item);
  ctx.rows.weapon(recipe.equipment);
  const create = (contacts: unknown, raycast?: EquipmentTargets['raycast'],
    charge?: number): ReturnType<typeof createDeclaredHeldMelee> => {
    if (book.held !== null) throw new Error('Held controller is already constructed');
    if (contacts === undefined) throw new Error('Held controller requires its admitted contacts');
    if (row.targets === 'raycast' && raycast === undefined) throw new Error('Held raycast requires its equipment query owner');
    const weapon = createDeclaredHeldMelee(ctx.app, recipe, { model, contacts,
      ...(charge === undefined ? {} : { charge }),
      ...(raycast === undefined ? {} : { raycast }),
    });
    const finish = row.finish;
    if (finish !== undefined) {
      const original = weapon.parts.material(finish.part);
      const material = sceneModelSource(ctx.product, finish.library).mappedLook(finish.look, folderPaintedImage(ctx.product, finish.image));
      weapon.parts.root.traverse(part => { if (part instanceof Mesh && part.material === original) part.material = material; });
    }
    book.held = weapon; return weapon;
  };
  if (row.stage === 'kit') create(item.contacts);
  runtime.buildEquipment = runtimeEquipment([{ slot: 'primary', create: targets => {
    const weapon = book.held ?? bindPageMelee(ctx, source, {
      icon: name => { if (name !== recipe.equipment.ui.icon) throw new Error('Unknown held item icon'); return recipe.equipment.ui.icon; },
      create: (_row, spec, ports) => create(ports.contacts, targets.raycast.bind(targets), spec.charge),
    });
    weapon.onSwing = heavy => { if (heavy) runtime.play?.cues.charge(recipe.equipment, 'heavy'); else runtime.play?.cues.fire(recipe.equipment); };
    return weapon;
  } }]);
}

/** Complete the same native controller after the actual motion/item hook lane
 * exists. No equipment actor, contact phase or input context is reconstructed. */
export function enterClientHeldMelee(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientHeldMeleeSchema, input), source = ctx.product.shardfile, book = clientNativeBook(ctx);
  const weapon = book.held, host = ctx.app.equipmentHost;
  if (weapon === null || host === null) throw new Error('Held play feature requires its original equipped controller');
  host.viewmodel.add(weapon.model); ctx.scope.onDispose(() => { weapon.model.removeFromParent(); });
  if (ctx.product.section('look/painted').look.lightScope === 'material') {
    folderPainterLight(ctx.product, weapon.model, ctx.scope); ctx.scope.ownPrimitives(weapon.model);
  }
  const stowedMode = row.stowedMode;
  if (stowedMode !== undefined) weapon.stowed = () => ctx.app.player?.mode === stowedMode;
  installPageItemContexts(ctx, source);
  if (!row.composed) return;
  const item = source.items.rows.find(candidate => candidate.id === row.item);
  if (item?.kind !== 'weapon' || item.secondary === undefined) throw new Error('Held composed action needs its admitted item');
  const secondary = item.secondary, native = weapon.row;
  bindPageMelee(ctx, source, {
    presentation: { ...(native.cues === undefined ? {} : { cues: native.cues }), ui: { touch: 'melee', lockOn: true, melee: true, tracers: false } },
    icon: name => { if (name !== native.ui.icon) throw new Error('Unknown held item icon'); return native.ui.icon; },
    create: (equipment, spec, ports) => {
      if (ports.contacts === undefined || ports.secondary === undefined) throw new Error('Missing admitted secondary contact');
      // A secondary's start is felt here and settled by the server, whose item hook has the say (J126).
      weapon.bindSecondary(family => family.claim(secondary.move) ? secondary.move : null, spec.charge);
      weapon.row = { ...equipment, meta: native.meta };
      return weapon;
    },
  });
}
