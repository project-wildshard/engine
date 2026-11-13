import {readModuleGroups} from '@wildshard/engine/boot/download';
import {isDev} from '@wildshard/engine/core/devMode';

import type { MusicStyle } from '@wildshard/engine/audio/bootAudio';
import type { FieldModelsContext, ShardManifest } from '../shard/manifest';

import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { checkProductClientModules } from '../shardfile/clientModules';

import { imagesFirstPlayingBytes } from '../grid/runtimeCost';
import { consumeTravelHandoff } from '../travel/travel';
import { type StepRunner, createBootPlan, type Plan } from '@wildshard/engine/boot/plan';
import { prepareShardAssets, type LoadStage } from '../shard/load';
import type { SessionContext, StagedBoot, SessionState, KitPorts } from './context';
import { currentOwner } from '@wildshard/engine/app/ownership';
import { app } from '@wildshard/engine/app/runtime';
import { declareTotals, installByteCounter } from '@wildshard/engine/boot/bytes';
import { bootFiles, extraFetches, startAudioPreload, startDeferredAudioPreload, startMenuPreload, useDownloadAudio, type Preload, type AudioBanks } from '@wildshard/engine/boot/extras';
import { spawnHeldBytes, spawnListed } from '../boot/spawnDownload';
import { registerGpuFiles, setTexturePolicy } from '@wildshard/engine/boot/gpuFiles';
import { demandPack, packFor, streamPack } from '@wildshard/engine/boot/pack';
import { bootFetches, prefetch, prefetchAfter, whenPrefetched } from '@wildshard/engine/boot/prefetch';
import { useShardSteps } from '@wildshard/engine/boot/steps';
import { startViewmodelTextures } from '@wildshard/engine/combat/view/ranged';
import { TIER } from '@wildshard/engine/core/tier';
import { beginLoading, type Loading } from '@wildshard/engine/ui/Loading';
import { gridPrefetchStatus } from '../grid/prefetch';
import { currentPageMode } from '../../../shared/game/grid/pageMode';
import { NO_AUDIO, type LevelAudioProfile } from '@wildshard/engine/audio/levelAudio';

