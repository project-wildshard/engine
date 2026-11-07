/**
 * The boot pack (scripts/bake-packs.mjs; project/archive/2026-09-22-load-perf.md "requests, first launch ≤ 20"): this shard's boot
 * files for this tier, concatenated in step order into a few content-addressed parts (E160: one file per pack meant any
 * edit re-downloaded all of it). `streamPack` fetches the parts one after another and cuts each into its files as the
 * bytes land; the first file is ready after its own bytes, not after the pack's.
 *
 * Nothing downstream changes: the steps still `fetch()` their files by name (fetchImage, three's FileLoader /
 * ImageBitmapLoader, the baked-terrain reader), and a GET of a packed path is answered with that file's bytes from
 * the pack — waiting for them when they have not landed yet. Loaders that bypass fetch (Safari's GLTFLoader loads
 * textures through <img>) are handed a blob: URL through the loading manager once the file is in; the pack puts glTF
 * textures ahead of their .gltf (and never cuts a part between them) so that is always the case by the time the model asks.
 *
 * The DOWNLOAD track is credited here as the pack streams (per file, to the source that declared it), since the
 * byte counter's fetch tee never sees the packed paths. A part that fails to arrive (404 on a stale deploy, offline
 * with an empty cache) is not fatal: every packed path still waiting falls back to its own request.
 *
 * A part fetched before a worker controls the page publishes its complete native
 * response into the same immutable URL cache. No claim deadline or worker RPC
 * stands between its completion and a durable warm/offline read.
 *
 * Headless per-file record runs exercise the same unavailable-part fallback with a fetch adapter.

 */
import { bootPacks, type PackDef, type PackPart } from '../../../shared/engine/boot/tables';
import { DefaultLoadingManager } from 'three';
import type { Plan } from './plan';
import type { BootStep, ByteKey } from '../../../shared/engine/boot/steps';
import { tierUrl, versionedUrl, type ChunkFiles } from './bytes';
import { TIER } from '../core/tier';
import type { Scope } from '../../../shared/engine/app/scope';
import { publishBootResponse } from './bootCache';
import { installTexturePackReads } from './texturePack';

const pathOf = (url: string): string => { try { return new URL(url, location.href).pathname; } catch { return url; } };

/** This level's shipping pack for the active tier, if its build has one. */
export function packFor(def: { slug: string }): PackDef | null {
  return bootPacks()[def.slug]?.[TIER] ?? null;
}

/** Tiled phone boots borrow existing pack textures only when adjacent files are
 * demanded together. No whole-world prefetch or settled pack backing. */
export function demandPack(pack: PackDef, owner: Scope): void { installTexturePackReads(pack, owner); }

/**
 * The parts of `pack` a boot declaring `files` reads: every part that carries one of them. The pack is baked for the
 * default path (images); a KTX2 boot (E157) declares the KTX2 stand-ins instead, and a part that holds only the images
 * they replace is not streamed (nor background-downloaded, src/client/engine/boot/shardPrefetch.ts).
 */
export function bootParts(pack: PackDef, files: ChunkFiles): PackDef {
  const declared = new Set(Object.values(files).flat());
  const parts = pack.parts.filter((part) => part.files.some(([p]) => declared.has(p)));
  return parts.length === pack.parts.length ? pack : { parts, bytes: parts.reduce((n, part) => n + part.bytes, 0), files: parts.flatMap((part) => part.files) };
}

/** the next part starts downloading once this share of the current one has streamed: no idle round trip between parts */
const OVERLAP = 0.75;

interface Slot { type: string; size: number; blob: Promise<Blob>; resolve: (b: Blob) => void; reject: (e: unknown) => void; url: string | null }

/** A service worker controls the page (sw.ts): a fetch now passes through its cache. */
const controlled = (): boolean => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;

/**
 * The running build's slots. A page builds a shard more than once (E155: the shard host builds each shard in the page,
 * and rebuilds an evicted one), so the fetch layer and the URL modifier are installed once and answer from the latest
 * pack; an earlier build's slots (their blobs and blob: URLs) are let go with it.
 */
