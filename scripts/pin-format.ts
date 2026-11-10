/** J233: Template 2 is published in the frozen format dependency. This reads
 * that installed product without a producer checkout, cook or network. */
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {writeTar} from '@wildshard/format/tar';

interface FormatTemplate {
  readonly pin: {readonly slug: string; readonly revision: number; readonly hash: string; readonly bytes: number};
  readonly bytes: Uint8Array;
  readonly source: {readonly kind: string; readonly path: string; readonly indexHash: string};
}
export function formatTemplate(slug: string): FormatTemplate {
  if (slug !== 'blender-template') throw new Error(`No format dependency product: ${slug}`);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@wildshard/format/outputIndex'))), '../..');
  const root = join(packageRoot, 'corpus/handwritten'), files = new Map<string, Uint8Array>();
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
  if (indexBytes === undefined) throw new Error('Format dependency has no Template 2 index');
  const index = parseOutputIndex(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(indexBytes)));
  if (index.identity.slug !== slug) throw new Error('Format dependency contains another product');
  const bytes = writeTar(files), hash = createHash('sha256').update(bytes).digest('hex');
  return {pin: {slug, revision: index.identity.revision, hash, bytes: bytes.length}, bytes,
    source: {kind: 'format-dependency', path: '@wildshard/format/corpus/handwritten', indexHash: createHash('sha256').update(indexBytes).digest('hex')}};
}
