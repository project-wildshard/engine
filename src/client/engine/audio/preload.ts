import { publicBytes, sfxManifests } from '../../../shared/engine/boot/tables';
import { resourceScope } from '../../../shared/engine/app/resources';
// src/client/engine/audio/preload.ts — audio decoded at the loading bar, not after it (project/archive/2026-09-23-preload-offline.md rows 3–4).
//
//   decodeBytes(bytes)                 → AudioBuffer, decoded on one shared OfflineAudioContext at the files' rate (48 kHz)
//   cachedBytes(url)                   → the file's bytes from Cache Storage (the service worker stored it while the bar
//                                        downloaded it), else a plain fetch (no worker: dev, ?sw=0)
//   decodeSfxSet(set, bed, read)       → an SfxBank: sfx.json's beds (this shard's + underwater), hums, one-shots
//   trackBusy('music' | 'sfx', work)   → work, flagging the menu's picker busy only if it runs past BUSY_MS
//   onAudioBusy(fn)                    → the picker's spinner (src/client/engine/ui/Menu.ts)
//
// No AudioContext before the first gesture (218e19a: creating one is a ~150 ms main-thread task on the phone, and iOS only
// unlocks a context made inside a gesture): an OfflineAudioContext never opens an audio device, and its decodeAudioData is
// the same decoder. An AudioBuffer belongs to no context — "An AudioBuffer may be used by one or more AudioContexts, and can
// be shared between an OfflineAudioContext and an AudioContext" (W3C Web Audio API 1.1, §AudioBuffer); WebKit's
// AudioBufferSourceNode takes any buffer and plays it at buffer.sampleRate / context.sampleRate (AudioBufferSourceNode.cpp),
// so a 44.1 kHz live context still plays these 48 kHz buffers at pitch. The context is made at 48 kHz because every file is
// 48 kHz AAC: decodeAudioData resamples to its context's rate, and at the files' own rate it resamples nothing.
import type { AmbientBed, LoopName, SampleLoop } from './Audio';
import { sfxDir } from '../boot/audioFiles';
import { currentOwner, onOwnerDispose } from '../../../shared/engine/app/ownership';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { compactLoopWindow } from './loopWindow';

export const DECODE_RATE = 48000;
let offline: OfflineAudioContext | undefined;
function decodeContext(): OfflineAudioContext {
  offline ??= new OfflineAudioContext(2, 1, DECODE_RATE); // the 3-argument form: Safari's constructor
  return offline;
}
// Exact compressed content, independent of URL or boot/runtime decoder wrappers. Completed entries are weak:
// retirement of the last bank/deck releases its PCM, and a later visit decodes again. Bound the metadata too.
const decoded = new Map<string, WeakRef<AudioBuffer>>();
const decoding = new Map<string, Promise<AudioBuffer>>();
const decodedKeys = new WeakMap<AudioBuffer, string>();
const compactedLoops = new Map<string, { buffer: WeakRef<AudioBuffer>; loopStart: number; loopEnd: number }>();
const DECODE_ENTRIES = 256;
/** SF64: the file each fetched recording came from, so its decoded PCM is charged to a file instead of a hash. Weak: the
 *  bytes are detached by the decode and the entry goes with them. */
