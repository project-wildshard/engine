import { prepareClientModuleGroups } from './clientModules';
import { outputDescriptor, isBuildValidatedOutput } from '../../../shared/game/shardfile/outputDescriptor';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { runtimeAccountedBytes } from '@wildshard/format/runtimeCost';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { contentCost } from '@wildshard/format/contentCost';
import { MEMORY_GATES } from '@wildshard/format/contentBounds';
import { isOutputIndex } from '@wildshard/format/outputAddress';
import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { isDev } from '@wildshard/engine/core/devMode';
import { CONTENT_CAPS, _applyChunkConstants } from '@wildshard/engine/core/config';
import { configureLevel } from '@wildshard/engine/level/selection';
import { pageGridInstance, sourceManifest, compiledPageBoot, type PageMode } from '../plugin/context';
import { PageResidency } from '../grid/pageResidency';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import type { GridRecoveryRecord } from '../../../shared/game/grid/recovery';
import { bootPageMode, pageGridRecovery } from '../grid/pageEntry';
import { currentPageMode } from '../../../shared/game/grid/pageMode';
import { firstPartyInstance } from '../../../shared/game/grid/instances';
import { game } from '../shard/registry';
import { installShards, shards } from '../shard/list';
import type { ShardManifest } from '../shard/manifest';
import { toLevelSpec } from '../shard/spec';
import { productPaintedLook } from '../looks/paintedLook';
import { emptyLook } from './emptyLook';
import { shardfileLook } from './look';
import { admitProduct, readProductInput, readProductDescriptor, type AdmittedProduct, type ProductOptions } from './product';
import { manifestReader, provideManifestAdmission } from './runtimeProduct';
import { ClientAssets } from './clientAssets';
import type { ShardfileClientBindings } from './client';
import { clientGround, clientPageGround, tiledBootstrapGround } from '../../../shared/game/shardfile/clientGround';
import { shardfileWater } from './water';
import { clientResidency } from './clientResidency';

/** The composition root passes this selection to hydration and startSession; its grid intent has already been consumed. */
export interface PageResidencyBoot {
  readonly mode: PageMode;
  readonly instance: string | null;
  readonly residency?: PageResidency;
  /** G216: one trusted page policy also reaches data-only SHARD SELECT validation and its warning surface. */
  readonly memory: MemoryAdmission;
  /** Validated recovery uses the ordinary owner, then returns to the road. */
  readonly recovery?: NonNullable<GridRecoveryRecord>;
}

/**
 * G144's single grid boot seam. Call before descriptor hydration and any world construction. Opaque homes must supply
 * reviewed measurements here, since their hybrid data hook runs after bootstrap. Data homes are admitted by the loader
 * against their declared sim cost, then their actual library and tile claims. The root disposes failed hydration; the
 * successful session installs the owner's level lifetime.
 */
export function preparePageResidency(manifest: Pick<ShardManifest, 'slug' | 'shardfile' | 'runtimeCost'>, configuredSlug?: string, memory: MemoryAdmission = new MemoryAdmission(() => MEMORY_GATES.reportOnly || isDev())): PageResidencyBoot {
  const mode = bootPageMode(configuredSlug ?? manifest.slug);
  const measuredHome = configuredSlug === undefined && manifest.shardfile === undefined;
  if (mode !== 'grid' && (!measuredHome || manifest.runtimeCost === undefined)) return { mode, instance: null, memory };
  const instance = mode === 'grid' ? pageGridInstance() : manifest.slug;
  if (instance === null) throw new Error('Grid residency requires the consumed home instance');
  const residency = new PageResidency(new ResidencyAllocator({ memory }));
  try {
    if (measuredHome) {
      if (manifest.runtimeCost === undefined) throw new Error('Grid runtime home requires reviewed memory measurements before bootstrap');
      const bytes = runtimeAccountedBytes(manifest.runtimeCost), row = manifest.runtimeCost;
      const cost = contentCost({ l0: 0, l1: 0, far: 0, libraries: 0, sims: bytes, commons: 0, overlap: CONTENT_CAPS.overlap });
      if (!memory.accept({ stage: 'runtime', owner: instance, id: `sim:${instance}`, claimedBytes: bytes,
        accountedBytes: cost.accounted, playingBytes: cost.playing, loadingBytes: cost.loading,
        measured: { webContentBytes: Math.ceil(row.webContentMB * 1_000_000), glBytes: Math.ceil(row.glMB * 1_000_000), engineBaseBytes: Math.ceil(row.engineBaseMB * 1_000_000),
          ...(row.residentBaseMB === undefined ? {} : { residentBaseBytes: Math.ceil(row.residentBaseMB * 1_000_000) }),
          rev: row.rev, device: row.device, evidence: row.evidence } })) throw new Error('Home residency admission deferred by the shared budget');
      // A matched increment subtracts the persistent composer; it cannot cover that page component again.
      residency.admitHome(instance, bytes, row.residentBaseMB === undefined);
    }
    const recovery = mode === 'grid' ? pageGridRecovery() : null;
    return { mode, instance, residency, memory, ...(recovery === null ? {} : { recovery }) };
  } catch (error) { residency.dispose(); throw error; }
}

