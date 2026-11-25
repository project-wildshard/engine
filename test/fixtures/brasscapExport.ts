// The format corpus's Brasscap Mesa export as a whole shard file folder. Format 0.74.0 (J506) re-exported it and its
// pin omits the world GLBs over the corpus's 1 MB blob cap, so `corpus/exports/brasscap-mesa` is no whole file any more;
// the whole SS3 export it replaced ships as `corpus/legacy/brasscap-mesa-ss3`. A test that admits or cooks the folder
// reads this, never a fixed path, so a re-export can't strand it again.
// oxlint-disable-next-line import/no-nodejs-modules -- The corpus is files in the installed format package.
import {existsSync,readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Corpus folders resolve under node_modules.
import {resolve} from 'node:path';

const corpus=resolve('node_modules/@wildshard/format/corpus');

/** The whole Brasscap export: the current one when its pin omits nothing, else the legacy SS3 export, else the live pin. */
export function wholeBrasscapExport():string{
 const pin:unknown=JSON.parse(readFileSync(resolve(corpus,'exports/brasscap-mesa.pin.json'),'utf8'));
 const omitted=typeof pin==='object'&&pin!==null&&'omitted' in pin&&typeof pin.omitted==='object'&&pin.omitted!==null&&'files' in pin.omitted&&Array.isArray(pin.omitted.files)?pin.omitted.files.length:0;
 const legacy=resolve(corpus,'legacy/brasscap-mesa-ss3');
 if(omitted===0)return resolve(corpus,'exports/brasscap-mesa');
 if(existsSync(resolve(legacy,'shard.json')))return legacy;
 // Format 0.79 deleted the legacy copy (J507: no stored zone in tests), so a whole Brasscap is its live pin by slug,
 // which `pnpm pins` installs (CI's test units install the pins first).
 return resolve('out/brasscap-mesa');
}
