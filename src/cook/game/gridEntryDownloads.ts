// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {basename, join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {parseCompiledGridDirectory, type CompiledGridAddress} from '../../shared/game/grid/compiledStrips';

/** Exact original initial-page addresses, selected by the same three grid
 * catalogue switches. No mesh is rebuilt, widened or re-encoded here. */
export function gridEntryDownloads(root: string): Readonly<Record<string, Readonly<Record<string, readonly CompiledGridAddress[]>>>> {
  const folder = join(root, 'out/.app'), file = join(folder, 'grid-strip-index.json');
  if (!existsSync(file)) return {};
  const bytes = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(16 * 1024 * 1024));
  const hash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u));
  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const index = v.parse(v.object({geometry: v.exactOptional(v.object({directory: v.strictObject({url: v.pipe(v.string(), v.regex(/^\/assets\/grid-strip-book-[a-f0-9]{8}\.json$/u)), bytes, sha256: hash}), homes: v.array(v.string())}))}), input);
  if (index.geometry === undefined) return {};
  const address = index.geometry.directory, wire = readFileSync(join(folder, 'grid-strip-pages', basename(address.url)));
  if (wire.length !== address.bytes || createHash('sha256').update(wire).digest('hex') !== address.sha256) throw new Error('Grid entry directory differs from its address');
  const book = parseCompiledGridDirectory(JSON.parse(wire.toString('utf8')));
  const modes = v.parse(v.record(v.pipe(v.string(), v.regex(/^[01]{3}$/u)), hash), JSON.parse(readFileSync(join(folder, 'grid-strip-entry-modes.json'), 'utf8')) as unknown);
  const result: Record<string, Record<string, readonly CompiledGridAddress[]>> = {};
  for (const [mode, source] of Object.entries(modes)) {
    const homes: Record<string, readonly CompiledGridAddress[]> = {};
    for (const page of book.pages) if (page.source === source && !page.home.endsWith(':outer') && index.geometry.homes.includes(page.home)) {
      homes[page.home] = [address, page.header, page.body];
    }
    result[mode] = homes;
  }
  return result;
}