/** Admit every immutable byte before creating a normal Game level source; scopes own all staged content bindings. */
export async function shardfileSource(input: unknown, options: ProductOptions, bindings: ShardfileClientBindings): Promise<ShardManifest> {
  const ownedOptions = withPageMemory(options, bindings);
  return clientSource(await admitProduct(input, ownedOptions), ownedOptions, bindings);
}

function withPageMemory(options: ProductOptions, bindings: ShardfileClientBindings): ProductOptions {
  const memory = bindings.residency?.memory ?? options.memory;
  if (bindings.residency !== undefined && options.memory !== undefined && memory !== options.memory) throw new Error('Shardfile admission must share the page memory policy');
  return memory === undefined ? options : { ...options, memory };
}

function clientSource(admitted: AdmittedProduct, options: ProductOptions, bindings: ShardfileClientBindings): ShardManifest {
  const source = admitted.source;
  if (bindings.trustedRuntime === true && (!options.firstParty || source.runtime === null)) throw new Error('Empty hybrid policy requires a trusted first-party runtime declaration');
  if (bindings.audioOwner === 'runtime' && (!options.firstParty || source.runtime === null)) throw new Error('Runtime audio ownership requires a trusted first-party runtime declaration');
  if (bindings.worldOwner === 'runtime' && (!options.firstParty || source.runtime === null)) throw new Error('Runtime world ownership requires a trusted first-party runtime declaration');
  if (!options.firstParty && admitted.instance === undefined) throw new Error('Outside shardfile is missing its admitted save identity');
  const sections = outputDescriptor(source)?.sections;
  if (sections !== undefined) prepareClientModuleGroups(source, sections);
  const ownedBindings = { ...bindings,
    ...(bindings.allocator === undefined && bindings.residency === undefined && options.memory !== undefined ? { allocator: new ResidencyAllocator({ memory: options.memory }) } : {}),
    ...(options.firstParty ? {} : { instance: admitted.instance ?? '' }) };
  const residency = clientResidency(source, ownedBindings);
  const assets = new ClientAssets(source, admitted.assets, options);
  const manifest = sourceManifest(source, admitted.assets, bindings.imageOwner);
  const clientBindings = { ...ownedBindings, allocator: residency.allocator };
  const result: ShardManifest = { ...manifest, ...(source.presentation === undefined ? { biome: 'Authored world', blurb: source.identity.name } : {}),
    // Traversal belongs to the platform, independently of authored item rows or Developer mode.
    loadout: { weapons: [], tools: ['tool.hoverboard'], start: ['tool.hoverboard'] },
    ...(manifest.navigation === undefined ? {} : { navigation: manifest.navigation }),
    // A product with no terrain is a structure world, an empty one included: a slab needs rock art only a hybrid's manifest has.
    ground: { structures: true, paths: 'plugin', terrain: clientGround(source, assets.retained), water: shardfileWater(source.water) },
    species: source.rows.species.map((row) => row.kind), uses: ['spawns', 'quests', 'bosses', 'elites', 'swim', 'hover', 'explore', 'practice'],
    loot: { coins: source.rows.loot.length > 0 },
    creatures: { lowPoly: true, waitForModels: false, furRim: false, tintRange: 0, oneMaterial: true },
    render: product => product.has('look/painted') ? productPaintedLook(product) : Promise.resolve(source.look.keys.length === 0 ? emptyLook(source.look.dayOverride) : shardfileLook(source.look, assets.retained)),
    load: async () => { const { ShardfileClient } = await import('./client'); return { default: class extends ShardfileClient { constructor() { super(source, assets, clientBindings); } } }; },
  };
  provideManifestAdmission(result, admitted, options, assets);
  return result;
}

