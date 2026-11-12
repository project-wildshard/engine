import { contentURL } from '@wildshard/engine/boot/contentBase';

/** Build-produced read-ahead only. The ordinary product readers still admit
 * every size, hash and schema; this loan never writes a persistent cache. */
export interface EntryTransport {
  take: (url: string, signal?: AbortSignal) => Promise<Response | null>;
  has: (url: string) => boolean;
  expand: () => void;
  stop: () => void;
}
export interface EntryDownloadRow {
  /** Only metadata may overlap mandatory code. Older schedules default to body. */
  readonly phase?: 'metadata' | 'body';
  readonly path: string;
  readonly bytes: number;
  /** Member addresses, rather than the pack address, are persisted by admission. */
  readonly members: readonly string[];
}
const transportKey = 'wildshard.entry-transport';
let tap: ((slug: string, flow: 'client' | 'grid') => boolean) | undefined;

/** The title lends a synchronous already-complete manifest painter. Removing
 * an older title cannot remove a newer title's callback. No IO is installed. */
export function installEntryDownloadTap(paint: NonNullable<typeof tap>): () => void {
  tap = paint;
  return () => {if (tap === paint) tap = undefined;};
}

/** Start the descriptor GET at the title tap, before the fresh document. */
export function startEntryDownload(slug: string, flow: 'client' | 'grid' = 'client'): void {
  try { if (tap?.(slug, flow) === true) return; } catch { /* Optional title progress cannot refuse navigation; the entry still reads its real manifest. */ }
  installEntryDownloadTotal(slug, flow);
  const raw = document.getElementById('boot-module-files')?.textContent;
  if (!raw) return;
  try {
    const bank: unknown = JSON.parse(raw);
    const indexes: unknown = typeof bank === 'object' && bank !== null ? Reflect.get(bank, 'entryIndexes') : undefined;
    const url: unknown = typeof indexes === 'object' && indexes !== null ? Reflect.get(indexes, slug) : undefined;
    if (typeof url === 'string' && url.startsWith(`/shardfiles/${slug}/shard.json?v=`)) {
      // Keep the actual index GET alive across travel. The destination still
      // checks its exact build hash and schemas, using the normal URL cache.
      const consume = async (response: Response): Promise<void> => {
        if (response.body === null) return;
        const reader = response.body.getReader(); let size = 0;
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.length; if (size > 2_000_000) { await reader.cancel(); break; }
        }
      };
      void fetch(contentURL(url), {keepalive: true, priority: 'high'}).then(consume).catch(() => undefined);
    }
  } catch { /* Read-ahead never blocks a player navigation. */ }
}

/** Read-only presentation facts, never entry authority. The fresh document
 * peeks at the existing one-shot grid intent without consuming it. */
export function installEntryDownloadTotal(picked?: string, flow: 'client' | 'grid' = 'client'): void {
  const selected = picked ?? new URL(location.href).searchParams.get('chunk');
  if (selected === null || !/^[a-z0-9_-]+$/u.test(selected)) return;
  const raw = document.getElementById('boot-module-files')?.textContent;
  if (!raw) return;
  const get = (value: unknown, key: string): unknown => typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  const bank: unknown = JSON.parse(raw), totals = get(bank, 'entryTotals');
  if (totals === undefined) return;
  const developer = Object.hasOwn(document.documentElement.dataset, 'dev');
  const rows = flow === 'grid' ? get(get(totals, 'grid'), developer ? '100' : '000') : get(totals, 'client');
  const pair = get(rows, selected), tier = /iPhone|iPad|Android|Mobile/u.test(navigator.userAgent) ? 0 : 1;
  const bytes: unknown = Array.isArray(pair) ? pair[tier] : undefined;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) return;
  document.documentElement.dataset['entryDownloadBytes'] = String(bytes);
  document.documentElement.dataset['entryDownloadSlug'] = selected;
  document.documentElement.dataset['entryDownloadFlow'] = flow;
  const root = document.querySelector<HTMLElement>('.ws-load');
  if (root !== null) { root.dataset['entryDownloadBytes'] = String(bytes); root.dataset['entryDownloadSlug'] = selected; root.dataset['entryDownloadFlow'] = flow; }
}

/** A transport loan is consumed once, on the destination document only. */
export function entryTransport(): EntryTransport | undefined {
  const loan: unknown = Reflect.get(globalThis, Symbol.for(transportKey));
  return typeof loan === 'object' && loan !== null && 'take' in loan && typeof loan.take === 'function'
    && 'has' in loan && typeof loan.has === 'function' && 'expand' in loan && typeof loan.expand === 'function'
    && 'stop' in loan && typeof loan.stop === 'function' ? loan as EntryTransport : undefined;
}

/** Invoked explicitly by the plain app-build bootstrap, before application
 * imports. The function is self-contained so it needs no module graph. */
