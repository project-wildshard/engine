// ZONE-SNAPSHOTS ZS9 (J507): Pine Hollow's live contract catalogue (quests/contracts.json) with its decision guest inline.
import { parseContractCatalogue } from '@wildshard/format/contracts';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { liveJson, livePath } from './livePin';
const rows = parseContractCatalogue(liveJson('pine-hollow', 'quests/contracts.json'));
const script = parseDecisionScripts([rows.program?.script])[0];
if (rows.program === undefined || script === undefined) throw new Error('Pine declares no contract guest');
export const liveContracts = {...rows, program: {...rows.program, bytes: Buffer.from(livePath('pine-hollow', script.module)).toString('base64')}};
