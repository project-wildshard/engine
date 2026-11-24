/** SP20: host-owned parent-only transport. The child receives bytes and never this key or client. */
// oxlint-disable-next-line import/no-nodejs-modules -- The parent signs exact request bytes.
import {createHash, createHmac} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Verdicts survive process restart before any POST.
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Outbox filenames use validated upload ids only.
import {join} from 'node:path';
import * as v from 'valibot';
import {UploadActivationAckSchema} from '@wildshard/engine/game/shardfile/uploadActivation';
import {ShardfileHashSchema, ShardSlugSchema} from '@wildshard/format/uploadWire';
import {MAX_SHARDFILE_BYTES} from '@wildshard/format/uploadCaps';
import {readCapped, type CookRow, type CookWorker, type ShardfileSource} from './cookWorker';

const Id = v.pipe(v.string(), v.regex(/^[a-f0-9-]{36}$/u));
const identity = {uploadId: Id, hash: ShardfileHashSchema, slug: ShardSlugSchema};
const Pending: v.GenericSchema<PendingUpload> = v.object({...identity, revision: v.pipe(v.number(), v.safeInteger(), v.minValue(1)), formatVersion: v.string()});
const Activation: v.GenericSchema<ActivationNotice> = v.object({...identity, channels: v.array(v.picklist(['preview', 'staging', 'production'])), place: v.optional(v.boolean())});
export interface PendingUpload {readonly uploadId: string; readonly hash: string; readonly slug: string; readonly revision: number; readonly formatVersion: string}
export interface ActivationNotice {readonly uploadId: string; readonly hash: string; readonly slug: string; readonly channels: readonly ('preview' | 'staging' | 'production')[]; readonly place?: boolean | undefined}
export interface UploadVerdict {readonly hash: string; readonly result: 'cooked' | 'refused'; readonly build?: string; readonly report: Readonly<Record<string, unknown>>}
export interface CookApi {
  readonly pending: () => AsyncIterable<PendingUpload>;
  readonly activations: () => AsyncIterable<ActivationNotice>;
  readonly download: (job: PendingUpload) => Promise<Uint8Array>;
  /** 202 acknowledges durable receipt; it never means that the game is live. */
  readonly verdict: (id: string, body: string) => Promise<void>;
  readonly acknowledge: (notice: ActivationNotice, channels: readonly string[]) => Promise<void>;
}
/** Protocol test vector is shared with api-server/docs/async-upload.md. */
export function cookHeaders(key: string, method: string, path: string, body = '', now: number = Date.now()): Readonly<Record<string, string>> {
  const time = String(now), text = ['wildshard-cook-v1', method, path, time, body].join('\n');
  return {'x-wildshard-cook-time': time, 'x-wildshard-cook-signature': createHmac('sha256', key).update(text).digest('hex'), 'content-type': 'application/json'};
}

export class CookDeliveryError extends Error {
  override readonly name = 'CookDeliveryError';
  readonly status: number;
  constructor(status: number) {super(`Cook delivery answered ${status}`); this.status = status;}
  get permanent(): boolean {return [400, 404, 409, 410, 413, 422].includes(this.status);}
}

