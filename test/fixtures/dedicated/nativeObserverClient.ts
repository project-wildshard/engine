import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'rolldown';
import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {PreparedObserver} from './releaseObserver';

/** Actual native entry, bundled exactly as the archived-source builder bundles it. */
export async function nativeObserverClient():Promise<PreparedObserver>{
 const sourceBuild=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const output=resolve(process.env['VITEST_TMP_ROOT']??'tmp/vitest',`native-observer-${randomUUID()}`);
 mkdirSync(output,{recursive:true});
 const require=createRequire(resolve('package.json'));
 const file=resolve(output,'client.mjs');
 await build({input:resolve('test/fixtures/dedicated/releaseObserverBot.ts'),platform:'node',
  plugins:[{name:'observer-native-client',resolveId(source){
   if(/^\.\/rapier_wasm3d(\.js)?$/u.test(source))return resolve('src/server/engine/physics/rapierBindings.ts');
   if(source==='@dimforge/rapier3d-simd')return require.resolve('@dimforge/rapier3d-simd/rapier.js');
   return null;
  }}],transform:{target:'node24',define:{__BUILD_ID__:JSON.stringify(sourceBuild)}},
  output:{file,format:'esm',codeSplitting:false}});
 const native=await import(pathToFileURL(file).href) as PreparedObserver;
 assert.equal(native.sourceBuild,sourceBuild);return {...native,dispose:()=>{rmSync(output,{recursive:true});return Promise.resolve();}};
}
