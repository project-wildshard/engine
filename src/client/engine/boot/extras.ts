/**
 * The loading bar's last two jobs (project/archive/2026-09-23-preload-offline.md, the user: "everything should be loaded at the loading bar
 * … No cheating and background loading"): what the title menu, the Explore viewer and the audio used to fetch after
 * "playable" — found by the row-1 audit (headless request log, both shards) — is downloaded, counted and decoded here.
 *
 *  - `bootFiles(def)`       the boot manifest (src/client/engine/boot/manifest.ts) + the profile's selected music/SFX, or its
 *                           complete inventory for background prefetch when no profile is supplied, + every card's thumbnail and hero
 *                           stills (active phones use the viewport orientation; background/desktop keep both) and, on a shard
 *                           with the Explore viewer, its panel art. Bundled files with hashed URLs, sized from
 *                           each shard's discovery document (`shardArt`).
 *  - `extraFetches(files)`  the art and the audio for the prefetch queue (after the shard's own files), in the order they
 *                           are needed: the art, then the selected style + set, then every other style and set.
 *  - `startMenuPreload()`   title art fetched during the bar. On phones only the selected card is decoded and kept in
 *                           memory; the other cards' and the Explore viewer's compressed files remain in the offline
 *                           cache until shown (round 39: decoding Driftwood's ten Explore and compare pictures held
 *                           Jake's phone 13.8 s on this step, one 10.8 s frame). On desktop the Explore panels are
 *                           decoded into <img>s that the viewer's own <img>s reuse; awaited by the 'menu' step.
 *                           Explore and Feedback code loads only on use, with preparation progress (G713/G729).
 *  - `startAudioPreload()`  only selected profile audio downloaded (the worker caches each on its way in),
 *                           the selected music style (title + this shard's slot +
 *                           stings) and sound-effect set decoded on an OfflineAudioContext as their bytes land; awaited by
 *                           the 'audio' step, which closes the `music` and `sfx` byte sources. On Pine Hollow its own
 *                           music (the selected style) and SFX set ride along (src/client/engine/boot/audioFiles.ts), and the set's
 *                           one-shots + barks are decoded here too (PineHollowSfx `decodePineShots`) — nothing of the
 *                           shard's sound is fetched after the bar (E44).
 *  - `startDeferredAudioPreload()`  the same selected counted downloads and offline cache, with selected
 *                           decoding serialized after the loader fades and the world starts (E246 memory A/B).
 */
import { publicBytes, bootPacks } from '../../../shared/engine/boot/tables';
import { audioPackReader } from './audioPack';
import { onOwnerDispose } from '../../../shared/engine/app/ownership';
import { texMode, type TexMode } from './gpuFiles';
import { bootCatalog, type BootLevel } from './catalog';
import { chunkFiles } from './manifest';
import { addBytes, type ChunkFiles } from './bytes';
import { macrotask, type StepProgress } from './plan';
import { audioFiles, musicDir, sfxDir } from './audioFiles';
import { whenPrefetched } from './prefetch';
import { decodeBytes, type SfxBank } from '../audio/preload';
import type { StyleBank } from '../audio/Stems';
import { getMusicStyle, getSfxSet } from '../ui/Settings';
import { TIER } from '../core/tier';
import { NO_AUDIO, type LevelAudioProfile, type LevelAudioBank } from '../audio/levelAudio';
import { bootAudioFiles } from './audioInventory';
import { loadingUnits, waitFor } from '../../../shared/engine/boot/waits';
import { currentLoadingTimeline } from '../../../shared/engine/boot/timeline';


const pathOf = (url: string): string => { try { return new URL(url, location.href).pathname; } catch { return url; } };

/** the shard cards' pictures among the art (the rest is the Explore viewer's) */
const cardArt = new Set<string>();