export function cookApi(base: string, key: string, read: typeof fetch = fetch, now: () => number = Date.now, maxBytes: number = MAX_SHARDFILE_BYTES): CookApi {
  if (key.length < 32) throw new Error('The cook signing key is too short');
  const origin = new URL(base);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && new Set(['localhost', '127.0.0.1', '[::1]']).has(origin.hostname))) throw new Error('The cook API needs HTTPS outside loopback');
  if (origin.pathname !== '/' || origin.search !== '' || origin.hash !== '' || origin.username !== '' || origin.password !== '') throw new Error('The cook API needs an origin');
  const request = async (method: string, path: string, body = ''): Promise<Response> => {
    const response = await read(new URL(path, origin), {method, redirect: 'manual', headers: cookHeaders(key, method, path, body, now()), ...(method === 'GET' ? {} : {body}), signal: AbortSignal.timeout(300_000)});
    return response;
  };
  const pages = async function* pages<T>(path: string, schema: v.GenericSchema<T>): AsyncIterable<T> {
    const page = v.object({uploads: v.array(schema), cursor: v.optional(Id)});
    let cursor: string | undefined;
    do {
      const response = await request('GET', `${path}${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`);
      if (!response.ok) throw new Error(`Cook feed answered ${response.status}`);
      const value = v.parse(page, JSON.parse(new TextDecoder().decode(await readCapped(response, 2_000_000))));
      for (const row of value.uploads) yield row;
      if (value.cursor !== undefined && value.cursor <= (cursor ?? '')) throw new Error('Cook feed cursor did not advance');
      cursor = value.cursor;
    } while (cursor !== undefined);
  };
  const post = async (path: string, body: string): Promise<void> => {
    const response = await request('POST', path, body);
    if (response.status !== 200 && response.status !== 202) throw new CookDeliveryError(response.status);
  };
  return {
    pending: () => pages('/api/shardfiles/cook/uploads', Pending),
    activations: () => pages('/api/shardfiles/cook/activations', Activation),
    download: async job => {
      const path = `/api/shardfiles/uploads/${v.parse(Id, job.uploadId)}/source`;
      let response = await request('GET', path), url = new URL(path, origin);
      for (let redirects = 0; [301, 302, 303, 307, 308].includes(response.status); redirects++) {
        if (redirects >= 4) throw new Error('Too many cook source redirects');
        const location = response.headers.get('location');
        if (location === null) throw new Error('Missing cook source redirect');
        url = new URL(location, url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '' || (origin.protocol === 'https:' && url.protocol !== 'https:')) throw new Error('Unsafe cook source redirect');
        // Never forward a signature or credential, even to a same-origin redirect.
        response = await read(url, {redirect: 'manual', signal: AbortSignal.timeout(300_000)});
      }
      if (!response.ok) throw new Error(`Pending shardfile answered ${response.status}`);
      const bytes = await readCapped(response, maxBytes);
      if (createHash('sha256').update(bytes).digest('hex') !== job.hash) throw new Error('Pending shardfile differs from its hash');
      return bytes;
    },
    verdict: (id, body) => post(`/api/shardfiles/uploads/${v.parse(Id, id)}/verdict`, body),
    acknowledge: (notice, channels) => post(`/api/shardfiles/uploads/${v.parse(Id, notice.uploadId)}/ack`, JSON.stringify({hash: notice.hash, channels})),
  };
}

/** Pending originals are private until activation, so catalogue download alone cannot cook them. */
export function pendingSource(api: CookApi, publicSource: ShardfileSource): ShardfileSource & {readonly bind: (job: PendingUpload) => void; readonly unbind: (job: PendingUpload) => void} {
  const jobs = new Map<string, PendingUpload>();
  return {...publicSource, bind: job => {jobs.set(job.hash, job);}, unbind: job => {if (jobs.get(job.hash)?.uploadId === job.uploadId) jobs.delete(job.hash);}, download: hash => {
    const job = jobs.get(hash); return job === undefined ? publicSource.download(hash) : api.download(job);
  }};
}

