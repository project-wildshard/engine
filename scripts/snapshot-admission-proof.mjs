// Real product admission, independent restored worlds and hostile input; outside hooks.
// oxlint-disable-next-line import/no-unassigned-import -- Native simulation installs the portable table first.
import '../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder.ts';
import {createTrustedHeadlessResident} from '../src/server/host/headlessRuntime.ts';
import {loadRapier} from '../src/shared/engine/physics/rapier.ts';
import {admitSimSnapshotBytes,decodeSimSnapshotBytes,serializeSimSnapshot,snapshotSimHostBytes} from '../src/shared/engine/sim/snapshot.ts';
import {readBuiltShardfile} from './built-folder.mjs';
import {outputDescriptor} from '../src/shared/game/shardfile/outputDescriptor.ts';
import {installEngineStrings} from '../src/shared/engine/strings.ts';
import {ENGINE_CONTENT_STRINGS} from '../src/client/game/engineStrings.ts';

const started=performance.now(),owned=[];
installEngineStrings(ENGINE_CONTENT_STRINGS);
/** @param {()=>unknown} run */
const refusal=run=>{try{run();}catch(error){if(!(error instanceof Error))throw error;return [error.name,error.message];}throw new Error('Expected strict snapshot refusal');};
try{
 const directory=readBuiltShardfile(resolve('.'),'nalati-grasslands'),product=await loadHeadlessFolder(directory),rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
 const descriptor=outputDescriptor(product.shardfile);if(descriptor===undefined)throw new Error('Missing admitted product inventory');
 const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
 const preparation={shard:product.shardfile,product,assets,rapier};
 const live=await createTrustedHeadlessResident(preparation,undefined,{room:true});owned.push(live);
 for(let tick=0;tick<60;tick++)live.step([]);
 const saved=snapshotSimHostBytes(live.host),wire=serializeSimSnapshot(saved),admitted=admitSimSnapshotBytes(saved);
 assert.deepEqual(admitted,decodeSimSnapshotBytes(wire));assert.notEqual(admitted.physics.buffer,saved.physics.buffer);
 const originalByte=saved.physics[0];saved.physics[0]^=255;assert.equal(admitted.physics[0],originalByte);saved.physics[0]=originalByte;
 saved.flags.push('owned-only');assert.ok(!admitted.flags.includes('owned-only'));saved.flags.pop();
 const numeric={...saved,slots:{...saved.slots,scriptMemory:{...saved.slots.scriptMemory,probe:{zero:-0,positive:Infinity,negative:-Infinity}}}};
 assert.deepEqual(admitSimSnapshotBytes(numeric),decodeSimSnapshotBytes(serializeSimSnapshot(numeric)));
 const invalid=[];
 for(const kind of ['unknown','duplicate','nan','cycle','reserved','empty','non-byte','other-view']){
  const bad=structuredClone({...saved,physics:Uint8Array.of(1,2,3)});
  if(kind==='unknown')Reflect.set(bad,'unowned',1);
  if(kind==='duplicate')bad.flags.push('duplicate','duplicate');
  if(kind==='nan')bad.players[0].position[0]=Number.NaN;
  if(kind==='cycle')Reflect.set(bad.slots.scriptMemory,'cycle',bad.slots.scriptMemory);
  if(kind==='reserved')Reflect.set(bad.slots.scriptMemory,'reserved',{'$sim.number':'infinity'});
  if(kind==='empty')bad.physics=new Uint8Array();
  if(kind==='non-byte')Reflect.set(bad,'physics',[256]);
  if(kind==='other-view')Reflect.set(bad,'physics',new Uint16Array([1]));
  assert.deepEqual(refusal(()=>admitSimSnapshotBytes(bad)),refusal(()=>serializeSimSnapshot(bad)),kind);invalid.push(kind);
 }
 const control=await createTrustedHeadlessResident(preparation,wire,{room:true});owned.push(control);
 // The runtime caller's type still accepts the legacy array until its owner adopts
 // typed admission. This compatibility bridge belongs only to the proof.
 const restored=await createTrustedHeadlessResident(preparation,{...admitted,physics:Array.from(admitted.physics)},{room:true});owned.push(restored);
 for(let tick=0;tick<20;tick++){
  control.step([]);restored.step([]);
  assert.deepEqual(snapshotSimHostBytes(restored.host),snapshotSimHostBytes(control.host));
 }
 console.log(JSON.stringify({product:product.slug,nativeBytes:saved.physics.length,independentRestoredTicks:20,detached:true,numericBits:true,refusals:invalid,milliseconds:performance.now()-started}));
}finally{for(const resident of owned)resident.dispose();}
