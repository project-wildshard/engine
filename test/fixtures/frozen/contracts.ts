import { readFileSync } from 'node:fs';
import { parseContractCatalogue } from '@wildshard/format/contracts';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import pin from './contract-manifest.json' with { type: 'json' };
const bytes = new Uint8Array(readFileSync(new URL('./contract-catalogue.json', import.meta.url)));
if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error('Frozen contract catalogue differs');
export const frozenContracts = parseContractCatalogue(JSON.parse(new TextDecoder().decode(bytes)));