interface Outgoing {readonly uploadId: string; readonly body: string}
const OutgoingSchema: v.GenericSchema<Outgoing> = v.strictObject({uploadId: Id, body: v.string()});
/** Append by atomic rename after fsync, before POST. A lost HTTP response replays exactly these bytes. */
export class VerdictOutbox {
  private readonly directory: string;
  constructor(directory: string) {this.directory = directory; mkdirSync(directory, {recursive: true});}
  private file(id: string): string {return join(this.directory, `${v.parse(Id, id)}.json`);}
  read(id: string): Outgoing | undefined {
    const file = this.file(id); if (!existsSync(file)) return undefined;
    const value = v.parse(OutgoingSchema, JSON.parse(readFileSync(file, 'utf8')));
    if (value.uploadId !== id) throw new Error('Outbox identity mismatch');
    return value;
  }
  save(id: string, verdict: UploadVerdict): void {
    if (this.read(id) !== undefined) return;
    const file = this.file(id), temporary = `${file}.new`, body = JSON.stringify({uploadId: id, body: JSON.stringify(verdict)});
    const descriptor = openSync(temporary, 'w', 0o600);
    try {writeFileSync(descriptor, body); fsyncSync(descriptor);} finally {closeSync(descriptor);}
    renameSync(temporary, file); this.sync();
  }
  rows(): readonly Outgoing[] {
    return readdirSync(this.directory).filter(file => /^[a-f0-9-]{36}\.json$/u.test(file)).flatMap(file => {
      try {const value = this.read(file.slice(0, -5)); return value === undefined ? [] : [value];}
      catch {renameSync(join(this.directory, file), join(this.directory, `${file}.corrupt`)); this.sync(); return [];}
    });
  }
  blocked(id: string): boolean {return existsSync(`${this.file(id)}.dead`) || existsSync(`${this.file(id)}.corrupt`);}
  dead(id: string): void {renameSync(this.file(id), `${this.file(id)}.dead`); this.sync();}
  due(id: string, now: number): boolean {
    const file = `${this.file(id)}.retry`;
    if (!existsSync(file)) return true;
    const value = v.parse(v.object({count: v.number(), after: v.number()}), JSON.parse(readFileSync(file, 'utf8')));
    return now >= value.after;
  }
  defer(id: string, now: number): void {
    const file = `${this.file(id)}.retry`, old = existsSync(file) ? v.parse(v.object({count: v.number()}), JSON.parse(readFileSync(file, 'utf8'))).count : 0;
    const count = old + 1, temporary = `${file}.new`, descriptor = openSync(temporary, 'w', 0o600);
    try {writeFileSync(descriptor, JSON.stringify({count, after: now + Math.min(600_000 * 2 ** Math.min(count - 1, 10), 21_600_000)})); fsyncSync(descriptor);} finally {closeSync(descriptor);}
    renameSync(temporary, file); this.sync();
  }
  remove(id: string): void {rmSync(this.file(id), {force: true}); rmSync(`${this.file(id)}.retry`, {force: true}); this.sync();}
  private sync(): void {const descriptor = openSync(this.directory, 'r'); try {fsyncSync(descriptor);} finally {closeSync(descriptor);}}
}

export interface UploadDeliveryOptions {
  readonly api: CookApi;
  readonly source: Pick<ReturnType<typeof pendingSource>, 'bind'> & Partial<Pick<ReturnType<typeof pendingSource>, 'unbind'>>;
  readonly worker: Pick<CookWorker, 'cook'>;
  readonly outbox: VerdictOutbox;
  readonly build: string;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}
/** Discovery never awaits the cook queue: every page can admit new uploads while old recooks run. */
export function uploadDelivery(options: UploadDeliveryOptions): {readonly sweep: () => Promise<void>; readonly idle: () => Promise<void>} {
  const {api, worker, source, outbox, build} = options, pending = new Map<string, Promise<void>>(), log = options.log ?? ((): void => undefined);
  let sweeping = false;
  const deliver = async (id: string): Promise<void> => {
    const row = outbox.read(id); if (row === undefined) return;
    try {await api.verdict(id, row.body); outbox.remove(id);}
    catch (error) {
      if (error instanceof CookDeliveryError && error.permanent) {outbox.dead(id); log(`upload ${id}: permanent verdict delivery ${error.status}; full report retained in dead letter`); return;}
      throw error;
    }
  };
  const settle = async (job: PendingUpload): Promise<void> => {
    try {
      if (outbox.blocked(job.uploadId) || !outbox.due(job.uploadId, (options.now ?? Date.now)())) return;
      if (outbox.read(job.uploadId) === undefined) {
        source.bind(job);
        const row: CookRow = await worker.cook({slug: job.slug, hash: job.hash});
        if (row.hash !== job.hash || !new Set([job.slug]).has(row.slug)) throw new Error('The cook reported another upload');
        if (row.state === 'failed') {outbox.defer(job.uploadId, (options.now ?? Date.now)()); log(`upload ${job.uploadId}: cook failed; retry next poll`); return;}
        if (row.state !== 'refused' && !row.check?.pass) throw new Error('No successful full check for pending upload');
        outbox.save(job.uploadId, {hash: job.hash, result: row.state === 'refused' ? 'refused' : 'cooked', ...(row.state === 'refused' ? {} : {build}), report: row.check === undefined ? {reason: row.detail ?? 'Shardfile refused'} : {...row.check}});
      }
      await deliver(job.uploadId);
    } catch (error) {log(`upload ${job.uploadId}: ${error instanceof Error ? error.message : 'delivery failed'}`);}
    finally {source.unbind?.(job);}
  };
  return {
    sweep: async () => {
      if (sweeping) return; sweeping = true;
      try {
        for (const row of outbox.rows()) if (!pending.has(row.uploadId)) {
          const work = deliver(row.uploadId).catch(() => {log(`upload ${row.uploadId}: verdict delivery waiting`);}).finally(() => {pending.delete(row.uploadId);});
          pending.set(row.uploadId, work);
        }
        for await (const job of api.pending()) {
          if (pending.has(job.uploadId)) continue;
          const work = settle(job).finally(() => {pending.delete(job.uploadId);});
          pending.set(job.uploadId, work);
        }
      } finally {sweeping = false;}
    },
    idle: async () => {await Promise.all(pending.values());},
  };
}

