// oxlint-disable-next-line import/no-nodejs-modules -- Compile the real fixture outside happy-dom in Node's native Response realm.
import {execFileSync} from 'node:child_process';
import * as v from 'valibot';
import {DRIFTWOOD_GUEST_ROWS,driftwoodGuestFile} from './driftwood-guest-programs';
import {hashImmutableBytes} from '../../src/shared/host/immutable';
import pineDeclaration from '../../src/shards/pine-hollow/data/director.json' with {type:'json'};

// GR8: Pine's product compiles its clock director (output.ts clockDirector); the fixture compiles the same source with
// the same compiler, in a plain Node child (pine-director-compile.mjs): a happy-dom importer's Response is not Node's, so
// the compiler's streaming Wasm read refused it and the suite collected no cases (chapter-wake-page, CI 973)
function pine(){
  const compiled=v.parse(v.strictObject({module:v.string(),bytes:v.string()}),JSON.parse(execFileSync(process.execPath,
    ['--experimental-transform-types','--import','./scripts/bake-loader.mjs','test/fixtures/pine-director-compile.mjs'],{encoding:'utf8',maxBuffer:1<<26})));
  const bytes=Uint8Array.from(Buffer.from(compiled.bytes,'base64'));
  if(hashImmutableBytes(bytes)!==compiled.module||compiled.module!==pineDeclaration.module)throw new Error('Pine clock module differs from its declaration');
  return {bytes,module:compiled.module};
}
export const pineDirector=pine();
export const driftwoodDirector={module:DRIFTWOOD_GUEST_ROWS.director.module,bytes:driftwoodGuestFile(`assets/${DRIFTWOOD_GUEST_ROWS.director.module}`)};