function artFor(def: BootLevel, background: boolean, menuArt: boolean): { urls: string[]; bytes: Record<string, number> } {
  const urls: string[] = [], bytes: Record<string, number> = {};
  // Other cards retain their authored URLs; the deck requests their pictures
  // when shown. Playing one world does not preload every world's portraits.
  // Rotation keeps those same URLs; only the active preload is narrowed.
  const landscape = typeof innerWidth === 'number' && typeof innerHeight === 'number' && innerWidth >= innerHeight;
  const cards = !menuArt ? [] : background || TIER !== 'phone'
    ? [def.card.thumb, def.card.portrait, def.card.landscape]
    : [def.card.thumb, landscape ? def.card.landscape : def.card.portrait];
  const cardUrls = new Set(cards);
  // Explorer owns its image readiness when opened; only background caching
  // needs its preview bank before the player requests that UI.
  const explore = background ? def.boot?.explore?.art ?? [] : [];
  for (const url of new Set([...cards, ...explore, ...(def.boot?.precache ?? [])])) {
    if (url.startsWith('data:')) continue; // inlined into the bundle: nothing to fetch
    const p = pathOf(url);
    // Shards may keep card / Explore / precache art in their public asset folder instead of importing it.
    const size = bootCatalog().artBytes[url] ?? publicBytes()[p];
    if (size === undefined || Object.hasOwn(bytes, p)) continue;
    urls.push(p); bytes[p] = size;
    if (cardUrls.has(url)) cardArt.add(p);
  }
  return { urls, bytes };
}

/** This shard's declared files; an active profile omits demand-loaded Explorer art. */
const audioPriority = new WeakMap<ChunkFiles, ReadonlySet<string>>();
/** the selected boot audio held back until after control (a phone profile's files outside its `controlFiles`) */
const heldAudio = new WeakMap<ChunkFiles, readonly string[]>();
/** each preload's after-control load of the held-back files */
const lateLoads = new WeakMap<ChunkFiles, () => Promise<AudioBanks> | undefined>();

/** Grid entry omits unused menu cards; explicit precache art remains required. */
export function bootFiles(def: BootLevel, tex: TexMode = texMode(), profile?: LevelAudioProfile, menuArt = true, lateTitleMusic = false): ChunkFiles {
  const art = artFor(def, profile === undefined, menuArt);
  addBytes(art.bytes);
  const inventory = profile?.files() ?? bootAudioFiles(def.boot) ?? audioFiles();
  const boot = profile?.bootFiles(getMusicStyle());
  // G1000 (DL17, root's ruling over I7): the level's audio is downloaded and loaded at full fidelity before control, so
  // the phone's bar reads the whole boot set too (I7 held all but its first seconds back until after control)
  const title = TIER === 'phone' && lateTitleMusic ? new Set(profile?.titleFiles?.(getMusicStyle())) : new Set<string>();
  const selected = boot === undefined ? undefined : new Set(boot.filter(url => !title.has(url)));
  // Omitting a profile retains the complete inventory used by background shard prefetch.
  const audio = selected === undefined ? inventory : {
    music: inventory.music.filter(url => selected.has(url)), sfx: inventory.sfx.filter(url => selected.has(url)),
  };
  const files = { ...chunkFiles(def, tex), art: art.urls, ...audio };
  if (title.size > 0 && boot !== undefined && selected !== undefined) {
    const shipped = new Set([...inventory.music, ...inventory.sfx]);
    heldAudio.set(files, boot.filter(url => shipped.has(url) && !selected.has(url)));
  }
  const priority = profile?.priorityFiles?.();
  if (priority) audioPriority.set(files, new Set(priority));
  return files;
}

/** the boot held back selected audio until after control (I7): the session runs the preload's `later()` */
export function hasLateAudio(files: ChunkFiles): boolean { return (heldAudio.get(files)?.length ?? 0) > 0; }
/** I7, after control: download the held-back boot audio and decode the whole selected set (after the preload's own
 *  decode); undefined when nothing was held back or no preload started for `files` */
export function startLateAudio(files: ChunkFiles): Promise<AudioBanks> | undefined { return lateLoads.get(files)?.(); }

/** the art and the audio for the prefetch queue: the selected style + set (decoded in the bar) ahead of the others (downloaded only) */
export function extraFetches(files: ChunkFiles): string[] {
  const own = audioPriority.get(files);
  const mine = (url: string): boolean => url.startsWith(musicDir(getMusicStyle())) || url.startsWith(sfxDir(getSfxSet())) || own?.has(url) === true;
  const audio = [...files.music, ...files.sfx];
  return [...files.art, ...audio.filter(mine), ...audio.filter((p) => !mine(p))];
}

/** a counter the bar's step reports once it runs (events before the step starts would be dropped by the plan) */
function counter(total: number): { tick: () => void; attach: (p: StepProgress, label: string) => void } {
  let done = 0, sink: ((d: number) => void) | undefined;
  return {
    tick() { done++; sink?.(done); },
    attach(p, label) { sink = (d) => { p.set(d, total, `${d} / ${total} ${label}`); }; sink(done); },
  };
}