export interface GameActivationClient {readonly activate: (notice: ActivationNotice, channel: 'staging' | 'production') => Promise<void>}
/** The host-owned parent talks to loopback game ports; redirects never receive a local bearer credential. */
export function gameActivationClient(receivers: Readonly<Partial<Record<'staging' | 'production', {readonly url: string; readonly token: string}>>>, build: string, read: typeof fetch = fetch): GameActivationClient {
  return {activate: async (notice, channel) => {
    const receiver = receivers[channel]; if (receiver === undefined) throw new Error('No local game receiver for activation');
    const url = new URL(receiver.url);
    if (url.protocol !== 'http:' || !new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname) || url.username !== '' || url.password !== '') throw new Error('The game activation receiver must be loopback');
    const body = JSON.stringify({uploadId: notice.uploadId, hash: notice.hash, slug: notice.slug, channel, ...(notice.place === undefined ? {} : {place: notice.place})});
    const response = await read(new URL('/internal/upload-activation', url), {method: 'POST', redirect: 'error', headers: {authorization: `Bearer ${receiver.token}`, 'content-type': 'application/json'}, body, signal: AbortSignal.timeout(120_000)});
    if (response.status !== 200) {
      // The game's 503 says why it withholds acknowledgement (`uploadActivationReceiver`): the cook's log carries it.
      const reason = await response.json().then((answer: unknown) => (typeof answer === 'object' && answer !== null && 'reason' in answer && typeof answer.reason === 'string' ? answer.reason.slice(0, 300) : ''), () => '');
      throw new Error(`Game activation answered ${response.status}${reason === '' ? '' : `: ${reason}`}`);
    }
    const value = v.parse(UploadActivationAckSchema, JSON.parse(new TextDecoder().decode(await readCapped(response, 64_000))));
    if (value.uploadId !== notice.uploadId || value.hash !== notice.hash || !new Set([notice.slug]).has(value.slug) || value.channel !== channel || value.build !== build || (value.place ?? true) !== (notice.place ?? true) || (notice.place !== false && value.instances.length === 0)) throw new Error('Game acknowledged another activation');
  }};
}
/** Published notices remain in the API until every required real game receiver agrees. */
export function activationDelivery(api: CookApi, game: GameActivationClient, log: (line: string) => void = (): void => undefined): {readonly sweep: () => Promise<void>; readonly idle: () => Promise<void>} {
  const pending = new Map<string, Promise<void>>();
  const deliver = async (notice: ActivationNotice): Promise<void> => {
    try {
      const channels = notice.channels.filter((channel): channel is 'staging' | 'production' => channel !== 'preview');
      for (const channel of channels) {
        try {await game.activate(notice, channel);}
        catch (error) {throw new Error(`${channel === 'staging' ? '' : `${channel}: `}${error instanceof Error ? error.message : String(error)}`, {cause: error});}
      }
      await api.acknowledge(notice, channels);
    } catch (error) {log(`upload ${notice.uploadId}: game acknowledgement waiting: ${error instanceof Error ? error.message : 'acknowledgement failed'}`);}
  };
  return {
    sweep: async () => {
      for await (const notice of api.activations()) {
        if (pending.has(notice.uploadId)) continue;
        const work = deliver(notice).finally(() => {pending.delete(notice.uploadId);}); pending.set(notice.uploadId, work);
      }
    },
    idle: async () => {await Promise.all(pending.values());},
  };
}
