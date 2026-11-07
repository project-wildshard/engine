// Required input publication for native tests; no test outcome is transferred.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {nativeProgramFixture} from '../test/fixtures/native-program.ts';
import {nalatiNativeProgramSpec} from '../test/fixtures/nalati-native-program.ts';
import {NALATI_NATIVE_ASSEMBLY_SPEC} from '../test/fixtures/nalati-native-assembly.ts';
import {NALATI_NATIVE_BOOT_SPEC} from '../test/fixtures/nalati-native-boot.ts';
import {nativeOracleProgramSpec} from '../test/fixtures/native-oracle.ts';
import {pineNativeOracleSpec} from '../test/fixtures/pine-native-oracle-spec.ts';
import {nativeFixtureIdentity,packNativeFixtures,restoreNativeFixtures} from '../test/fixtures/native-fixture-bundle.ts';

const [mode,cachePath,...extra]=process.argv.slice(2);
if(extra.length>0||(mode==='build'&&cachePath!==undefined))throw new Error('Unexpected native fixture arguments');
if(mode!=='build'&&mode!=='restore')throw new Error('Expected native fixtures build or restore');
const {GITHUB_SHA:sha='',GITHUB_RUN_ID:run='',GITHUB_RUN_ATTEMPT:attempt='',GITHUB_REPOSITORY:repo=''}=process.env;
if(repo!=='project-wildshard/engine'||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sha)
  throw new Error('Native fixture checkout identity differs');
const identity=nativeFixtureIdentity({sha,run,attempt});
const names=/** @type {const} */ (['kokpar','titan','riding','charge','geography','view']);
const specs=[...names.map(name=>nalatiNativeProgramSpec(name)),
  nativeOracleProgramSpec(NALATI_NATIVE_ASSEMBLY_SPEC),nativeOracleProgramSpec(NALATI_NATIVE_BOOT_SPEC),
  nativeOracleProgramSpec(pineNativeOracleSpec())];
const cache=resolve(cachePath??'.cache/native-fixtures'),archive='tmp/ci-native-fixtures/native-fixtures.bundle.json';
if(!cache.startsWith(`${resolve('.')}/`))throw new Error('Native fixture cache must stay inside the checkout');
if(mode==='build'){
  if(process.env.WS_FIXTURE_SNAPSHOTS||process.env.WS_FIXTURE_SNAPSHOT_WRITE)throw new Error('Native producer must execute original constructors');
  process.env.WS_NALATI_NATIVE_CACHE=cache;
  for(const spec of specs)await nativeProgramFixture({...spec,cacheDir:cache});
  mkdirSync('tmp/ci-native-fixtures',{recursive:true});
  writeFileSync(archive,packNativeFixtures(identity,specs,cache),{flag:'wx'});
}else{
  const bytes=readFileSync(archive);if(bytes.byteLength>256_000_000)throw new Error('Native fixture archive exceeds bounded transfer');
  restoreNativeFixtures(new TextDecoder('utf-8',{fatal:true}).decode(bytes),identity,specs,cache);
}
console.info(JSON.stringify({nativeFixtures:mode,sha,run,attempt,constructors:specs.length,cache}));
