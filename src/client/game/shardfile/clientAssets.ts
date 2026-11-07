import { pacedResolve } from '@wildshard/engine/core/workSlice';
import { isDev } from '@wildshard/engine/core/devMode';
import { memoryAttribution } from '@wildshard/engine/core/memoryAttribution';

import { boundedResponse, type ProductOptions } from './product';
import { outputBlobUrl, outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { readPackWhole, releasePackWholes } from '../../../shared/game/shardfile/packReads';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** Release admitted transport copies after decoding; revisiting a tile rechecks immutable bytes from cache or the product. */
export class ClientAssets {
  private readonly wire: Map<string, Uint8Array>;
  private readonly pending = new Map<string, Promise<Uint8Array>>();
  private readonly source: Shardfile;
  private readonly options: ProductOptions;
  // The admitted source's files by hash, built on the first lease (every tile scope leases its closure at boot).
  private byHash: Map<string, Shardfile['files'][number]> | undefined;
  constructor(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, options: ProductOptions) {
    this.source = source; this.wire = new Map(assets); this.options = options;
    if (isDev()) for (const [ref, bytes] of this.wire) this.observe(ref, bytes);
  }
  /** The existing weak ledger observes backing capacity, never a new byte owner or a resident-RAM claim. */
  private observe(ref: string, bytes: Uint8Array): Uint8Array {
    if (isDev()) memoryAttribution.buffer(bytes, { owner: `product:${this.source.identity.slug}`, asset: ref });
    return bytes;
  }
  get retained(): ReadonlyMap<string, Uint8Array> { return this.wire; }
  /** Lease authoritative/library roots for the level; render tiles receive their own shorter leases. */
  pin(): () => void { return this.lease(this.roots()); }
  /** Pin an admitted tile and its dependencies until its render scope is released. */
  lease(refs: Iterable<string>): () => void { return this.options.cache?.pin?.([...this.closure(refs)].map((ref) => ref.replace(/^commons:/u, ''))) ?? (() => undefined); }
  /** Optional read-ahead shares actual demand's pending verification, at low network priority. */
  async read(ref: string, priority?: 'low'): Promise<Uint8Array> {
    const file = this.source.files.find((row) => row.hash === ref);
    if (file === undefined && !this.source.requires.commons.some((hash) => ref === `commons:${hash}`)) throw new Error('Undeclared resident asset');
    // a cached read resolves at once, unless the frame's build budget is spent (pacedResolve): a hook's chain of
    // cached reads must not run in one task on the road
    const present = this.wire.get(ref); if (present !== undefined) return pacedResolve(this.observe(ref, present));
    // Callers already borrow admitted immutable transport. Concurrent released
    // reads borrow one verification/backing too; decoders that transfer copy it.
    // Keep no settled result: later residency rereads still check cache/network.
    const previous = this.pending.get(ref); if (previous !== undefined) return previous;
    const read = this.readReleased(ref, file?.compressed ?? this.source.requires.commonsWire[ref.replace(/^commons:/u, '')] ?? 0, priority);
    this.pending.set(ref, read);
    try { return await read; }
    finally { this.pending.delete(ref); }
  }
  private async readReleased(ref: string, cap: number, priority?: 'low'): Promise<Uint8Array> {
    const hash = ref.replace(/^commons:/u, ''), base = new URL('.', this.options.base).href;

    // Build-owned callers read the canonical URL through the service worker.
    // Its cache is authoritative; the read capability compares length only.
    if (this.options.firstPartyRead !== undefined) {
      return this.observe(ref, await this.options.firstPartyRead(outputBlobUrl(this.source, ref, base), cap, undefined, hash, priority));
    }

    // a trusted content-cache read already checked its SHA-256 (ContentCache.get): no page re-hash (~150 ms of a
    // phone-tier home region); every other read is checked here, off the page where a worker can
    const url = outputDescriptor(this.source) === undefined ? undefined : outputBlobUrl(this.source, ref, base);
    const verified = await this.options.cache?.verifiedAsset?.(hash)
      ?? (url === undefined ? undefined : await this.urlHint(url, hash, cap, priority));
    if (verified !== null && verified !== undefined) {
      if (verified.length !== cap) throw new Error('Resident tile hash or size mismatch');

      return this.observe(ref, verified);
    }
    let bytes = this.options.cache?.verifiedAsset === undefined ? await this.options.cache?.asset(base, hash) : null, downloaded = false;
    if ((bytes === null || bytes === undefined) && url !== undefined && this.options.verifiedResponse === undefined) {
      bytes = await this.options.cachedResponse?.(outputBlobUrl(this.source, ref, base), hash, cap);
    }
    if (bytes === null || bytes === undefined) {
      if (this.options.offline) throw new Error('Missing cached resident tile');
      const member = await this.readPacked(ref, cap, priority);
      const fetch = priority === 'low' ? this.options.backgroundFetch ?? this.options.fetch : this.options.fetch;
      bytes = member ?? await boundedResponse(await fetch(outputBlobUrl(this.source, ref, base)), cap);
      downloaded = true;
    }
    if (bytes.length !== cap || await this.hashOf(bytes) !== hash) throw new Error('Resident tile hash or size mismatch');
    if (downloaded) {
      // The verified network response is the build input. Disk persistence must
      // not hold the home load behind a background writer or a cache refusal.
      const cache = this.options.cache, wire = bytes;
      if (cache !== undefined) void Promise.resolve().then(async () => {
        await (cache.putAssetBackground === undefined ? cache.putAsset(base, hash, wire) : cache.putAssetBackground(base, hash, wire));
        return undefined;
      }).catch(() => undefined);
    }
    return this.observe(ref, bytes);
  }
  /** Optional URL hints cannot hold foreground demand behind unrelated browser cache work. */
  private async urlHint(url: string, hash: string, cap: number, priority?: 'low'): Promise<Uint8Array | null | undefined> {
    const read = this.options.verifiedResponse, turn = this.options.cacheHintTurn;
    if (read === undefined) return undefined;
    if (this.options.offline || priority === 'low' || turn === undefined) return read(url, hash, cap);
    const controller = new AbortController();
    try {
      return await Promise.race([read(url, hash, cap, controller.signal), turn(controller.signal).then(() => null)]);
    } finally { controller.abort(); }
  }

  /** Fetch each pack whole once for this product, across concurrent and later
   * demand waves; every decoder still receives an owned, hash-checked member. */
  private async readPacked(ref: string, cap: number, priority?: 'low'): Promise<Uint8Array | undefined> {
    if (this.options.directFiles === true) return undefined;
    const packs = outputDescriptor(this.source)?.index.packs;
    const pack = packs?.find(row => row.entries.some(entry => entry.hash === ref));
    const member = pack?.entries.find(entry => entry.hash === ref);
    if (packs === undefined || pack === undefined || member === undefined) return undefined;
    if (member.bytes !== cap) throw new Error('Resident packed member size mismatch');
    const wire = await readPackWhole(packs, pack, async (path, maximum) => {

      const fetch = priority === 'low' ? this.options.backgroundFetch ?? this.options.fetch : this.options.fetch;
      const response = await fetch(new URL(path, this.options.base).href);
      if (response.status === 206) { await response.body?.cancel(); throw new Error('Resident pack requires a whole response'); }
      const bytes = await boundedResponse(response, maximum);

      return this.observe(pack.hash, bytes);
    }, bytes => this.hashOf(bytes), this.options.hash);
    return wire.slice(member.offset, member.offset + member.bytes);
  }

  /** SHA-256 of `bytes` off the page (an owned copy through `hashOwned`), else on the page. */
  private async hashOf(bytes: Uint8Array): Promise<string> {
    const hashOwned = this.options.hashOwned;
    if (hashOwned !== undefined) { try { return (await hashOwned(new Uint8Array(bytes))).hash; } catch { /* the page hashes it */ } }
    return this.options.hash(bytes);
  }
  /** Bind legacy catalogue identities to the admitted library, never to their old network URLs.
   * Each decoder receives an owned exact-length ArrayBuffer; absent bindings retain the caller's existing reader. */
  audioRead(): ((path: string) => Promise<ArrayBuffer>) | undefined {
    if (this.source.audio.recordings === undefined) return undefined;
    const recordings = new Map(Object.entries(this.source.audio.recordings));
    return async path => {
      const ref = recordings.get(path);
      if (ref === undefined) throw new Error(`Undeclared audio recording: ${path}`);
      return Uint8Array.from(await this.read(ref)).buffer;
    };
  }
  private roots(): string[] { return [...this.source.critical, ...this.source.library, ...(this.source.look.grade.lut === null ? [] : [this.source.look.grade.lut])]; }
  private closure(refs: Iterable<string>): Set<string> {
    const keep = new Set<string>(), files = this.byHash ??= new Map(this.source.files.map((file) => [file.hash, file])), pending = [...refs];
    while (pending.length > 0) {
      const ref = pending.pop(); if (ref === undefined || keep.has(ref)) continue;
      keep.add(ref); pending.push(...files.get(ref)?.dependencies ?? []);
    }
    return keep;
  }
  /** Forget only decoded or runtime-owned transport copies; future reads still check immutable cache/network bytes. */
  releaseTransport(refs: Iterable<string>): void { for (const ref of refs) this.wire.delete(ref); }
  /** js-heap H6: once the boot has played, release decoded member transport: a probe saw no read of a retained root in 20 s of
   *  play on the Template or Driftwood. MF7: the verified whole packs go too (41.8 MB held on Pine Hollow's phone
   *  play); a later read verifies its member from the content cache or one more whole-pack read. */
  releaseAll(): void {
    this.wire.clear();
    const packs = outputDescriptor(this.source)?.index.packs;
    if (packs !== undefined) releasePackWholes(packs);
  }
  /** Keep only authoritative and library roots while render tiles stream through temporary admitted maps. */
  releaseTiles(): void {
    const keep = this.closure(this.roots());
    for (const ref of this.wire.keys()) if (!keep.has(ref)) this.wire.delete(ref);
  }
}
