import { array, object, string, number, parse } from 'valibot';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { frozenNalatiBytes, frozenNalatiJson } from './nalati';

const pins = parse(array(object({path: string(), bytes: number(), sha256: string()})), frozenNalatiJson('nalati-geography-files.json'));
const bank = frozenNalatiBytes('nalati-geography-original.bin');
const blocks = new Map<string, Uint8Array>();
let offset = 0;
for (const pin of pins) {
  if (!pin.path.endsWith('.bin')) continue;
  const bytes = bank.slice(offset, offset + pin.bytes);
  offset += pin.bytes;
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Frozen geography block differs: ${pin.path}`);
  blocks.set(pin.path.slice(pin.path.indexOf('/data/') + 1), bytes);
}
if (offset !== bank.length) throw new Error('Frozen geography extent differs');
export function frozenGeographyBlock(file: string): Uint8Array {
  const bytes = blocks.get(file);
  if (bytes === undefined) throw new Error(`Unknown frozen geography block: ${file}`);
  return bytes.slice();
}
export function frozenGeographyBlocks(): ReadonlyMap<string, Uint8Array> {
  return new Map([...blocks].map(([name, bytes]) => [name, bytes.slice()]));
}
