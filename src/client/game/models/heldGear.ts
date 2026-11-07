import { live, type RosterEntry } from '@wildshard/engine/models/live';
import { defineModel } from '@wildshard/engine/models/model';
import { loadingSpecimen, skinVariants, wearSkin, type GearSkinParams } from '@wildshard/engine/models/gear';
import { HeldArmsSchema, HeldGraphCardsSchema } from '@wildshard/format/heldArms';
import { HeldView } from '../systems/viewmodel/heldView';
import { HeldGearSchema } from '@wildshard/format/heldGear';
import * as v from 'valibot';
import { HeldEquipment } from '../plugin/heldEquipment';
import { heldBowArrow, heldBowDisplay, heldLauncherBolt, heldLauncherDisplay } from '../weapons/heldLauncher';
import { heldToolSpecimen, heldToolRows } from '../plugin/heldTool';
import { HeldFinishes } from '../loadout/finishes';
import { loadFirstPartyProduct } from '../shardfile/runtimeProduct';

/** Client-only presentation: define held gear from pre-admission card rows; all family builders and preparation live here. */
export function heldGear(input: unknown): readonly RosterEntry[] {
  const rows = v.parse(HeldGearSchema, input);
  const catalogue = (): HeldEquipment => HeldEquipment.current(rows.slug);
  const finishes = (): HeldFinishes => HeldFinishes.current(rows.slug);
  const prepare = async (): Promise<void> => {
    const product = await loadFirstPartyProduct(rows.slug);
    await HeldEquipment.prepare(product);
    finishes();
  };
  const variants = rows.variantOrder.map(id => {
    const card = rows.cards.find(row => row.id === id);
    if (card === undefined) throw new Error('Held gear variant has no card');
    return { id: card.id, name: card.name, weapon: card.icon === 'lever' ? 'rifle' as const : 'crossbow' as const };
  });
  return rows.models.map(row => {
    const dressed = row.role === 'launcher' || row.role === 'firearm';
    const model = defineModel<Partial<GearSkinParams>>({
      id: row.id, name: row.name, category: 'gear', file: row.file, pipeline: row.pipeline,
      defaults: dressed ? { skin: null } : {}, prepare,
      ...(row.surface === undefined ? {} : { surface: row.surface }),
      ...(row.yaw === undefined ? {} : { specimenYaw: row.yaw }),
      ...(row.role === 'launcher' || row.role === 'firearm' ? { variants: skinVariants(row.role === 'launcher' ? 'crossbow' : 'rifle', variants) } : {}),
      build: (ctx, params) => {
        const host = catalogue();
        const skin = { skin: params.skin ?? null };
        if (row.role === 'launcher') return wearSkin(heldLauncherDisplay(ctx.sky, host.launcherRows(), host.launcherModel()), skin, ctx.sky, finishes().list());
        if (row.role === 'firearm') {
          const made = ctx.once(row.onceKey, async () => host.firearmSpecimen(ctx.sky, await host.preloadFirearm()));
          if (row.placeholder === undefined) throw new Error('Held firearm card needs its loading bounds');
          return loadingSpecimen(row.id, row.placeholder, async () => wearSkin((await made).clone(), skin, ctx.sky, finishes().list()));
        }
        if (row.role === 'bow') return ctx.once(row.onceKey, () => { const bow = host.bow(); return heldBowDisplay(ctx.sky, bow.rows, bow.model); }).clone();
        if (row.role === 'bolt') {
          const { geometry, material } = ctx.once(row.onceKey, () => heldLauncherBolt(ctx.sky, host.launcherRows(), host.launcherModel()));
          return [{ geometry, material, castShadow: true, receiveShadow: true }];
        }
        if (row.role === 'arrow') return [ctx.once(row.onceKey, () => { const bow = host.bow(); return { ...heldBowArrow(ctx.sky, bow.rows, bow.model), castShadow: true, receiveShadow: true }; })];
        return heldToolSpecimen(ctx, row.id, heldToolRows(host.rows.tool), row.onceKey);
      },
    });
    return live(model, { copies: row.copies, ...(row.drawnAs === undefined ? {} : { drawnAs: row.drawnAs }) });
  });
}

/** Client-only Explorer cards for admitted melee arms (a toon catalogue's blades, or a graph held view's cards);
 *  preparation retains the row's original look and size. */
export function heldArmsGear(input: unknown): readonly RosterEntry[] {
  const rows = v.parse(v.union([HeldArmsSchema, HeldGraphCardsSchema]), input);
  if ('kind' in rows) {
    if (rows.kind !== 'graph') throw new Error('Declared primary cards use their original graph catalogue');
    const { slug, file } = rows;
    return rows.cards.map(row => live(defineModel<object>({ id: row.id, name: row.name, category: 'gear', pipeline: row.pipeline, file: row.file,
      defaults: {}, rig: { clips: row.clips },
      build: context => loadingSpecimen(row.id, row.size, async () => (await HeldView.fromProduct(slug, file)).specimen({ settleFrames: row.settleFrames, renderer: context.renderer })) }),
    { copies: row.copies }));
  }
  const arms = HeldView.admit({ kind: 'toon', ...rows.look });
  return rows.cards.map(row => live(defineModel<object>({ id: row.id, name: row.name, category: 'gear', pipeline: ['blender','code'], file: row.file, defaults: {},
    build: context => loadingSpecimen(row.id, row.size, async () => {
      await arms.prepareExplorer(context, await loadFirstPartyProduct(rows.slug)); return arms.specimen({ sky: context.sky, blade: row.kind });
    }) }), { copies: row.copies }));
}
