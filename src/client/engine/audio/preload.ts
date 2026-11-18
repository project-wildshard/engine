import { sfxManifests } from '../../../shared/engine/boot/tables';
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
import { sfxEntries, type SfxDecodePolicy } from '../../../shared/engine/audio/bootAudio';
import { currentOwner, onOwnerDispose } from '../../../shared/engine/app/ownership';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { compactLoopWindow } from './loopWindow';
import { TIER } from '../core/tier';
import type { AudioDecode } from './SetScore';
import type { SampleClip } from './Cues';

export const DECODE_RATE = 48000;
const PHONE_SAMPLE_RATE = 24000;
let offline: OfflineAudioContext | undefined, phoneEffects: OfflineAudioContext | undefined, phoneBeds: OfflineAudioContext | undefined;
function decodeContext(purpose: Parameters<AudioDecode>[1]): OfflineAudioContext {
  // The three-argument form is supported by Safari.
  if (purpose === 'effect') {
    phoneEffects ??= new OfflineAudioContext(1, 1, PHONE_SAMPLE_RATE);
    return phoneEffects;
  }
  if (purpose === 'bed') {
    phoneBeds ??= new OfflineAudioContext(2, 1, PHONE_SAMPLE_RATE);
    return phoneBeds;
  }
  offline ??= new OfflineAudioContext(2, 1, DECODE_RATE);
  return offline;
}
function monoEffect(source: AudioBuffer): AudioBuffer {
  if (source.numberOfChannels === 1) return source;
  const buffer = new AudioBuffer({ length: source.length, numberOfChannels: 1, sampleRate: source.sampleRate });
  const output = buffer.getChannelData(0);
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel);
    for (let frame = 0; frame < input.length; frame++) output[frame] = (output[frame] ?? 0) + (input[frame] ?? 0) / source.numberOfChannels;
  }
  return buffer;
}
// Exact compressed content, independent of URL or boot/runtime decoder wrappers. Completed entries are weak:
// retirement of the last bank/deck releases its PCM, and a later visit decodes again. Bound the metadata too.
const decoded = new Map<string, WeakRef<AudioBuffer>>();
const decoding = new Map<string, Promise<AudioBuffer>>();
const decodedKeys = new WeakMap<AudioBuffer, string>();
const packedEffects = new Map<string, WeakRef<SampleClip>>();
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
/** Share live recordings within the same output format without retaining retired PCM. */
export const decodeBytes: AudioDecode = async (bytes, purpose) => {
  const phonePurpose = TIER === 'phone' ? purpose : undefined;
  const label = audioLabel(currentOwner()?.name ?? 'engine/audio', sources.get(bytes));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  const key = phonePurpose === undefined ? hash : `${phonePurpose}24:${hash}`;
  const live = decoded.get(key)?.deref();
  if (live) return live;
  const pending = decoding.get(key);
  if (pending) return pending;
  const decodedAudio = decodeContext(phonePurpose).decodeAudioData(bytes);
  const work = phonePurpose === 'effect' ? decodedAudio.then(monoEffect) : decodedAudio;
  decoding.set(key, work);
  try {
    const buffer = observeAudioMemory(await work, { owner: label.owner, asset: label.asset ?? `audio/sha256:${hash}` });
    decodedKeys.set(buffer, key);
    decoded.delete(key); decoded.set(key, new WeakRef(buffer));
    while (decoded.size > DECODE_ENTRIES) {
      const first = decoded.keys().next().value;
      if (first === undefined) break;
      decoded.delete(first);
    }
    return buffer;
  } finally { if (decoding.get(key) === work) decoding.delete(key); }
};

