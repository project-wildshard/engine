import type { Scope } from '@wildshard/engine/app/scope';
import { beginShaderSourceSession, endShaderSourceSession, type SourceBook, type SourceSession } from '@wildshard/engine/render/shaderSourceCache';

const encoder = new TextEncoder();
const DATABASE = 'wildshard-shader-source';
const BOOK = 'book';
const ENTRY = 'last';
const MAX_BYTES = 12_000_000;
interface StoredBook { renderer: string; zone: string; book: SourceBook }

/** QA-FEEDBACK-2026-11-23 row 8 (Jake: *"its only frozen and really fucking slow when doing a version upgrade or update"*): the
 *  book is keyed by the renderer it was emitted by, not the deploy. Its texts are pure functions of their keyed inputs and of the
 *  shader-emitting code (render/graph's lowering and wrapping, shaderText's finishing, three's chunks, the format pin), which is
 *  exactly what the renderer revision hashes (src/scripts/renderer-revision.mjs, J259; stamped on every document as
 *  `__WS_RENDERER_REVISION__`). GPU identity is not an input: three adds the GPU's precision and extension prefixes after the
 *  book. So an update that leaves the renderer alone replays the book; one that changes a shader starts it again. A document
 *  without the stamp (a dev page) keys by its build, as before. */
export function shaderBookIdentity(renderer: unknown, build: string): string {
  return typeof renderer === 'string' && /^[0-9a-f]{64}$/u.test(renderer) ? `renderer:${renderer}` : `build:${build}`;
}
interface CacheEntry { bytes: Uint8Array<ArrayBuffer>; digest: string }

async function checksum(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new DataView(await crypto.subtle.digest('SHA-256', bytes));
  let hash = '';
  for (let offset = 0; offset < digest.byteLength; offset += 4) hash += digest.getUint32(offset).toString(16).padStart(8, '0');
  return hash;
}

function requested<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => { resolve(request.result); };
    request.onerror = (): void => { reject(request.error ?? new Error('Shader cache request failed')); };
  });
}

function openBookStore(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = (): void => { request.result.createObjectStore(BOOK); };
  return requested(request);
}

async function readBook(renderer: string, zone: string): Promise<SourceBook | undefined> {
  const database = await openBookStore();
  try {
    const request: IDBRequest<unknown> = database.transaction(BOOK).objectStore(BOOK).get(ENTRY);
    const cached = await requested(request) as CacheEntry | undefined;
    const bytes = cached?.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES || await checksum(bytes) !== cached?.digest) return undefined;
    const saved = JSON.parse(new TextDecoder().decode(bytes)) as StoredBook;
    if (saved.renderer !== renderer || saved.zone !== zone || saved.book?.lower === undefined || saved.book.wrap === undefined || saved.book.finish === undefined) return undefined;
    return saved.book;
  } finally { database.close(); }
}

async function writeBook(renderer: string, zone: string, book: SourceBook): Promise<void> {
  const bytes = encoder.encode(JSON.stringify({ renderer, zone, book } satisfies StoredBook));
  if (bytes.length > MAX_BYTES) return;
  const digest = await checksum(bytes), database = await openBookStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BOOK, 'readwrite');
      transaction.oncomplete = (): void => { resolve(); };
      transaction.onabort = (): void => { reject(transaction.error ?? new Error('Shader cache write aborted')); };
      transaction.objectStore(BOOK).put({ bytes, digest } satisfies CacheEntry, ENTRY);
    });
  } finally { database.close(); }
}

/** Use the last played zone's local cache. A missing entry or a denied store keeps the normal emitter. `renderer` is
 *  `shaderBookIdentity`'s value. */
export async function openShaderSourceCache(renderer: string, zone: string, scope: Scope): Promise<void> {
  const book = await readBook(renderer, zone).catch(() => undefined);
  if (scope.disposed || scope.disposing) return;
  const wasWarm = book !== undefined;
  let session: SourceSession | undefined = beginShaderSourceSession(book);
  const close = (): void => {
    if (session !== undefined) endShaderSourceSession(session);
    session = undefined;
  };
  scope.onDispose(close);
  scope.listen(document, 'ws:control-ready', () => {
    const completed = session;
    close();
    if (completed === undefined) return;
    document.documentElement.dataset['shaderSourceCache'] = JSON.stringify({ hits: completed.hits, emitted: completed.emitted });
    if (!wasWarm || Object.values(completed.emitted).some(value => value > 0)) {
      void writeBook(renderer, zone, completed.book).catch(() => undefined);
    }
  }, { once: true });
}