let current: Map<string, Slot> | null = null;
let layered = false;
function installPackLayer(fetchNow: typeof window.fetch): void {
  if (layered) return;
  layered = true;
  window.fetch = (input, init) => {
    const req = input instanceof Request ? input : null;
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const p = pathOf(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const slot = method === 'GET' ? current?.get(p) : undefined;
    if (slot === undefined) return fetchNow(input, init);
    return slot.blob.then(
      (blob) => new Response(blob, { status: 200, headers: { 'content-type': slot.type, 'content-length': String(slot.size) } }),
      () => fetchNow(input, init),
    );
  };
  // <img>-based loaders (Safari's GLTFLoader textures): a packed file that has landed is loaded from memory
  DefaultLoadingManager.setURLModifier((url) => {
    const u = tierUrl(url);
    return current?.get(pathOf(u))?.url ?? versionedUrl(u);
  });
}

/**
 * Start streaming `pack` and answer every GET of a packed path from it. Installed after the byte counter and the
 * service worker (so each part is cached like any other asset). Resolves when the pack has streamed to its end (or
 * failed and handed its files to per-file requests): src/client/engine/boot/extras.ts queues the art and audio after it, so they do not
 * split the pipe with the files the world's steps are waiting for.
 */
export function streamPack(whole: PackDef, plan: Plan<BootStep>, files: ChunkFiles): Promise<void> {
  const pack = bootParts(whole, files);
  const sourceOf = new Map<string, ByteKey>();
  for (const key of Object.keys(files) as ByteKey[]) for (const f of files[key]) sourceOf.set(f, key);
  const slots = new Map<string, Slot>();
  for (const [p, , size, type] of pack.files) {
    let resolve: (b: Blob) => void = () => undefined, reject: (e: unknown) => void = () => undefined;
    const blob = new Promise<Blob>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
    blob.catch(() => undefined); // a failed pack is answered per request (fallback below), never an unhandled rejection
    slots.set(p, { type, size, blob, resolve, reject, url: null });
  }
  const fetchNow = window.fetch.bind(window);
  installPackLayer(fetchNow);
  if (current) for (const old of current.values()) if (old.url !== null) URL.revokeObjectURL(old.url);
  current = slots;
  interface PartRequest { res: Promise<Response>; bypassed: boolean }
  /** `bypassed`: no worker controls the page as the request goes out — it goes straight to the network, uncached */
  const request = (part: PackPart): PartRequest => {
    const res = fetchNow(part.url);
    res.catch(() => undefined); // a failed part surfaces when it is streamed
    return { res, bypassed: !controlled() };
  };

  /** one part: cut into its files as it lands; `nearlyDone` fires at OVERLAP so the next part can start */
  const streamPart = async (part: PackPart, { res: response, bypassed }: PartRequest, nearlyDone: () => void): Promise<void> => {
    const res = await response;
    if (!res.ok || !res.body) throw new Error(`${res.status} ${part.url}`);
    const copy = bypassed && res.status === 200 ? res.clone() : undefined;
    const reader = res.body.getReader();
    let received = 0;
    try {
      let i = 0, at = 0, signalled = false; // file index, bytes of the part consumed
      let parts: Uint8Array<ArrayBuffer>[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        let chunk = value;
        while (chunk.byteLength > 0 && i < part.files.length) {
          const file = part.files[i];
          if (file === undefined) break;
          const [p, offset, size, type] = file;
          const take = chunk.subarray(0, Math.min(offset + size - at, chunk.byteLength));
          parts.push(take);
          at += take.byteLength;
          chunk = chunk.subarray(take.byteLength);
          const key = sourceOf.get(p);
          if (key) plan.reader(key).add(take.byteLength);
          if (at === offset + size) {
            const blob = new Blob(parts, { type });
            parts = [];
            i++;
            const slot = slots.get(p);
            if (slot) { slot.url = URL.createObjectURL(blob); slot.resolve(blob); }
            if (key) plan.fileDone(key);
          }
        }
        if (!signalled && at >= part.bytes * OVERLAP) { signalled = true; nearlyDone(); }
      }
      if (!signalled) nearlyDone();
      if (i < part.files.length) throw new Error(`pack part ended after ${i} / ${part.files.length} files: ${part.url}`);
      if (copy !== undefined && received === part.bytes) await publishBootResponse(part.url, copy);
    } finally { void copy?.body?.cancel().catch(() => undefined); }
  };

  const streamed = (async () => {
    // part k + 1 is requested once part k is OVERLAP streamed; its body waits in the network stack until k is read out
    const ahead: { req: PartRequest | null } = { req: null };
    for (let k = 0; k < pack.parts.length; k++) {
      const part = pack.parts[k];
      if (part === undefined) break;
      const req = ahead.req ?? request(part);
      ahead.req = null;
      const following = pack.parts[k + 1];
      await streamPart(part, req, () => { if (following) ahead.req = request(following); });
    }
  })().catch((e: unknown) => {
    console.warn('[pack] falling back to per-file requests:', e);
    for (const s of slots.values()) if (s.url === null) s.reject(e);
  });

  return streamed;
}
