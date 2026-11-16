// The stale-preparation fixture (J262, SP1a), shared by the in-process cook file and the cook worker file: the Template
// with its author preparation taken off, and the Template as `wildshard prepare` leaves it on a named renderer.
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the fixture's preparation bytes.
import {createHash} from 'node:crypto';
import {readCookData} from '@wildshard/format/cookData';
import {cookPreparationBytes} from '@wildshard/format/cookPreparation';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {readTar, writeTar} from '@wildshard/format/tar';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {folderTarball} from '../../src/cook/game/folderTarball';
import {builtFolder} from './engine-lift/folder';

export const digest = (bytes: Readonly<Uint8Array>): string => createHash('sha256').update(bytes).digest('hex');
export const json = (bytes: Uint8Array | undefined): unknown => JSON.parse(new TextDecoder().decode(bytes));
/** Template with no author preparation (sdk 0.2, a cook v1 of mounts only). Since D5-4 the pinned Template carries one, so
 *  it is taken off here: its program mount goes and the remaining mounts stay, as the shardfile was before `wildshard prepare`. */
export function unprepared(tar: Uint8Array): Uint8Array {
  const files = new Map(readTar(tar)), held = parseOutputIndex(json(files.get('shard.json')));
  if (held.sdk === '0.2') return tar;
  const programs = `/programs/${held.identity.slug}.json`, data = readCookData(json(files.get('cook.json')));
  for (const row of data.mounts) if (row.url === programs) files.delete(row.path);
  const cook = validationSourceBytes({version: 1, mounts: data.mounts.filter(row => row.url !== programs)});
  files.set('cook.json', cook);
  files.set('shard.json', validationSourceBytes({...held, sdk: '0.2', cook: {path: 'cook.json', hash: digest(cook), bytes: cook.length}}));
  return writeTar(files);
}
export const legacy = unprepared(folderTarball(builtFolder('_template')));
/** Two renderer fingerprints, neither this engine's: the cook is told which one it runs on. */
export const PREPARED = '7d1dd888'.padEnd(64, '0'), MOVED = '6d0a0a78'.padEnd(64, '0');

/** Template as `wildshard prepare` leaves it: sdk 0.3, a cook v3 preparation recorded on `renderer`, fence packs, a program mount. */
export function prepared(renderer: string, fenced = true): Map<string, Uint8Array> {
  const files = new Map(readTar(legacy)), held = parseOutputIndex(json(files.get('shard.json')));
  const old = readCookData(json(files.get('cook.json'))), slug = held.identity.slug;
  const program = validationSourceBytes({version: 2, build: 'stale-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]]});
  const asset = new TextEncoder().encode('a mounted fence read');
  files.set(`mounts/programs/${slug}.json`, program); files.set('mounts/assets/stale-proof.bin', asset);
  const mounts = [...old.mounts.filter(row => row.url !== `/programs/${slug}.json`),
    {url: `/programs/${slug}.json`, path: `mounts/programs/${slug}.json`, hash: digest(program), bytes: program.length},
    {url: '/assets/stale-proof.bin', path: 'mounts/assets/stale-proof.bin', hash: digest(asset), bytes: asset.length}];
  const index = parseOutputIndex({...held, sdk: '0.3'});
  const cook = validationSourceBytes({version: 3, renderer, mounts, packs: 'fence', fence: fenced ? [digest(asset)] : [], programs: json(program),
    inputHash: digest(cookPreparationBytes(index, mounts, renderer))});
  files.set('cook.json', cook);
  files.set('shard.json', validationSourceBytes({...index, cook: {path: 'cook.json', hash: digest(cook), bytes: cook.length}}));
  return files;
}