const sources = new WeakMap<ArrayBuffer, string>();
/** Scope names that say only "the running level", not who asked: a decode under one is charged to its file's folder. */
const GENERIC_OWNERS: ReadonlySet<string> = new Set(['level', 'engine/audio']);
function audioLabel(owner: string, url: string | undefined): { owner: string; asset: string | undefined } {
  if (url === undefined) return { owner, asset: undefined };
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/iu, '').split(/[?#]/u)[0] ?? url, asset = `audio${path.startsWith('/') ? '' : '/'}${path}`;
  const folder = path.slice(0, Math.max(0, path.lastIndexOf('/'))).replace(/^\//u, '');
  return { owner: GENERIC_OWNERS.has(owner) && folder.length > 0 ? `audio:${folder}` : owner, asset };
}
/** Decode at 48 kHz, sharing identical live recordings without retaining retired PCM (the bytes are detached on decode). */
export async function decodeBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const label = audioLabel(currentOwner()?.name ?? 'engine/audio', sources.get(bytes));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const key = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  const live = decoded.get(key)?.deref();
  if (live) return live;
  const pending = decoding.get(key);
  if (pending) return pending;
  const work = decodeContext().decodeAudioData(bytes);
  decoding.set(key, work);
  try {
    const buffer = observeAudioMemory(await work, { owner: label.owner, asset: label.asset ?? `audio/sha256:${key}` });
    decodedKeys.set(buffer, key);
    decoded.delete(key); decoded.set(key, new WeakRef(buffer));
    while (decoded.size > DECODE_ENTRIES) {
      const first = decoded.keys().next().value;
      if (first === undefined) break;
      decoded.delete(first);
    }
    return buffer;
  } finally { if (decoding.get(key) === work) decoding.delete(key); }
}

/** Loop-only PCM keeps its authored samples and interpolation guards, not unused intro/outro.
 * A separate weak cache shares compact windows by verified encoded content and bounds; the full-file
 * decoder cache stays untouched so a later one-shot still receives the complete recording.
 */
export function compactSampleLoop(buffer: AudioBuffer, bounds: { readonly loopStart: number; readonly loopEnd: number }, url: string): { buffer: AudioBuffer; loopStart: number; loopEnd: number } {
  if (typeof AudioBuffer !== 'function') return { buffer, ...bounds };
  const digest = decodedKeys.get(buffer), key = digest === undefined ? undefined : `${digest}:${buffer.sampleRate}:${buffer.numberOfChannels}:${buffer.length}:${bounds.loopStart}:${bounds.loopEnd}`;
  const cached = key === undefined ? undefined : compactedLoops.get(key), live = cached?.buffer.deref();
  if (live !== undefined && cached !== undefined) return { buffer: live, loopStart: cached.loopStart, loopEnd: cached.loopEnd };
  const packed = compactLoopWindow(buffer, bounds, (length, numberOfChannels, sampleRate) => new AudioBuffer({ length, numberOfChannels, sampleRate }));
  if (packed.buffer === buffer) return packed;
  const label = audioLabel(currentOwner()?.name ?? 'engine/audio', url);
  observeAudioMemory(packed.buffer, { owner: label.owner, asset: label.asset ?? url });
  if (key !== undefined) {
    compactedLoops.delete(key); compactedLoops.set(key, { buffer: new WeakRef(packed.buffer), loopStart: packed.loopStart, loopEnd: packed.loopEnd });
    while (compactedLoops.size > DECODE_ENTRIES) {
      const first = compactedLoops.keys().next().value; if (first === undefined) break; compactedLoops.delete(first);
    }
  }
  return packed;
}

/** the bytes of `url` from the offline cache the bar filled — a style / set switch never touches the network */
export async function cachedBytes(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const hit = await caches.match(url, { ignoreVary: true });
      if (hit) { const bytes = await hit.arrayBuffer(); sources.set(bytes, url); return bytes; }
    } catch { /* storage blocked (private mode): fetch below */ }
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  const bytes = await r.arrayBuffer(); sources.set(bytes, url);
  return bytes;
}

// ─────────────── the menu's "busy" flag (a style / set decoding from the cache) ───────────────
export type AudioKind = 'music' | 'sfx';
const BUSY_MS = 300;
const busyFns = new Set<(kind: AudioKind, on: boolean) => void>();
export function onAudioBusy(fn: (kind: AudioKind, on: boolean) => void): () => void { busyFns.add(fn); const off = (): void => { busyFns.delete(fn); }; onOwnerDispose(off); return off; } // a resident shard's (its menu): gone with it
/** run `work`; the picker shows a spinner only if it is still running after BUSY_MS */
export function trackBusy<T>(kind: AudioKind, work: Promise<T>): Promise<T> {
  const scope = resourceScope();
  let shown = false;
  const timer = scope.timeout(BUSY_MS, () => { shown = true; busyFns.forEach((fn) => fn(kind, true)); });
  const settle = (): void => { scope.cancelTimer(timer); if (shown) busyFns.forEach((fn) => fn(kind, false)); };
  void work.finally(settle).catch(() => undefined); // the caller handles the rejection; this copy only clears the flag
  return work;
}