/** Select a fully admitted external product before the ordinary session starts; first-party discovery remains installed.
 * A trusted preparation barrier may overlap admission, but precedes every live binding and publication. */
export async function installShardfileProduct(input: unknown, providedOptions: ProductOptions, bindings: ShardfileClientBindings, prepared?: () => Promise<unknown>): Promise<ShardManifest> {
  const options = withPageMemory(providedOptions, bindings);
  const admitted = await admitProduct(input, options);
  if (admitted.source.runtime !== null) throw new Error('Custom runtime requires trusted hybrid composition');
  if (prepared !== undefined) await prepared();
  const source = clientSource(admitted, options, bindings);
  return selectSource(source, options.firstParty);
}

function selectSource(source: ShardManifest, firstParty: boolean): ShardManifest {
  const list = new Map(firstParty ? shards().map((manifest) => [manifest.slug.replace(/^_/u, ''), manifest]) : []);
  list.set(source.slug.replace(/^_/u, ''), source); installShards([...list.values()]);
  game.shard = source; _applyChunkConstants(source); configureLevel(toLevelSpec(source)); return source;
}

/** Admit a built first-party descriptor before the normal session, preserving picker identity and its canonical save instance.
 * A trusted preparation barrier may overlap admission, but precedes every live binding and publication. */