/** the decoded images live here for the page's life: the menu's CSS backgrounds and <img>s are served from memory */
const keep: HTMLImageElement[] = [];
/** every card's pictures pointed at their in-memory copies (the title menu reads them when it builds its deck) */
function swapCardArt(blobs: ReadonlyMap<string, string>): void {
  for (const c of bootCatalog().levels) {
    c.card.thumb = blobs.get(pathOf(c.card.thumb)) ?? c.card.thumb;
    c.card.portrait = blobs.get(pathOf(c.card.portrait)) ?? c.card.portrait;
    c.card.landscape = blobs.get(pathOf(c.card.landscape)) ?? c.card.landscape;
  }
}

/** a boot preload in flight: `wait` reports progress into a boot step and resolves with what it loaded */
export interface Preload<T> { wait: (p: StepProgress) => Promise<T> }

/** pictures already in memory (E155: a shard built later in the page, or rebuilt, finds the cards' art decoded) */
const artLoaded = new Set<string>();

export function startMenuPreload(files: ChunkFiles, def: BootLevel): Preload<void> {
  const art = files.art;
  const c = counter(art.length);
  const blobs = new Map<string, string>();
  // The phone page runs one shard at a time. Keep the other cards' and the Explore viewer's bytes in the offline cache,
  // but do not decode them into WebKit's image memory while the selected shard allocates its textures (E244, round 39).
  const activeCardArt = new Set([def.card.thumb, def.card.portrait, def.card.landscape].map(pathOf));
  const images = art.map(async (u) => {
    if (artLoaded.has(u)) { c.tick(); return; }
    artLoaded.add(u);
    await waitFor(`Await artwork ${u}`, whenPrefetched(u));
    if (TIER === 'phone' && !activeCardArt.has(u)) {
      c.tick();
      return;
    }
    try {
      const blob = await waitFor(`Read artwork ${u}`, fetch(u).then(response => response.blob()), 'file'); // the counted download, handed over by the queue
      const card = cardArt.has(u);
      const src = card ? URL.createObjectURL(blob) : u; // Explore's own <img>s use the bundle URL: decoded once here, reused from memory
      if (card) blobs.set(u, src);
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      keep.push(img);
      await waitFor(`Decode artwork ${u}`, img.decode());
    } catch { /* a missing picture: the card shows its colour, as before */ }
    c.tick();
  });
  return {
    async wait(p) {
      c.attach(p, 'pictures');
      await Promise.all(images);
      swapCardArt(blobs);
    },
  };
}

/** audio files this page already read to the end once */
const downloaded = new Set<string>();
/** A decoder that runs one file at a time. decodeStyle and decodeSfxSet both start every file at once; gating their
 *  decoder, not their reads, means WebKit never holds dozens of simultaneous native PCM outputs (E246 memory A/B). */
