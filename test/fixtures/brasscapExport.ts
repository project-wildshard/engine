// The whole Brasscap Mesa shard file folder. Format 0.74.0 (J506) re-exported `corpus/exports/brasscap-mesa` and its pin
// omits the world GLBs over the corpus's 1 MB blob cap, and format 0.79.0 (f3863be, J507) dropped the whole legacy SS3
// copy, so when the export omits files this is Brasscap's live engine pin, read by slug (FORMAT-PRUNE FP30). A test that
// admits or cooks the folder reads this, never a fixed path, so a re-export can't strand it again.
// oxlint-disable-next-line import/no-nodejs-modules -- The corpus is files in the installed format package.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Corpus folders resolve under node_modules.
import {resolve} from 'node:path';
import {builtFolder} from '../../src/test/game/builtFolder';

const corpus=resolve('node_modules/@wildshard/format/corpus');

/** The whole Brasscap product: the format's export when its pin omits nothing, else the live engine pin. */
export function wholeBrasscapExport():string{
 const pin:unknown=JSON.parse(readFileSync(resolve(corpus,'exports/brasscap-mesa.pin.json'),'utf8'));
 const omitted=typeof pin==='object'&&pin!==null&&'omitted' in pin&&typeof pin.omitted==='object'&&pin.omitted!==null&&'files' in pin.omitted&&Array.isArray(pin.omitted.files)?pin.omitted.files.length:0;
 return omitted>0?builtFolder('brasscap-mesa'):resolve(corpus,'exports/brasscap-mesa');
}