export async function installManifestShardfile(manifest: ShardManifest, providedOptions: ProductOptions, bindings: ShardfileClientBindings, prepared?: () => Promise<unknown>): Promise<ShardManifest> {
  const options = withPageMemory(providedOptions, bindings);
  if (manifest.shardfile === undefined) {
    // Transitional entries bootstrap their native terrain before admitting the world plugin.
    // Read only the receipted header here; never retain an admission or pin its transport to the page owner.
    if (!options.firstParty || manifest.gridShardfile === undefined) return manifest;
    const url = new URL(manifest.gridShardfile, options.base);
    if (url.origin !== new URL(options.base).origin || url.search !== '' || url.hash !== '') throw new Error('Manifest shardfile must be an unqualified same-origin source');
    const source = await readProductDescriptor({ ...options, base: new URL('.', url).href, descriptorPath: url.pathname });
    const { slug: authoredIdentity } = source.identity, expectedIdentity = manifest.slug.replace(/^_/u, '');
    if (authoredIdentity !== expectedIdentity) throw new Error('Manifest and shardfile identities differ');
    if (!isBuildValidatedOutput(source) || source.runtime === null) return manifest;
    const ground = tiledBootstrapGround(manifest.ground, source.props, source.runtime.binds ?? []);
    return ground === manifest.ground ? manifest : selectSource({ ...manifest, ground }, true);
  }
  if (!options.firstParty) throw new Error('Manifest shardfile descriptors require first-party provenance');
  const url = new URL(manifest.shardfile, options.base);
  if (url.origin !== new URL(options.base).origin || url.search !== '' || url.hash !== '') throw new Error('Manifest shardfile must be an unqualified same-origin source');
  const productOptions = { ...options, base: new URL('.', url).href, descriptorPath: url.pathname };
  const source = await readProductDescriptor(productOptions, url);
  const { slug: authoredIdentity } = source.identity, expectedIdentity = manifest.slug.replace(/^_/u, '');
  if (authoredIdentity !== expectedIdentity) throw new Error('Manifest and shardfile identities differ');
  if (source.runtime !== null) throw new Error('Custom runtime requires trusted hybrid composition');
  const sections = outputDescriptor(source)?.sections;
  if (sections !== undefined) prepareClientModuleGroups(source, sections);
  const admitted = await admitProduct(source, productOptions);
  if (prepared !== undefined) await prepared();
  // T7, GO7: on a grid page (Shard select → a data cell, as the template's) a data home is claimed at the regional charge the grid's
  // entry hands off (session.ts); a claim here at the one-shard page's cost made that handoff refuse ("Home residency differs"). A
  // declared page keeps its claim here: session.ts admits none for it.
  const { residency, ...unclaimed } = bindings, gridHome = residency !== undefined && currentPageMode() === 'grid' && !hasDeclaredClientPage(source);
  const client = clientSource(admitted, productOptions, { ...(gridHome ? { ...unclaimed, allocator: residency.allocator } : bindings),
    instance: residency === undefined ? firstPartyInstance(manifest.slug) : bindings.instance });
  const plan = sections?.get('client/plan');
  const sceneAudio = plan !== undefined && parseClientPlan(plan).features.some(row => row.kind === 'audio.scene');
  const { image: _unadmittedImage, ...mapLook } = manifest.minimap ?? {};
  // First-party declared pages keep their authored scalar level presentation and boot inventory.
  // The admitted client owns ground, navigation and all executable stages; no shard loader survives.
  const page: ShardManifest = hasDeclaredClientPage(source) ? { ...manifest,
    boot: compiledPageBoot(manifest.boot, client.boot),
    ground: clientPageGround(source, admitted.assets), spawns: [],
    ...(client.navigation === undefined ? {} : { navigation: client.navigation }),
    ...(client.render === undefined ? {} : { render: client.render }),
    ...(client.load === undefined ? {} : { load: client.load }),
  } : client;
  const installed = { ...page,
    // Explicit scene features retain the counted first-party catalogue.
    ...(sceneAudio && manifest.audio?.preload !== undefined ? { audio: manifest.audio } : {}),
    ...(sceneAudio && page.boot !== undefined && manifest.boot?.audio !== undefined
      ? { boot: { ...page.boot, audio: manifest.boot.audio } } : {}),
    slug: manifest.slug, name: manifest.name, order: manifest.order, status: manifest.status, label: manifest.label,
    // GO7: a grid page whose home is this shard admits its cell through the same descriptor (`gridShardfileProduct`); without it the
    // cell stays "not a shardfile shard" and Shard select's template card never boots. A declared page keeps it by its spread.
    shardfile: manifest.shardfile,
    ...(source.presentation === undefined ? { biome: manifest.biome, blurb: manifest.blurb, card: manifest.card } : {}),
    // The first-party viewer is authored presentation, independent of native page stages.
    ...(manifest.explore === undefined ? {} : { explore: manifest.explore }),
    // Keep the authored map look; image bytes come exclusively from the admitted product (SF66).
    minimap: { ...mapLook, ...client.minimap },
    // and its listed places, the full map's pins (SF66): the admitted source has none
    ...(manifest.pois === undefined ? {} : { pois: manifest.pois }),
  };
  provideManifestAdmission(installed, admitted, productOptions, manifestReader(client));
  return selectSource(installed, true);
}

/** The prebuilt client's HTML supplies data, without a second boot loop or URL switch. */
export async function configuredShardfile(document: Pick<Document, 'getElementById'>, options: ProductOptions): Promise<Shardfile | null> {
  const element = document.getElementById('ws-shardfile');
  if (element === null) return null;
  const text = element.textContent;
  // Reject excessive character counts before creating a UTF-8 copy or parsing the inline source.
  if (text.length > limits.sourceBytes || new TextEncoder().encode(text).length > limits.sourceBytes) throw new Error('Shardfile source exceeds admission cap');
  const input: unknown = JSON.parse(text);
  if (!isOutputIndex(input)) throw new Error('Embedded shardfile requires a format-2 output');
  const source = await readProductInput(input, options);
  return source;
}