function serialDecoder(decoded?: (bytes: ArrayBuffer) => void): (bytes: ArrayBuffer) => Promise<AudioBuffer> {
  let tail: Promise<void> = Promise.resolve();
  return (bytes) => {
    const next = tail.then(async () => {
      await macrotask();
      const buffer = await waitFor('Decode selected audio clip', decodeBytes(bytes));
      decoded?.(bytes);
      return buffer;
    });
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

/** a level's decoded audio: its music bank, its SFX bank and its own audio profile's bank */
export interface AudioBanks { music: StyleBank | undefined; sfx: SfxBank; profile?: LevelAudioBank }

/** Count/cache this profile's selected files, then decode its banks at the original boot/deferred boundary. */
export function startDeferredAudioPreload(files: ChunkFiles, def: BootLevel, profile?: LevelAudioProfile): Preload<void> & { readonly style: ReturnType<typeof getMusicStyle>; decode: () => Promise<AudioBanks> } {
  const style = getMusicStyle(), set = getSfxSet();
  // E357 G19: an asset-free level omits audio.preload (ENGINE §15)
  const selected = new Set((profile ?? NO_AUDIO).bootFiles(style));
  const urls = [...new Set([...files.music, ...files.sfx])].filter(url => selected.has(url));
  const c = counter(urls.length);
  const reading = urls.length === 0 ? undefined : currentLoadingTimeline()?.begin('audioFiles');
  const fileProgress = loadingUnits('Selected audio files', urls.length);
  let completedFiles = 0;
  // Keep only the selected compressed bytes until decode. That makes the post-bar decode work offline even if
  // Cache Storage is unavailable; the background shard prefetch retains the complete other-style inventory.
  const selectedBytes = new Map<string, ArrayBuffer>();
  const lifetime = new AbortController();
  onOwnerDispose(() => { lifetime.abort(); selectedBytes.clear(); });
  const downloads = urls.map((url, index) => waitFor(`Read audio ${index + 1} / ${urls.length}`, (async () => {
    try {
      await whenPrefetched(url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      const bytes = await response.arrayBuffer();
      if (selected.has(url)) selectedBytes.set(url, bytes);
      downloaded.add(url);
    } catch { downloaded.delete(url); /* a missing sound keeps its synth fallback */ }
    c.tick();
    fileProgress(++completedFiles, url);
  })(), 'file'));
  // Observe the existing parallel reads without changing their queue or decode
  // boundary. Their row ends with the reads, not when a later waiter attaches.
  void Promise.all(downloads).then(() => { reading?.end(); return undefined; }, () => { reading?.end(); return undefined; });
  let decoding: Promise<AudioBanks> | undefined;
  const decode = (): Promise<AudioBanks> => {
    if (decoding) return decoding;
    decoding = (async () => {
      await Promise.all(downloads);
      const addresses = new WeakMap<ArrayBuffer, string>(), ready = new Set<string>();
      const progress = loadingUnits('Prepared audio clips', urls.length);
      progress(0);
      const oneAtATime = serialDecoder((bytes) => {
        const address = addresses.get(bytes);
        if (address !== undefined) { ready.add(address); progress(ready.size); }
      });
      const read = (url: string): Promise<ArrayBuffer> => {
        const bytes = selectedBytes.get(url);
        if (!bytes) return Promise.reject(new Error(`${url} was not downloaded during the loading bar`));
        const copy = bytes.slice(0); // decodeAudioData detaches its argument
        addresses.set(copy, url);
        return Promise.resolve(copy);
      };
      try {
        const selectedProfile = profile ?? NO_AUDIO;
        // the whole set decodes in the bar on every tier (G1000): a held-back set (late title music) keeps the phone's
        // control decode of what it read
        const bank = await (TIER === 'phone' && hasLateAudio(files) ? selectedProfile.controlDecode ?? selectedProfile.decode : selectedProfile.decode)(style, read, oneAtATime);
        return { music: undefined, sfx: { set, credit: undefined, loops: new Map(), shots: new Map() }, profile: bank };
      } finally { if (!hasLateAudio(files)) selectedBytes.clear(); }
    })();
    return decoding;
  };
  // I7: after control, the boot files the bar held back download (the worker caches them) and the whole
  // selected set decodes again, one file at a time; the banks keep the slots already playing (Music.useBank).
  let lateDecoding: Promise<AudioBanks> | undefined;
  lateLoads.set(files, () => {
    const rest = heldAudio.get(files);
    if (rest === undefined || rest.length === 0) return undefined;
    lateDecoding ??= (async () => {
      await decode().catch(() => undefined);
      const fetched = new Set<string>(), allowed = new Set([...urls, ...rest]);
      const packed = audioPackReader(bootPacks()[`${def.slug}-audio-${style}`]?.['phone'], new Set(rest), fetch, lifetime.signal);
      const read = async (url: string): Promise<ArrayBuffer> => {
        if (!allowed.has(url)) throw new Error(`${url} is not a shipped boot audio file`);
        const retained = selectedBytes.get(url);
        const bytes = retained === undefined ? await packed.read(url) : retained.slice(0);
        fetched.add(url);
        return bytes;
      };
      try {
        const bank = await (profile ?? NO_AUDIO).decode(style, read, serialDecoder());
        for (const url of fetched) downloaded.add(url);
        return { music: undefined, sfx: { set, credit: undefined, loops: new Map(), shots: new Map() }, profile: bank };
      } finally { selectedBytes.clear(); packed.release(); }
    })();
    return lateDecoding;
  });
  return {
    style,
    async wait(p) { c.attach(p, 'audio files'); await Promise.all(downloads); },
    decode,
  };
}

export function startAudioPreload(files: ChunkFiles, def: BootLevel, profile?: LevelAudioProfile): Preload<AudioBanks> {
  const preload = startDeferredAudioPreload(files, def, profile);
  return { wait: async (p) => { await preload.wait(p); return preload.decode(); } };
}
