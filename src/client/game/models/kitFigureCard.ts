/** Cold kit cards use the existing numeric figure, catalogue and draw formats.
 * The card owns only its template intake, geometry copies and live figure. */
import * as v from 'valibot';
import { Group } from 'three';
import { TIER } from '@wildshard/engine/core/tier';
import type { ExplorerEntryRow } from '@wildshard/format/explorerCatalogue';
import { atlasFigureSkin } from '../systems/npc/figureSkins';
import { defineModel, type ModelDef } from '@wildshard/engine/models/model';
import { loadingSpecimen } from '@wildshard/engine/models/gear';
import { resourceScope } from '@wildshard/engine/app/resources';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import { KitFigureCardsSchema, type KitFigureCardsRows } from '@wildshard/format/questFigures';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { SceneHandles } from '../shardfile/sceneHandles';
import { FolderFigureCatalogue } from './figureCatalogue';
import { ResolvedIslandLibrarySchema } from '@wildshard/format/islandLibrary';
import { coldFixedDraws } from './fixedDraws';
import { questFigure } from '../quest/figures';

/** Internal Explorer dispatch. It never falls back to an entered draw loan or
 * installs a world service; its source catalogue retains its original owner. */
export function kitFigureCard(product: ShardFolder, input: KitFigureCardsRows, key: string): ModelDef<Record<string, never>> {
  const book = v.parse(KitFigureCardsSchema, input), card = book.cards[key];
  if (card === undefined || !product.has(book.draws) || !product.hasFile(book.catalogue)) throw new Error('Kit card requires its declared figure, draws and catalogue');
  if (new Set(Object.values(book.cards).map(row => row.model.id)).size !== Object.keys(book.cards).length) throw new Error('Repeated kit card model identity');
  const source = v.parse(ResolvedIslandLibrarySchema, product.section(book.draws)), sourceOwner = resourceScope();
  const row = card.figure, slots = [...new Set([...Object.values(row.parts), ...row.objects.map(object => object.draw), ...row.publish.map(publication => publication.draw)])];
  const { surface, ...metadata } = card.model;
  return defineModel<Record<string, never>>({ ...metadata, ...(surface === undefined ? {} : { surface }), specimenLifetime: 'view', build: ctx => {
    const owner = ctx.specimenScope;
    if (owner === undefined) throw new Error('Kit figure card requires its view owner');
    const check = (): void => {
      if (owner.disposed || owner.disposing || sourceOwner.disposed || sourceOwner.disposing) throw new Error('Kit figure card owner left');
    };
    check();
    return loadingSpecimen(card.model.id, [1, 1, 1], async () => {
      const catalogue = await FolderFigureCatalogue.fromFolder(product, book.catalogue, sourceOwner); check();
      const draws = await coldFixedDraws(product, source.draws, owner, slots); check();
      const resources = new SceneHandles(ctx.sky);
      const figure = owner.run(() => questFigure(row, { sky: ctx.sky, scope: owner, resources, catalogue,
        draws: { get ready() { return draws.ready; }, handle: slot => ({ copy: () => {
          const geometry = draws.handle(slot).copy(); ownSceneResource(geometry, owner); return geometry;
        } }) },
        place: place => ({ x: place.x, y: place.y ?? 0, z: place.z, yaw: place.yaw ?? 0 }),
        channels: product.shardfile.clientChannels }));
      owner.onDispose(() => { figure.dispose(); figure.group.removeFromParent(); });
      await figure.presentation.ready; check();
      return figure.group;
    }, owner);
  } });
}

type AtlasCardRow = Extract<ExplorerEntryRow, { readonly atlases: unknown }>;
/** A kit card drawn from merged figure atlases (G601 C5): one card whose variants are its atlases, each a single figure
 *  at rest, its first joint the root and the rest hung from it, as the atlas declares its joints. */
export function atlasFigureCard(row: AtlasCardRow, skinUrl: (url: string) => string = url => url): ModelDef<{ readonly figure: string }> {
  const keys = Object.keys(row.atlases), first = keys[0];
  if (row.id === undefined || row.name === undefined || row.file === undefined || first === undefined) throw new Error('Atlas figure card requires its id, name, file and an atlas');
  const id = row.id;
  return defineModel<{ readonly figure: string }>({ id, name: row.name, file: row.file, category: row.category ?? 'people', pipeline: row.pipeline ?? 'code',
    ...(row.surface === undefined ? {} : { surface: row.surface }), specimenLifetime: 'view', defaults: { figure: first },
    variants: keys.map(key => ({ id: key, label: row.atlases[key]?.label ?? key, params: { figure: key } })),
    build: (ctx, p) => {
      const owner = ctx.specimenScope, atlas = row.atlases[p.figure];
      if (owner === undefined) throw new Error('Atlas figure card requires its view owner');
      if (atlas === undefined) throw new Error(`No figure atlas ${p.figure}`);
      return loadingSpecimen(id, [1, 1, 1], async () => {
        const mesh = await atlasFigureSkin(atlas[TIER], ctx.sky, owner, skinUrl), [root, ...rest] = mesh.skeleton.bones, group = new Group();
        if (root === undefined) throw new Error('Figure atlas has no root joint');
        for (const bone of mesh.skeleton.bones) { bone.matrixAutoUpdate = true; bone.matrixWorldAutoUpdate = true; }
        if (rest.length > 0) root.add(...rest);
        mesh.add(root); group.add(mesh);
        group.updateMatrixWorld(true); mesh.skeleton.update(); mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        return group;
      }, owner);
    } });
}
