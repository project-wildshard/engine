/** C4 (J83, J84): where cooked packs live. `r2Store` is R2's S3 API over `fetch`, signed here so the cook worker needs no
 * SDK; `folderStore` has the same shape for a local run and for tests. Keys are the URLs' paths, so a client's pack base
 * plus a manifest's URL is the object. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash, createHmac} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname, join, relative, resolve, sep} from 'node:path';

export interface StoredObject {readonly key: string; readonly bytes: number; readonly modified: number}
export interface ObjectHeaders {readonly type: string; readonly encoding?: string; readonly cache: string}
export interface PackStore {
  readonly has: (key: string) => Promise<boolean>;
  readonly get: (key: string) => Promise<Uint8Array | undefined>;
  readonly put: (key: string, body: Uint8Array, headers: ObjectHeaders) => Promise<void>;
  readonly list: (prefix: string) => Promise<readonly StoredObject[]>;
  readonly remove: (key: string) => Promise<void>;
}

/** Keys come from cooked names, but a store is the last place a `..` could turn into a write. */
function assertKey(key: string): void {
  if (key.length === 0 || key.length > 512 || key.startsWith('/') || key.split('/').some(part => part === '' || part === '.' || part === '..') || !/^[\w./-]+$/u.test(key)) throw new Error(`Bad store key: ${key.slice(0, 80)}`);
}

export function folderStore(root: string): PackStore {
  const base = resolve(root);
  mkdirSync(base, {recursive: true});
  const at = (key: string): string => { assertKey(key); return join(base, key); };
  const present = (file: string): boolean => { try { return statSync(file).isFile(); } catch { return false; } };
  return {
    has: key => Promise.resolve(present(at(key))),
    get: key => { const file = at(key); return Promise.resolve(present(file) ? Uint8Array.from(readFileSync(file)) : undefined); },
    put: (key, body) => { const file = at(key); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, body); return Promise.resolve(); },
    list: prefix => {
      const rows: StoredObject[] = [];
      for (const row of readdirSync(base, {recursive: true, withFileTypes: true})) {
        if (!row.isFile()) continue;
        const file = join(row.parentPath, row.name), key = relative(base, file).split(sep).join('/');
        if (!key.startsWith(prefix)) continue;
        const info = statSync(file);
        rows.push({key, bytes: info.size, modified: info.mtimeMs});
      }
      return Promise.resolve(rows.sort((a, b) => (a.key < b.key ? -1 : 1)));
    },
    remove: key => { rmSync(at(key), {force: true}); return Promise.resolve(); },
  };
}

export interface R2Config {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const hmac = (secret: Uint8Array | string, text: string): Uint8Array => createHmac('sha256', secret).update(text).digest();
/** RFC 3986 unreserved stays; S3 wants everything else escaped, `/` too in a query. */
const escape = (text: string): string => encodeURIComponent(text).replaceAll(/[!'()*]/gu, char => `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`);
const EMPTY = new Uint8Array();

export function r2Store(config: R2Config): PackStore {
  const origin = new URL(config.endpoint), read = config.fetch ?? fetch, clock = config.now ?? ((): Date => new Date());
  const send = (method: string, key: string, query: Readonly<Record<string, string>>, body: Uint8Array, extra: Readonly<Record<string, string>>): Promise<Response> => {
    if (key !== '') assertKey(key);
    const amz = clock().toISOString().replaceAll(/[:-]|\.\d{3}/gu, ''), day = amz.slice(0, 8), scope = `${day}/auto/s3/aws4_request`, hash = sha256(body);
    const headers: Record<string, string> = {...extra, host: origin.host, 'x-amz-content-sha256': hash, 'x-amz-date': amz};
    const names = Object.keys(headers).sort(), path = `/${config.bucket}${key === '' ? '' : `/${key.split('/').map(escape).join('/')}`}`;
    const search = Object.keys(query).sort().map(name => `${escape(name)}=${escape(query[name] ?? '')}`).join('&');
    const canonical = [method, path, search, ...names.map(name => `${name}:${(headers[name] ?? '').trim()}`), '', names.join(';'), hash].join('\n');
    const signing = ['auto', 's3', 'aws4_request'].reduce<Uint8Array>((secret, text) => hmac(secret, text), hmac(`AWS4${config.secretAccessKey}`, day));
    const signature = createHmac('sha256', signing).update(['AWS4-HMAC-SHA256', amz, scope, sha256(canonical)].join('\n')).digest('hex');
    return read(`${origin.origin}${path}${search === '' ? '' : `?${search}`}`, {method, headers: {...headers, authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`},
      ...(body.length === 0 ? {} : {body: body.slice()}), signal: AbortSignal.timeout(120_000)});
  };
  /** The body's text is the store's: never echo a signed request back. */
  const failed = (verb: string, key: string, status: number): Error => new Error(`R2 ${verb} ${key.slice(0, 80)} answered ${status}`);
  return {
    has: async key => {
      const response = await send('HEAD', key, {}, EMPTY, {});
      if (response.status === 404) return false;
      if (!response.ok) throw failed('HEAD', key, response.status);
      return true;
    },
    get: async key => {
      const response = await send('GET', key, {}, EMPTY, {});
      if (response.status === 404) { await response.body?.cancel(); return undefined; }
      if (!response.ok) { await response.body?.cancel(); throw failed('GET', key, response.status); }
      return new Uint8Array(await response.arrayBuffer());
    },
    put: async (key, body, headers) => {
      const response = await send('PUT', key, {}, body, {'cache-control': headers.cache, 'content-type': headers.type, ...(headers.encoding === undefined ? {} : {'content-encoding': headers.encoding})});
      await response.body?.cancel();
      if (!response.ok) throw failed('PUT', key, response.status);
    },
    list: async prefix => {
      const rows: StoredObject[] = [];
      for (let token: string | undefined;;) {
        const response = await send('GET', '', {'list-type': '2', prefix, ...(token === undefined ? {} : {'continuation-token': token})}, EMPTY, {});
        if (!response.ok) { await response.body?.cancel(); throw failed('LIST', prefix, response.status); }
        const text = await response.text();
        for (const [, row = ''] of text.matchAll(/<Contents>(.*?)<\/Contents>/gsu)) {
          const key = /<Key>(.*?)<\/Key>/su.exec(row)?.[1], size = /<Size>(\d+)<\/Size>/u.exec(row)?.[1], modified = /<LastModified>(.*?)<\/LastModified>/u.exec(row)?.[1];
          if (key === undefined || size === undefined || modified === undefined) throw new Error('R2 listing row is incomplete');
          rows.push({key, bytes: Number(size), modified: Date.parse(modified)});
        }
        token = text.includes('<IsTruncated>true</IsTruncated>') ? /<NextContinuationToken>(.*?)<\/NextContinuationToken>/su.exec(text)?.[1] : undefined;
        if (token === undefined) return rows;
      }
    },
    remove: async key => {
      const response = await send('DELETE', key, {}, EMPTY, {});
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw failed('DELETE', key, response.status);
    },
  };
}
