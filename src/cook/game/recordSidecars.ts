/** SHARD-COMPAT SP1b3b: the record job. When the engine's renderer moves, every stored shard whose author preparation
 * names another renderer cooks `stale`. The box's cook may record each one again with the author's own recorder
 * (`wildshard prepare` over the shardfile's folder, headless WebKit, no network but the local page; the `prepare` port)
 * and keep the result as a sidecar beside the original (`<sidecars>/<hash>/<renderer>.tar`), never inside it. A canary
 * records first: unless it is equal to its author preparation (or a person accepted it), nothing else records. */
// oxlint-disable-next-line import/no-nodejs-modules -- The record job owns its scratch folders and the sidecar folder (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The record job owns its scratch folders and the sidecar folder (J28).
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The record job owns its scratch folders and the sidecar folder (J28).
import {dirname, join} from 'node:path';
import {readCookData, type CookData} from '@wildshard/format/cookData';
import {readTar} from '@wildshard/format/tar';
import {canaryLine, canaryOpens, canaryVerdict} from './cookCanary';
import {sidecarTar, type CookSidecar} from './cookSidecar';
import {openShardfile} from './shardCook';

/** One stored shardfile the job may record. */
export interface RecordInput {readonly slug: string; readonly hash: string; readonly tarball: Uint8Array}
/** What became of it: `recorded` wrote its sidecar; `current` and `kept` needed none (its author preparation is on this
 *  renderer, or it has a sidecar); `held` waits on the canary; `failed` keeps cooking stale. */
export interface RecordRow {readonly slug: string; readonly hash: string; readonly state: 'recorded' | 'current' | 'kept' | 'held' | 'failed'; readonly detail?: string}
export interface RecordPorts {
  /** The box cook's renderer fingerprint: the sidecar's name, and what the recorder must record on. */
  readonly renderer: string;
  readonly sidecars: string;
  /** Where each shard's folder is unpacked for the recorder; each is removed after its record. */
  readonly scratch: string;
  /** Record the preparation of the product folder in place (`wildshard prepare <folder>`). */
  readonly prepare: (folder: string) => Promise<void>;
  /** Canary recordings a person accepted, by the sha256 of their cook.json. */
  readonly accepted?: ReadonlySet<string>;
  readonly log: (line: string) => void;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const cookOf = (bytes: Uint8Array | undefined): CookData | undefined => {
  try { return bytes === undefined ? undefined : readCookData(JSON.parse(new TextDecoder().decode(bytes))); } catch { return undefined; }
};
const sidecarFile = (ports: RecordPorts, hash: string): string => join(ports.sidecars, hash, `${ports.renderer}.tar`);

/** The author's spec 3 preparation when it names another renderer; `undefined` when nothing needs recording. */
function staleAuthor(files: ReadonlyMap<string, Uint8Array>, renderer: string): CookData | undefined {
  const author = cookOf(files.get('cook.json'));
  return author?.version === 3 && author.renderer !== renderer ? author : undefined;
}

/** Unpack the shardfile's `files`, let the recorder prepare it, and keep what it recorded: its cook.json and every mount it names that the
 *  original lacks or holds differently. */
async function recorded(files: ReadonlyMap<string, Uint8Array>, ports: RecordPorts): Promise<CookSidecar> {
  mkdirSync(ports.scratch, {recursive: true});
  const folder = mkdtempSync(join(ports.scratch, 'record-'));
  try {
    for (const [path, bytes] of files) { const file = join(folder, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes); }
    await ports.prepare(folder);
    const cook = readFileSync(join(folder, 'cook.json')), data = cookOf(cook);
    if (data === undefined) throw new Error('the recorder left no readable cook.json');
    const mounts = new Map<string, Uint8Array>();
    for (const mount of data.mounts) {
      const bytes = readFileSync(join(folder, mount.path)), held = files.get(mount.path);
      if (held === undefined || sha256(held) !== sha256(bytes)) mounts.set(mount.path, bytes);
    }
    return {cook, mounts};
  } finally { rmSync(folder, {recursive: true, force: true}); }
}

/** Record one shard and keep its sidecar when the cook would take it; `canary` holds it to its author preparation first. */
async function recordOne(input: RecordInput, ports: RecordPorts, canary: boolean): Promise<RecordRow> {
  const head = {slug: input.slug, hash: input.hash};
  if (existsSync(sidecarFile(ports, input.hash))) return {...head, state: 'kept'};
  const files = new Map(readTar(input.tarball)), author = staleAuthor(files, ports.renderer);
  if (author === undefined) return {...head, state: 'current'};
  let sidecar: CookSidecar;
  try { sidecar = await recorded(files, ports); } catch (error) { return {...head, state: 'failed', detail: error instanceof Error ? error.message : String(error)}; }
  if (canary) {
    const verdict = canaryVerdict(author, cookOf(sidecar.cook) ?? author);
    ports.log(canaryLine(input.slug, verdict));
    if (!canaryOpens(verdict, ports.accepted ?? new Set(), sha256(sidecar.cook))) return {...head, state: 'held', detail: `canary differs (${sha256(sidecar.cook).slice(0, 12)})`};
  }
  const refused: string[] = [];
  const opened = openShardfile(input.tarball, {renderer: ports.renderer, sidecar, warn: line => { refused.push(line); }});
  if (opened.preparation !== 'cook') return {...head, state: 'failed', detail: refused.join('; ') || `opened ${opened.preparation}`};
  const file = sidecarFile(ports, input.hash), part = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), {recursive: true}); writeFileSync(part, sidecarTar(sidecar)); renameSync(part, file);
  return {...head, state: 'recorded'};
}

/** The job: the canary first; past it, every other shard in order. A held canary holds them all. */
export async function recordSidecars(canary: RecordInput, rest: readonly RecordInput[], ports: RecordPorts): Promise<readonly RecordRow[]> {
  const first = await recordOne(canary, ports, true);
  ports.log(`record ${canary.slug}: ${first.state}${first.detail === undefined ? '' : `: ${first.detail}`}`);
  if (first.state === 'held' || first.state === 'failed') {
    return [first, ...rest.map(input => ({slug: input.slug, hash: input.hash, state: 'held' as const, detail: `canary ${canary.slug} ${first.state}`}))];
  }
  const rows: RecordRow[] = [first];
  for (const input of rest) {
    const row = await recordOne(input, ports, false);
    ports.log(`record ${input.slug}: ${row.state}${row.detail === undefined ? '' : `: ${row.detail}`}`);
    rows.push(row);
  }
  return rows;
}
