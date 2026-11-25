/** J233: a template product is published in the frozen format dependency. This
 * reads that installed product without a producer checkout, cook or network.
 * J434 retired the handwritten Template 2 product; Brasscap Mesa is the one left.
 * SHARD-SOURCE SS4: its folder is `corpus/exports/brasscap-mesa`, shard-format's
 * export of a pinned shard-brasscap commit (built by `wildshard build`, pinned
 * by `corpus/exports/brasscap-mesa.pin.json`), not a hand-written source. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {checkEngineFloor} from '../src/cook/game/engineFloor';
import {readTar, writeTar} from '@wildshard/format/tar';
import { saveRevision } from '../src/shared/game/shardfile/saveRevision';

interface FormatTemplate {
  readonly pin: {readonly slug: string; readonly revision: number; readonly hash: string; readonly bytes: number};
  readonly bytes: Uint8Array;
  readonly source: {readonly kind: string; readonly path: string; readonly indexHash: string};
}
const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@wildshard/format/outputIndex'))), '../..');
/**
 * Format 0.74.0 (J506) re-exported Brasscap with the world GLBs over the corpus's 1 MB blob cap left out (its pin's
 * `omitted.files`), so `corpus/exports/brasscap-mesa` is no whole shard file then; the whole SS3 export it replaced
 * ships as `corpus/legacy/brasscap-mesa-ss3`. The product is the whole one, so a re-export can't strand a pin again.
 */
function wholeBrasscap(): string | undefined {
  const current = 'corpus/exports/brasscap-mesa', legacy = 'corpus/legacy/brasscap-mesa-ss3';
  const pin = JSON.parse(readFileSync(join(packageRoot, `${current}.pin.json`), 'utf8')) as {readonly omitted?: {readonly files?: readonly unknown[]}};
  if ((pin.omitted?.files?.length ?? 0) === 0) return current;
  // QA 11-24 row 70: format 0.79 deleted the legacy copy (J507), so from 0.79 the format ships no whole Brasscap.
  return existsSync(join(packageRoot, legacy, 'shard.json')) ? legacy : undefined;
}
const whole = wholeBrasscap();
/** Each whole product the format dependency ships, by slug: its folder under the package root. None from format 0.79. */
const products: Record<string, string> = whole === undefined ? {} : {'brasscap-mesa': whole};
export const FORMAT_PRODUCTS: Readonly<Record<string, string>> = Object.freeze(products);

/** A whole Brasscap Mesa for tests and proofs: the format's copy while it ships one whole, else the tracked pin's shard
 * file by hash from the pins cache (`pnpm pins` fills it; J507: a live pin by slug, never a stored zone). */
export function wholeBrasscapProduct(root = process.cwd()): FormatTemplate {
  if (Object.hasOwn(FORMAT_PRODUCTS, 'brasscap-mesa')) return formatTemplate('brasscap-mesa');
  const tracked = JSON.parse(readFileSync(join(root, 'test/pins/shardfiles.json'), 'utf8')) as {readonly shards: readonly FormatTemplate['pin'][]};
  const pin = tracked.shards.find(row => row.slug === 'brasscap-mesa');
  if (pin === undefined) throw new Error('No tracked brasscap-mesa pin');
  const {WILDSHARD_PIN_CACHE: cache} = process.env;
  const file = join(cache ?? resolve(homedir(), '.cache/wildshard/pins'), `${pin.hash}.tar`);
  if (!existsSync(file)) throw new Error(`No cached brasscap-mesa shard file ${pin.hash}: run pnpm pins`);
  const bytes = new Uint8Array(readFileSync(file));
  if (createHash('sha256').update(bytes).digest('hex') !== pin.hash) throw new Error(`Cached brasscap-mesa shard file ${pin.hash} does not match its pin`);
  const indexBytes = readTar(bytes).get('shard.json');
  if (indexBytes === undefined) throw new Error('Pinned brasscap-mesa has no index');
  return {pin, bytes, source: {kind: 'pin-cache', path: file, indexHash: createHash('sha256').update(indexBytes).digest('hex')}};
}
export function formatTemplate(slug: string): FormatTemplate {
  const folder = Object.hasOwn(FORMAT_PRODUCTS, slug) ? FORMAT_PRODUCTS[slug] : undefined;
  if (folder === undefined) throw new Error(`No format dependency product: ${slug}`);
  const root = join(packageRoot, folder), files = new Map<string, Uint8Array>();
  const visit = (directory: string, prefix = ''): void => {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${name}/`);
      else if (entry.isFile()) files.set(name, readFileSync(path));
      else throw new Error(`Format product contains a non-regular entry: ${name}`);
    }
  };
  visit(root);
  const indexBytes = files.get('shard.json');
  if (indexBytes === undefined) throw new Error(`Format dependency has no ${slug} index`);
  const index = parseOutputIndex(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(indexBytes)));
  if (index.identity.slug !== slug) throw new Error('Format dependency contains another product');
  checkEngineFloor(index);
  const bytes = writeTar(files), hash = createHash('sha256').update(bytes).digest('hex');
  return {pin: {slug, revision: saveRevision(index.identity), hash, bytes: bytes.length}, bytes,
    source: {kind: 'format-dependency', path: `@wildshard/format/${folder}`, indexHash: createHash('sha256').update(indexBytes).digest('hex')}};
}
