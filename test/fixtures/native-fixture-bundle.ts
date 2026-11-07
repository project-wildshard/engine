// oxlint-disable-next-line import/no-nodejs-modules -- Transfer only verified native constructor cache members.
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Every member path is derived from an admitted constructor key.
import {dirname,resolve,sep} from 'node:path';
import * as v from 'valibot';
import {encodeCanonicalJson,hashImmutableBytes} from '../../src/shared/host/immutable';
import {recorderKey,recorderOutputHashes} from '../../scripts/native-recorder-cache.mjs';
import {nativeProgramJob,type NativeProgramSpec} from './native-program';

const digest=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const Identity=v.strictObject({sha:v.pipe(v.string(),v.regex(/^[a-f0-9]{40}$/u)),
  run:v.pipe(v.string(),v.regex(/^[1-9][0-9]*$/u)),attempt:v.pipe(v.string(),v.regex(/^[1-9][0-9]*$/u)),
  node:v.string(),platform:v.string(),arch:v.string(),cwd:v.string()});
export type NativeFixtureIdentity=v.InferOutput<typeof Identity>;
const Member=v.strictObject({name:v.string(),hash:digest,bytes:v.pipe(v.number(),v.safeInteger(),v.minValue(1),v.maxValue(1<<26)),text:v.string()});
const Job=v.strictObject({id:v.string(),key:digest,task:v.unknown()});
const Archive=v.strictObject({schema:v.literal('native-fixture-cache/1'),identity:Identity,
  jobs:v.pipe(v.array(Job),v.minLength(1),v.maxLength(16)),members:v.pipe(v.array(Member),v.minLength(2),v.maxLength(32))});
const Bundle=v.strictObject({archive:Archive,hash:digest});
const receipt='.generation-receipt.json',encoder=new TextEncoder();
const hash=(text:string):string=>hashImmutableBytes(encoder.encode(text));
const canonical=encodeCanonicalJson;
const plans=(specs:readonly NativeProgramSpec[])=>specs.map(spec=>{
  const plan=nativeProgramJob(spec);
  return {...plan,key:recorderKey(plan.root,plan.job,{inputHashes:plan.memo})};
});

/** Bind one exact CI attempt to its real native host. No foreign source or host can restore. */
export function nativeFixtureIdentity(input:Pick<NativeFixtureIdentity,'sha'|'run'|'attempt'>):NativeFixtureIdentity {
  return v.parse(Identity,{...input,node:process.version,platform:process.platform,arch:process.arch,cwd:resolve('.')});
}

function checkedReceipt(text:string,key:string,files:Record<string,string>):void {
  const actual:unknown=JSON.parse(text);
  if(canonical(actual)!==canonical({schema:'generation-cache/1',key,files}))throw new Error('Native fixture output receipt differs');
}
function safeParents(path:string):void {
  for(let parent=resolve(path);;parent=dirname(parent)){
    if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw new Error('Native fixture path is a symlink');
    if(dirname(parent)===parent)break;
  }
}

/** Archive original constructor text and native cache receipts; never a test result or mutable game state. */
export function packNativeFixtures(identity:NativeFixtureIdentity,specs:readonly NativeProgramSpec[],cache:string):string {
  const expected=plans(specs),members:v.InferOutput<typeof Member>[]=[];
  for(const plan of expected){
    const directory=resolve(cache,plan.job.id,plan.key);safeParents(directory);
    const hashes=recorderOutputHashes(directory,plan.job.outputs);
    const saved=readFileSync(resolve(directory,receipt),'utf8');checkedReceipt(saved,plan.key,hashes);
    for(const file of [...plan.job.outputs,receipt]){
      const path=resolve(directory,file);if(!lstatSync(path).isFile())throw new Error('Native fixture member is not regular');
      const bytes=readFileSync(path),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(encoder.encode(text).byteLength!==bytes.byteLength)throw new Error('Native fixture member is not exact UTF-8');
      members.push({name:`${plan.job.id}/${plan.key}/${file}`,bytes:bytes.byteLength,hash:hashImmutableBytes(bytes),text});
    }
  }
  const archive=v.parse(Archive,{schema:'native-fixture-cache/1',identity,
    jobs:expected.map(plan=>({id:plan.job.id,key:plan.key,task:plan.job})),members});
  return JSON.stringify({archive,hash:hash(canonical(archive))});
}

/** Validate all provenance and member bytes before creating a destination. Missing or stale data refuses. */
export function restoreNativeFixtures(wire:string,identity:NativeFixtureIdentity,specs:readonly NativeProgramSpec[],cache:string):void {
  const bundle=v.parse(Bundle,JSON.parse(wire));
  if(hash(canonical(bundle.archive))!==bundle.hash)throw new Error('Native fixture archive checksum differs');
  if(canonical(bundle.archive.identity)!==canonical(v.parse(Identity,identity)))throw new Error('Native fixture source/run/attempt/host differs');
  const expected=plans(specs),jobs=expected.map(plan=>({id:plan.job.id,key:plan.key,task:plan.job}));
  if(canonical(bundle.archive.jobs)!==canonical(jobs))throw new Error('Native fixture source/tool/host key differs');
  const members=new Map(bundle.archive.members.map(member=>[member.name,member]));
  const names=expected.flatMap(plan=>[...plan.job.outputs,receipt].map(file=>`${plan.job.id}/${plan.key}/${file}`));
  if(new Set(names).size!==names.length||members.size!==bundle.archive.members.length||members.size!==names.length
    ||names.some(name=>!members.has(name)))throw new Error('Native fixture member inventory differs');
  for(const member of members.values())if(encoder.encode(member.text).byteLength!==member.bytes||hash(member.text)!==member.hash)
    throw new Error('Native fixture member checksum differs');
  for(const plan of expected){
    const prefix=`${plan.job.id}/${plan.key}/`,files=Object.fromEntries(plan.job.outputs.map(file=>{
      const member=members.get(prefix+file);if(member===undefined)throw new Error('Missing native fixture output');return [file,member.hash];
    }));
    const saved=members.get(prefix+receipt);if(saved===undefined)throw new Error('Missing native fixture receipt');
    checkedReceipt(saved.text,plan.key,files);
  }
  const destination=resolve(cache);safeParents(destination);
  if(existsSync(destination))throw new Error('Native fixture destination already exists');
  mkdirSync(dirname(destination),{recursive:true});mkdirSync(destination);
  for(const member of members.values()){
    const target=resolve(destination,member.name);
    if(!target.startsWith(destination+sep))throw new Error('Native fixture member escaped destination');
    mkdirSync(dirname(target),{recursive:true});writeFileSync(target,member.text,{flag:'wx'});
  }
  // Run the original regular-file and digest reader over every restored output.
  for(const plan of expected){
    const directory=resolve(destination,plan.job.id,plan.key),files=recorderOutputHashes(directory,plan.job.outputs);
    checkedReceipt(readFileSync(resolve(directory,receipt),'utf8'),plan.key,files);
  }
}