async function buildData(ctx: SessionContext) : Promise<{ loading: Loading; audioProfile: LevelAudioProfile | undefined; files: Readonly<Record<"sky" | "baked" | "terrain" | "trees" | "physics" | "cabins" | "props" | "art" | "music" | "sfx", readonly string[]>>; plan: Plan<"audio" | "sky" | "terrain" | "physics" | "cabins" | "props" | "renderer" | "cards" | "forest" | "edge" | "grass" | "animals" | "weapon" | "assembly" | "menu" | "shaders" | "firstFrame">; step: StepRunner; menuLoad: Preload<void> | null; audioLoad: Preload<AudioBanks> | null; deferredAudio: (Preload<void> & { readonly style: MusicStyle; decode: () => Promise<AudioBanks>; }) | null; fieldModels: Promise<(ctx: FieldModelsContext) => void> | null; manifest: ShardManifest; slug: string; stage: LoadStage; boot: StagedBoot; session: SessionState; kit: KitPorts; product: ShardProduct; }> {
  const { manifest, stage, boot, session } = ctx;

  // level.data consumes the per-tab intent before any expensive build can fail.
  boot.handoff = consumeTravelHandoff(manifest.slug);
  if (boot.handoff !== null) session.arrival = { slug: boot.handoff.to, mode: boot.handoff.mode };
  setTexturePolicy(manifest.tiers?.[TIER]?.textures, manifest.slug, imagesFirstPlayingBytes(manifest.runtimeCost));
  checkProductClientModules(ctx.product);
  if (isDev() && session.arrival?.mode === 'arena') readModuleGroups(['practice.models']);

  const loading = beginLoading({ id: manifest.slug, name: manifest.name, trace: manifest.boot?.phone?.trace === true });
  loading.setPrefetchSource(gridPrefetchStatus);
  loading.endAdmission();
  app.setState('loading');
  // The boot plan: DOWNLOAD = bytes read / bytes declared, SETUP = weighted steps (src/client/engine/boot/plan.ts).
  // Declared bytes come from the chunk's file list; every /assets fetch is counted on its way in.
  loading.waiting('Preparing texture formats');
  await stage('ktx2', () => prepareShardAssets(manifest, registerGpuFiles));
  loading.waiting('Preparing audio catalogue');
  const audioProfile = await stage('audio.preload', () => manifest.audio?.preload?.());
  // G1000 (DL17, root's ruling over I7): a direct play no longer holds its title music past control: the whole score is
  // downloaded and decoded in the bar (sp-x9: a held title kept the phone on its control decode, island tension after it)
  const files = bootFiles(manifest, undefined, audioProfile ?? NO_AUDIO, currentPageMode() !== 'grid'); // Grid never opens the menu card bank.
  useShardSteps(manifest.boot?.steps, manifest.boot?.bytes); // the shard's own loading nouns + weights (src/shared/engine/boot/steps.ts)
  const plan = createBootPlan((view) => { loading.paint(view); }, { totals: declareTotals(files) });
  installByteCounter(plan, files);
  // a boot that throws shows WHY: the loading panel's foot line + the uncaught-exception modal (src/client/engine/ui/ErrorModal.ts)
  (currentOwner() ?? app.engineScope).listen(window, 'unhandledrejection', (e) => plan.fail(`BOOT FAILED · ${String((e.reason as { message?: string } | null | undefined)?.message ?? e.reason)}`.slice(0, 300)));
  (currentOwner() ?? app.engineScope).listen(window, 'error', (e) => plan.fail(`BOOT FAILED · ${e.message} @ ${e.filename.split('/').pop()}:${e.lineno}`.slice(0, 300)));
  const step: StepRunner = (key, work) => stage(key, () => plan.step(key, work).then((p) => p.value));
  boot.worldHook = manifest.boot?.stagedWorld === true ? (work) => work() : (work) => step('props', (p) => { boot.progress = p; return work(); });
  // let the service worker take control first (≤ 2.5 s, never fatal) so the first visit's bytes are cached (a shard built
  // later in the page finds it long settled)
  await window.__ws_sw?.ready;
  // this shard's files in flight now, in step order; each step builds as its files land — as one pack when the build has
  // one (src/client/engine/boot/pack.ts), else file by file (src/client/engine/boot/prefetch.ts); anything the pack lacks still goes file by file
  // I2: a tile page reads its actual spawn/ring through scoped loaders.
  // Its predecessor's pack can contain an entire unused world; keep declared
  // direct URLs available, but never start that speculative whole inventory.
  // S3: the desktop too: its list's parts are its one route. Frozen legacy and untiled boots retain their pack path.
  const demandWorld = ctx.product.has('client/plan') && ctx.product.shardfile.tiles.length > 0;
  const eagerWorld = !demandWorld;
  if (demandWorld) { const declaredPack = packFor(manifest); if (declaredPack !== null) demandPack(declaredPack, currentOwner() ?? app.engineScope); }
  const pack = eagerWorld ? packFor(manifest) : null;
  const packed = new Set(pack ? pack.files.map(([p]) => p) : []);
  const packStreamed = pack ? streamPack(pack, plan, files) : Promise.resolve();
  const worldFetches = eagerWorld ? bootFetches(manifest, files).filter((p) => !packed.has(p)) : [];
  prefetch(worldFetches);
  // Then title art and selected profile audio, after the pack so they do not split the pipe with world files.
  // Other styles remain with the worker's background prefetch inventory.
  // A level may hold extras behind its complete world file queue.
  const extrasBarrier = manifest.boot?.barrier === true
    ? Promise.all([packStreamed, ...worldFetches.map(whenPrefetched)]) : packStreamed;
  // AUDIO AU2: the audio the spawn download lists is read from its copy; neither the queue nor LOAD fetches it again. LOAD
  // never demands it ahead of the world's files, and its music and sfx byte sources close with the `audio` step, as before.
  // The same page-wide pair is lent again by each build (the download's listed files are the page's, DL25).
  useDownloadAudio({ listed: spawnListed, read: url => spawnHeldBytes(url, false) });
  prefetchAfter(extraFetches(files), extrasBarrier);
  // High-peak builds may defer extras decoding until their later loading steps.
  const deferExtras = manifest.boot?.phone?.deferExtras === true && TIER === 'phone';
  // The grid never shows the title deck: its cards keep their URLs (decoded if a menu ever opens) and the Explore
  // controls load when opened, so a grid entry does not decode every card's art (round 40: the phone froze 10-14 s)
  const menuLoad = deferExtras || currentPageMode() === 'grid' ? null : startMenuPreload(files, manifest);
  const audioLoad = deferExtras ? null : startAudioPreload(files, manifest, audioProfile);
  const deferredAudio = deferExtras ? startDeferredAudioPreload(files, manifest, audioProfile) : null;
  void startViewmodelTextures(manifest.boot?.viewmodelSets ?? false); // the crossbow's + rifle's textures, drawn in a worker while the world builds
  const fieldModels = manifest.fieldModels?.() ?? null;
  return { ...ctx, loading, audioProfile, files, plan, step, menuLoad, audioLoad, deferredAudio, fieldModels };
}

export const dataStage: typeof buildData = buildData;