// ─────────────── sound-effect sets (sfx.json) ───────────────
/** a decoded sound-effect set: what Audio.ts plays in place of the synth versions */
export interface SfxBank { set: string; credit: string | undefined; loops: Map<LoopName, SampleLoop>; shots: Map<string, { bufs: AudioBuffer[]; gain: number }> }
/** a sample's level before sfx.json's own `gain` (beds sit under the synth bed's ~0.1 winds; hums near the synth hum's 0.11) */
const LOOP_GAIN: Record<LoopName, number> = {
  underwater: 0.5, pickup: 0.35, shrine: 0.6,
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Sample selection belongs to the level, independently of its bed id. */
export interface SfxDecodePolicy {
  omitLoops?: readonly string[]; omitShots?: readonly string[]; loopGains?: Readonly<Record<string, number>>;
}

/** the files `decodeSfxSet(set, bed)` reads (URLs), so the loading bar can tell them from the files it only downloads */
export function sfxFiles(set: string, bed: AmbientBed, policy: SfxDecodePolicy = {}): string[] { return [...new Set(sfxJobs(set, bed, policy).map((j) => j.url))]; }
/** the selected bed's file of `set` (empty when the set has none): the one sample the first seconds of play loop */
export function sfxBedFiles(set: string, bed: AmbientBed, policy: SfxDecodePolicy = {}): string[] { return sfxJobs(set, bed, policy).filter((j) => j.bed).map((j) => j.url); }

interface Job { url: string; bed?: true; apply: (buf: AudioBuffer, bank: SfxBank) => void }
function sfxJobs(set: string, bed: AmbientBed, policy: SfxDecodePolicy): Job[] {
  const j = sfxManifests()[set];
  if (!isObj(j)) return [];
  const dir = sfxDir(set), jobs: Job[] = [];
  const url = (f: unknown): string | undefined => (typeof f === 'string' && !f.includes('..') && `${dir}${f}` in publicBytes() ? `${dir}${f}` : undefined);
  const loop = (name: LoopName, v: unknown): void => {
    if (policy.omitLoops?.includes(name) || !isObj(v)) return;
    const u = url(v['file']);
    if (u === undefined) return;
    jobs.push({ url: u, ...(name === bed ? { bed: true } : {}), apply: (buffer, bank) => {
      const loopEnd = Math.min(buffer.duration, num(v['loopEnd'], buffer.duration)), loopStart = Math.max(0, Math.min(loopEnd - 0.05, num(v['loopStart'], 0)));
      const packed = compactSampleLoop(buffer, { loopStart, loopEnd }, u);
      bank.loops.set(name, { ...packed, gain: (policy.loopGains?.[name] ?? LOOP_GAIN[name] ?? 1) * num(v['gain'], 1) });
    } });
  };
  const beds = isObj(j['beds']) ? j['beds'] : {}, hums = isObj(j['hums']) ? j['hums'] : {}, shots = isObj(j['oneshots']) ? j['oneshots'] : {};
  // The selected bed first, then the common loops, in the existing decode order.
  loop(bed, beds[bed]); loop('underwater', beds['underwater']); loop('pickup', hums['pickup']); loop('shrine', hums['shrine']);
  for (const [family, v] of Object.entries(shots)) {
    if (policy.omitShots?.includes(family)) continue;
    const files = Array.isArray(v) ? v : isObj(v) && Array.isArray(v['files']) ? v['files'] : [];
    const gain = isObj(v) ? num(v['gain'], 1) : 1;
    for (const f of files) {
      const u = url(f);
      if (u !== undefined) jobs.push({ url: u, apply: (buf, bank) => { const s = bank.shots.get(family); if (s) s.bufs.push(buf); else bank.shots.set(family, { bufs: [buf], gain }); } });
    }
  }
  return jobs;
}

/**
 * Decode `set` — every file its sfx.json lists that this shard can play — from `read` (the boot's counted fetch at the bar;
 * `cachedBytes` for a switch in the menu). A file that fails keeps its synth version; the set as a whole never rejects.
 */
export async function decodeSfxSet(set: string, bed: AmbientBed, read: (url: string) => Promise<ArrayBuffer>, onFile?: () => void, decode: (bytes: ArrayBuffer) => Promise<AudioBuffer> = decodeBytes, policy: SfxDecodePolicy = {}): Promise<SfxBank> {
  const j = sfxManifests()[set];
  const bank: SfxBank = { set, credit: isObj(j) && typeof j['credit'] === 'string' ? j['credit'] : undefined, loops: new Map(), shots: new Map() };
  await Promise.all(sfxJobs(set, bed, policy).map(async (job) => {
    try { job.apply(await decode(await read(job.url)), bank); }
    catch (e) { console.info(`[sfx] ${job.url}: ${e instanceof Error ? e.message : String(e)} — synth kept`); }
    onFile?.();
  }));
  return bank;
}
