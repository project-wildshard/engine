// Keep real compiler execution in Node, independent of the test's DOM realm.
// oxlint-disable-next-line import/no-nodejs-modules -- Read only the compiler request supplied by this fixture's parent.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve Maps, typed arrays and signed zero over the native fixture boundary.
import { deserialize, serialize } from 'node:v8';

const request = deserialize(readFileSync(0));
if (!Array.isArray(request.args)) throw new Error('Invalid native fixture compiler arguments');
let result;
switch (request.method) {
  case 'compileScript': result = await (await import('../../src/sharddev/bake/compileScript.ts')).compileScript(...request.args); break;
  case 'compileScriptV2': result = await (await import('../../src/sharddev/bake/compileScriptV2.ts')).compileScriptV2(...request.args); break;
  case 'compileDecisionRows': result = await (await import('../../src/sharddev/buildDecisionScripts.ts')).compileDecisionScripts(...request.args); break;
  case 'compileDecisionScripts': result = await (await import('../../src/sharddev/buildDecisionScripts.ts')).compileDeclaredDecisionScripts(...request.args); break;
  default: throw new Error('Invalid native fixture compiler method');
}
process.stdout.write(serialize(result));