export async function sampleClip(buffer: AudioBuffer, gain: number, url: string): Promise<SampleClip> {
  const clip = { buffer, offset: 0, duration: buffer.duration, gain };
  if (TIER !== 'phone' || buffer.sampleRate !== PHONE_SAMPLE_RATE || buffer.numberOfChannels !== 1) return clip;
  const { packMonoCue, cueGain } = await import('./packedCues');
  const key = decodedKeys.get(buffer), cached = key === undefined ? undefined : packedEffects.get(key)?.deref();
  if (cached) return cueGain(cached, gain);
  const { owner, asset } = audioLabel(currentOwner()?.name ?? 'engine/audio', url);
  const packed = packMonoCue(clip, { owner, asset: asset ?? url });
  if (key !== undefined) {
    packedEffects.delete(key);
    packedEffects.set(key, new WeakRef(packed));
    while (packedEffects.size > DECODE_ENTRIES) {
      const first = packedEffects.keys().next().value; if (first === undefined) break;
      packedEffects.delete(first);
    }
  }
  return packed;
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
export interface SfxBank { set: string; credit: string | undefined; loops: Map<LoopName, SampleLoop>; shots: Map<string, SampleClip[]> }
/** a sample's level before sfx.json's own `gain` (beds sit under the synth bed's ~0.1 winds; hums near the synth hum's 0.11) */
const LOOP_GAIN: Record<LoopName, number> = {
  underwater: 0.5, pickup: 0.35, shrine: 0.6,
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Decode `set` — every file its sfx.json lists that this shard can play — from `read` (the boot's counted fetch at the bar;
 * `cachedBytes` for a switch in the menu). A file that fails keeps its synth version; the set as a whole never rejects.
 */
export async function decodeSfxSet(set: string, bed: AmbientBed, read: (url: string) => Promise<ArrayBuffer>, onFile?: () => void, decode: AudioDecode = decodeBytes, policy: SfxDecodePolicy = {}): Promise<SfxBank> {
  const j = sfxManifests()[set];
  const bank: SfxBank = { set, credit: isObj(j) && typeof j['credit'] === 'string' ? j['credit'] : undefined, loops: new Map(), shots: new Map() };
  await Promise.all(sfxEntries(set, bed, policy).map(async entry => {
    const { url } = entry;
    try {
      const bytes = await read(url);
      if ('loop' in entry) {
        const { loop: name, row } = entry;
        const gain = (policy.loopGains?.[name] ?? LOOP_GAIN[name] ?? 1) * num(row['gain'], 1);
        bank.loops.set(name, await decodeSampleLoop(bytes, row, url, gain, decode, undefined, entry.bed === true || name === 'underwater'));
      } else {
        const clip = await sampleClip(await decode(bytes, 'effect'), entry.gain, url);
        const familyClips = bank.shots.get(entry.family);
        if (familyClips) familyClips.push(clip); else bank.shots.set(entry.family, [clip]);
      }
    }
    catch (e) { console.info(`[sfx] ${url}: ${e instanceof Error ? e.message : String(e)} — synth kept`); }
    onFile?.();
  }));
  return bank;
}

/** Keep authored bed cuts as compressed recordings whenever the phone can
 * play them on its native sample clock. Hums retain short synchronous PCM. */
export async function decodeSampleLoop(bytes: ArrayBuffer, row: Record<string, unknown>, url: string, gain: number,
  decode: AudioDecode, purpose: 'bed' | undefined, stream: boolean): Promise<SampleLoop> {
  if (stream && TIER === 'phone') {
    const { streamedBed } = await import('./streamedBed');
    const sampled = await streamedBed({ bytes, url, start: num(row['loopStart'], 0), end: num(row['loopEnd'], 0), gain,
      halfRate: purpose === 'bed', decode: data => decodeBytes(data, purpose) });
    if (sampled !== undefined) return sampled;
  }
  const buffer = await decode(bytes, purpose);
  const loopEnd = Math.min(buffer.duration, num(row['loopEnd'], buffer.duration));
  const loopStart = Math.max(0, Math.min(loopEnd - 0.05, num(row['loopStart'], 0)));
  return { ...compactSampleLoop(buffer, { loopStart, loopEnd }, url), gain };
}
