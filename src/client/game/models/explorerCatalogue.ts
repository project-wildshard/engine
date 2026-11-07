import { literal, parse } from 'valibot';
import { admittedIslandBook } from '../shardfile/islandBook';
import { SpecimenBookSchema } from '@wildshard/format/specimenCatalogue';
import { TIER } from '@wildshard/engine/core/tier';
import { defineSpecimenCatalogue,prepareSpecimenCatalogue } from './specimenCatalogue';
/** Client-only Model Explorer adapter. Ordered data selects the existing model
 * contract; the authoritative simulation never imports this module. */
import { HeldClaims } from '../loadout/claims';
import { live, type RosterEntry } from '@wildshard/engine/models/live';
import { creature } from '@wildshard/engine/models/creature';
import { defineModel, type ModelDef } from '@wildshard/engine/models/model';
import { speciesDef } from '@wildshard/engine/entities/species/registry';
import { trainingDummy } from '@wildshard/engine/models/trainingDummy';
import { hoverboard } from '@wildshard/engine/models/hoverboard';
import { swimHands } from '@wildshard/engine/models/swimHands';
import type { ExplorerEntryRow } from '@wildshard/format/explorerCatalogue';
import { ProductError, type ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { prepareSceneSources, prepareSceneSpecimens, sceneModelDefinition, sceneModelDefinitions, sceneModelSource } from '../shardfile/sceneSources';
import { declaredHeldSpecimen, declaredNpcSpecimen } from './sceneSpecimens';
import { scenePartSpecimen } from './scenePartSpecimen';
import { ProductFigureCatalogue } from './figureCatalogue';
import { KitFigureCardsSchema } from '@wildshard/format/questFigures';
import { atlasFigureCard, kitFigureCard } from './kitFigureCard';
import { productSkinUrl } from '../systems/npc/figureSkins';
import { declaredSocketRigCreatures } from './socketRigCreature';
import { PosedDraw } from '../looks/posedInstances';
import { heldGear, heldArmsGear } from './heldGear';
import { HeldEquipment } from '../plugin/heldEquipment';
import { HeldFinishes } from '../loadout/finishes';
import { resourceScope } from '@wildshard/engine/app/resources';
import { cloudBodySpecimen } from '../boss/encounterView';
import { defineMountedSpecimen } from './mountedSpecimen';
import { HeldGraphCardsSchema } from '@wildshard/format/heldArms';

/** Resolve declarations before registering any card, so an invalid reference
 * refuses the complete catalogue instead of publishing a partial roster. */
export async function explorerRoster(product: ShardProduct, native: readonly RosterEntry[] = []): Promise<readonly RosterEntry[]> {
  try { return await resolveExplorerRoster(product, native); }
  catch (error) {
    if (error instanceof ProductError && error.item === 'explore/catalogue') throw error;
    throw new ProductError(product.slug, 'explore/catalogue', 'schema', error instanceof Error ? error.message : 'Catalogue source admission failed');
  }
}

async function resolveExplorerRoster(product: ShardProduct, native: readonly RosterEntry[]): Promise<readonly RosterEntry[]> {
  if (!product.has('explore/catalogue')) return [];
  const rows = product.section('explore/catalogue');
  const sourceKinds = rows.entries.some(row => row.kind === 'rigs' || row.kind === 'held' && row.cards === undefined || row.kind === 'npc' || row.kind === 'scene');
  if (sourceKinds) await prepareSceneSources(product);
  const definitions = sourceKinds ? sceneModelDefinitions(product) : [];
  const prepare = (): Promise<void> => prepareSceneSpecimens(product);
  const entries: RosterEntry[] = [];
  const preparedSpecimens=new Map<string,ReturnType<typeof defineSpecimenCatalogue<Record<string,object>>>>();
  for (const row of rows.entries) {
    if (row.kind === 'species') {
      const programs = product.has('actors/species-programs') ? product.section('actors/species-programs') : undefined;
      const declared = programs?.program?.species.find(entry => entry.kind === row.species)
        ?? programs?.native.find(entry => entry.kind === row.species) ?? programs?.page.find(entry => entry.kind === row.species);
      const species = declared ?? product.shardfile.rows.species.find(entry => entry.kind === row.species)
        ?? speciesDef(row.species);
      if (row.id === undefined || row.file === undefined) throw refusal(product, row, 'Species card requires its original id and file');
      entries.push(present(defineModel({ ...creature(row.species, { species, ...(row.name === undefined ? {} : { name: row.name }),
        ...(row.spawnOnly === undefined ? {} : { spawnOnly: row.spawnOnly }) }), id: row.id, file: row.file,
        pipeline: row.pipeline ?? 'code', ...(row.surface === undefined ? {} : { surface: row.surface }), ...(row.category === undefined ? {} : { category: row.category }) }), row));
    } else if (row.kind === 'cloud') {
      if (row.id === undefined || row.name === undefined) throw refusal(product, row, 'Cloud card requires its id and name');
      const cloud = await product.json<unknown>(row.json), id = row.id, name = row.name;
      entries.push(present(defineModel<object>({ id, name, file: row.file ?? row.json, category: row.category ?? 'creatures', pipeline: row.pipeline ?? 'code', defaults: {},
        build: () => cloudBodySpecimen(cloud) }), row));
    } else if (row.kind === 'mounted') {
      entries.push(present(defineMountedSpecimen(row.specimen), row));
    } else if (row.kind === 'engine') {
      entries.push(row.model === 'swim-hands' ? present(swimHands, row) : row.model === 'training-dummy' ? present(trainingDummy, row) : present(hoverboard, row));
    } else if (row.kind === 'rigs') {
      const source = sceneModelDefinition(product, row.library), specimens = source.specimens;
      if (specimens === undefined) throw refusal(product, row, 'Library declares no rig specimens');
      for (const model of sceneModelSource(product, row.library).models(specimens)) entries.push({ ...present(model, row), prepare });
    } else if (row.kind === 'held') {
      if (!product.shardfile.items.rows.some(item => item.id === row.item)) throw refusal(product, row, 'Unknown held item');
      if (row.cards !== undefined) {
        const cards = parse(HeldGraphCardsSchema, await product.json<unknown>(row.cards));
        const arms = product.section('held/arms');
        if (!('kind' in arms) || arms.kind !== 'declared-primary' || arms.primary.item !== row.item
          || arms.primary.file !== cards.file) throw refusal(product, row, 'Held cards require their declared primary and presentation');
        parse(literal(product.slug), cards.slug);
        const matches = cards.cards.filter(card => row.id === undefined || card.id === row.id), card = matches[0];
        if (matches.length !== 1 || card === undefined) throw refusal(product, row, 'Held row requires exactly one existing graph card');
        entries.push(...heldArmsGear({ ...cards, cards: [card] }));
        continue;
      }
      if (product.has('held/arms')) {
        const arms = product.section('held/arms'), weapon = 'kind' in arms ? undefined : arms.weapons.find(entry => entry.item === row.item);
        if (weapon !== undefined && !('kind' in arms)) {
          const cards = arms.cards.filter(card => card.kind === weapon.blade), card = cards[0];
          if (cards.length !== 1 || card === undefined) throw refusal(product, row, 'Held item requires exactly one existing arms card');
          const entry = HeldClaims.gear(arms).find(candidate => candidate.id === card.id);
          if (entry === undefined) throw refusal(product, row, 'Held arms card is absent'); entries.push(entry); continue;
        }
      }
      const matches = definitions.flatMap(source => source.source.held?.filter(model => model.item === row.item).map(model => ({ source: source.id, model })) ?? []), match = matches[0];
      if (matches.length !== 1 || match === undefined) throw refusal(product, row, 'Held item requires exactly one existing model definition');
      const model = declaredHeldSpecimen(product, match.source, match.model);
      if (model === undefined) throw refusal(product, row, 'Held model is absent');
      entries.push({ ...present(model, row), prepare });
    } else if (row.kind === 'npc') {
      if (!product.shardfile.questNpcs?.some(npc => !('kind' in npc) && npc.npc.id === row.npc)) throw refusal(product, row, 'Unknown quest NPC');
      const matches = definitions.flatMap(source => source.source.npcs?.filter(model => model.npc === row.npc) ?? []), match = matches[0];
      if (matches.length !== 1 || match === undefined) throw refusal(product, row, 'NPC requires exactly one existing figure definition');
      const model = declaredNpcSpecimen(product, match);
      if (model === undefined) throw refusal(product, row, 'NPC model is absent');
      entries.push({ ...present(model, row), prepare });
    } else if(row.kind==='specimen'){
      const file=row.books[TIER];let catalogue=preparedSpecimens.get(file);
      if(catalogue===undefined){const book=parse(SpecimenBookSchema,await product.json<unknown>(file));catalogue=defineSpecimenCatalogue<Record<string,object>>(book.rows,book.packed,book.materials,await prepareSpecimenCatalogue(product,book.rows,undefined,book.packed===undefined?[]:[book.packed]));preparedSpecimens.set(file,catalogue);}
      const copies=row.tierCopies?.[TIER];entries.push(present(catalogue.model(row.model),copies===undefined?row:{...row,copies}));
    } else if (row.kind === 'collection' || row.kind === 'scene-model') {
      const book = await admittedIslandBook(product, row.library);
      if (row.kind === 'collection') {
        await book.library.collections.prepare();
        entries.push(present(book.library.collections.model(row.model), row));
      } else entries.push(present(book.sites.model(row.model), row));
    } else if (row.kind === 'figure') {
      const { file, ...card } = row;
      entries.push(present((await ProductFigureCatalogue.fromProduct(product, file)).model(row.figure), card));
    } else if (row.kind === 'kit-figure' && 'atlases' in row) {
      entries.push(present(atlasFigureCard(row, productSkinUrl(product)), row));
    } else if (row.kind === 'kit-figure') {
      const book = parse(KitFigureCardsSchema, await product.json<unknown>(row.file));
      entries.push(present(kitFigureCard(product, book, row.figure), row));
    } else if (row.kind === 'socket-creature') {
      const card = declaredSocketRigCreatures(product).find(candidate => candidate.model.id === row.rows.model.id);
      if (card === undefined) throw refusal(product, row, 'Missing admitted socket creature card');
      entries.push({ ...present(card.model, row), prepare: () => card.card.preload() });
    } else if (row.kind === 'equipment') {
      const scope = resourceScope().child('held-finish-roster'), source = product.section('held/finishes').source;
      if (source === undefined) throw refusal(product, row, 'Held finishes require their declared geometry source');
      await Promise.all([HeldFinishes.prepare(product, scope), HeldEquipment.prepare(product)]);
      entries.push(...heldGear(product.section('held/gear')));
    } else if (row.kind === 'posed' && row.source === 'product') {
      entries.push(...(await PosedDraw.library(product, row.file)).models);
    } else if (row.kind === 'posed') {
      // The native transition already admits this existing posed library. Select
      // its actual definitions by id without duplicating its format or builder.
      const library = await product.json<{ readonly models: readonly { readonly id: string }[] }>(row.file);
      if (library.models.length === 0 || library.models.length > 32) throw refusal(product, row, 'Invalid posed model library');
      for (const model of library.models) {
        const entry = native.find(candidate => candidate.id === model.id);
        if (entry === undefined) throw refusal(product, row, 'Posed library requires its prepared model definition'); entries.push(entry);
      }
    } else if (row.kind === 'library' && row.library === 'native') {
      const entry = native.find(model => model.id === row.model);
      if (entry === undefined) throw refusal(product, row, 'Unknown native specimen');
      entries.push(entry);
    } else if (row.kind === 'scene') {
      const matches = definitions.flatMap(source => source.source.scenes?.filter(model => model.part === row.part) ?? []), match = matches[0];
      if (matches.length !== 1 || match === undefined) throw refusal(product, row, 'Scene part requires exactly one existing specimen definition');
      const step = product.section('world/scenes').steps.find(entry => entry.id === match.step);
      if (step === undefined || row.part !== `${step.id}.root` && !Object.keys(step.publish).some(id => row.part === `${step.id}.${id}`)) throw refusal(product, row, 'Scene part is not a declared publication');
      entries.push(present(scenePartSpecimen(product, match), row));
    } else throw refusal(product, row, `Unresolved catalogue kind ${row.kind}`);
  }
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new ProductError(product.slug, 'explore/catalogue', 'schema', 'Expanded catalogue repeats a model identity');
  return [...entries, ...native.filter(entry => !entries.some(declared => declared.id === entry.id))];
}

function refusal(product: ShardProduct, row: ExplorerEntryRow, detail: string): ProductError {
  return new ProductError(product.slug, 'explore/catalogue', 'schema', `${row.id ?? row.kind}: ${detail}`);
}

/** Metadata belongs to the roster reference; the existing builder stays intact. */
type Presentation = Pick<ExplorerEntryRow, 'id' | 'name' | 'file' | 'category' | 'surface' | 'pipeline' | 'copies' | 'planned' | 'drawnAs'>;
function present<P extends object>(model: ModelDef<P>, row: Presentation): RosterEntry {
  return live({ ...model, ...(row.id === undefined ? {} : { id: row.id }), ...(row.name === undefined ? {} : { name: row.name }),
    ...(row.file === undefined ? {} : { file: row.file }), ...(row.category === undefined ? {} : { category: row.category }),
    ...(row.surface === undefined ? {} : { surface: row.surface }) }, row);
}