export function installEntryTransport(): void {
  const key = Symbol.for('wildshard.entry-transport');
  if (Reflect.has(globalThis, key)) return;
  const selected = new URL(location.href).searchParams.get('chunk');
  if (selected === null || !/^[a-z0-9_-]+$/u.test(selected)) return;
  const bank = document.getElementById('boot-module-files')?.textContent;
  if (!bank) return;
  const table: unknown = JSON.parse(bank);
  if (typeof table !== 'object' || table === null) return;
  const entries: unknown = Reflect.get(table, 'entryDownloads');
  // PZ3: content reads go to the bank's content base (same origin when empty); jobs keep their page URLs (J138). PZ13: the
  // base may have a folder (`content/<set>/`) that mirrors page paths, so a page path goes under it and comes back out.
  const named: unknown = Reflect.get(table, 'contentBase'), base = typeof named === 'string' && named !== '' ? new URL(named) : null;
  const onContent = (path: string): string => {
    const at = new URL(path, location.href);
    return base === null || at.origin !== location.origin ? path : new URL(`.${at.pathname}${at.search}`, base).href;
  };
  const pageName = (url: string): string => {
    const at = new URL(url, location.href);
    if (base === null || at.origin !== base.origin || !at.pathname.startsWith(base.pathname)) return at.href;
    return new URL(at.pathname.slice(base.pathname.length - 1) + at.search, location.href).href;
  };
  if (typeof entries !== 'object' || entries === null) return;
  const tier = /iPhone|iPad|Android/iu.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 ? 'phone' : 'desktop';
  const pair: unknown = Reflect.get(entries, selected);
  const address: unknown = typeof pair === 'object' && pair !== null ? Reflect.get(pair, tier) : undefined;
  if (typeof address !== 'string' || !/^\/assets\/entry-[a-z0-9_-]+-[a-f0-9]{16}\.json$/u.test(address)) return;
  const controller = new AbortController(), jobs = new Map<string, Promise<Response | null>>();
  let expand = (): void => undefined;
  const codeReady = new Promise<void>(resolve => { expand = resolve; });
  let stopped = false;
  const stop = (): void => { stopped = true; controller.abort(); jobs.clear(); expand(); };
  Reflect.set(globalThis, key, {
    has: (url: string): boolean => jobs.has(pageName(url)),
    take: async (url: string, signal?: AbortSignal): Promise<Response | null> => {
      const name = pageName(url), job = jobs.get(name);
      if (job === undefined) return null;
      // Actual admission demand must never wait behind its own read-ahead fence.
      expand();
      jobs.delete(name);
      signal?.throwIfAborted();
      const response = await job;
      signal?.throwIfAborted();
      return response;
    }, stop, expand: (): void => { expand(); },
  });
  // Before imports, this document owns the fetches (navigation cancels them).
  // Once admission starts its normal page Scope binds explicit stop/cleanup.
  const run = async (): Promise<void> => {
    const schedule = await fetch(onContent(address), {signal: controller.signal});
    if (!schedule.ok) return;
    const boundedJson = async (response: Response, cap: number): Promise<unknown> => {
      if (response.body === null) return null;
      const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > cap) { await reader.cancel(); throw new Error('Entry metadata exceeds cap'); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    const input: unknown = await boundedJson(schedule, 1_000_000);
    if (!Array.isArray(input) || input.length > 256) return;
    const rows: EntryDownloadRow[] = [];
    let reserved = 0;
    for (const candidate of input as unknown[]) {
      if (typeof candidate !== 'object' || candidate === null) return;
      const path: unknown = Reflect.get(candidate, 'path'), bytes: unknown = Reflect.get(candidate, 'bytes'), members: unknown = Reflect.get(candidate, 'members'), phase: unknown = Reflect.get(candidate, 'phase');
      if (typeof path !== 'string' || !path.startsWith(`/shardfiles/${selected}/`) || !/^\/[a-zA-Z0-9_./-]+$/u.test(path) || path.includes('..')
        || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 25_000_000
        || phase !== undefined && phase !== 'metadata' && phase !== 'body'
        || !Array.isArray(members) || members.length > 8192 || !members.every((hash: unknown) => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash))) return;
      reserved += bytes;
      if (reserved > 48_000_000) return;
      rows.push({path, bytes, members, phase: phase === 'metadata' ? 'metadata' : 'body'});
    }
    // Metadata is a skip hint only. A stale row can lose read-ahead, never
    // authorize a body: original cache/network admission still checks it.
    let cached: Record<string, unknown> = {};
    try {
      const cache = await caches.open('ws-content-v0'), index = await cache.match('/__ws_content__/v0/index');
      if (index !== undefined) {
        const value: unknown = await boundedJson(index, 2_000_000);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) cached = value as Record<string, unknown>;
      }
    } catch { /* No cache is also a valid cold entry. */ }
    if (stopped) return;
    const pending: {row: EntryDownloadRow; finish: (response: Response | null) => void}[] = [];
    for (const row of rows) {
      if (row.members.length > 0 && row.members.every(hash => Object.hasOwn(cached, hash))) continue;
      const job = new Promise<Response | null>(resolve => { pending.push({row, finish: resolve}); });
      jobs.set(new URL(row.path, location.href).href, job);
    }
    let next = 0;
    const read = async (row: EntryDownloadRow): Promise<Response | null> => {
      try {
        const response = await fetch(onContent(row.path), {signal: controller.signal, priority: 'low'});
        if (!response.ok || response.status === 206 || response.body === null) { await response.body?.cancel(); return null; }
        const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > row.bytes || stopped) { await reader.cancel(); return null; }
          chunks.push(part.value);
        }
        if (size !== row.bytes || stopped) return null;
        return new Response(new ReadableStream({start(stream): void {
          for (const chunk of chunks) stream.enqueue(chunk);
          chunks.length = 0; stream.close();
        }}), {status: response.status, headers: response.headers});
      } catch { return null; }
    };
    const worker = async (): Promise<void> => {
      for (;;) {
        if (stopped) return;
        const job = pending[next++]; if (job === undefined) return;
        job.finish(await read(job.row));
      }
    };
    // A warm title can already hold every header. Never promote its next
    // uncached body into the one early metadata slot and starve code.
    const headerIndex = pending.findIndex(job => job.row.phase === 'metadata');
    const header = headerIndex === -1 ? undefined : pending.splice(headerIndex, 1)[0];
    await Promise.all(Array.from({length: 6}, async (_, slot) => {
      if (slot === 0 && header !== undefined) header.finish(stopped ? null : await read(header.row));
      await codeReady; await worker();
    }));
    for (const job of pending) job.finish(null);
  };
  void run().catch(() => { stop(); });
}
