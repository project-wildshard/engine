// oxlint-disable import/no-nodejs-modules, import/no-unassigned-import -- Explicit Node product proof; install simulation hooks before dynamic imports.
// SH-pine-1/4/5/6: explicit report-only regression, outside ordinary test
// discovery and hooks. Run with node --test.
import '../scripts/sim-node-loader.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {test} from 'node:test';

const {loadHeadlessFolder}=await import('../src/server/host/headlessFolder.ts');
const {openWorld}=await import('../src/server/host/openWorld.ts');
const {outputDescriptor,serverReadsFile}=await import('../src/shared/game/shardfile/outputDescriptor.ts');
const {loadRapier}=await import('../src/shared/engine/physics/rapier.ts');
const {ReturnProgram}=await import('../src/shared/game/population/returnProgram.ts');
const {HerdShelter}=await import('../src/server/game/population/shelter.ts');
const {populationRoster}=await import('../src/server/game/population/roster.ts');
const require=createRequire(import.meta.url),directory=resolve('out/pine-hollow');
const product=await loadHeadlessFolder(directory),shard=product.shardfile,descriptor=outputDescriptor(shard);
assert.ok(descriptor,'The real pinned product must admit');
const shelterRows=await product.json('actors/shelter.json');
const target=resolve(process.env.PINE_PROOF_DIR??'tmp/pine-shelter-contract');
assert.ok(target.startsWith(`${resolve('tmp')}/`));mkdirSync(target,{recursive:true});
const result={complete:false,pin:JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')).shards.find(row=>row.slug==='pine-hollow'),criteria:{}};
const retain=()=>{result.complete=Object.keys(result.criteria).length===3&&Object.values(result.criteria).every(row=>row.pass);writeFileSync(join(target,'receipt.json'),`${JSON.stringify(result,null,2)}\n`);};
retain();
async function criterion(name,run){
  await test(name,async()=>{
    const began=performance.now();
    try{const facts=await run();result.criteria[name]={pass:true,...facts};}
    catch(error){result.criteria[name]={pass:false,error:error.stack??String(error)};throw error;}
    finally{result.criteria[name].seconds=(performance.now()-began)/1000;retain();}
  });
}

await criterion('fresh Pine survives 60000 ordinary idle inputs',async()=>{
  const assets=new Map(descriptor.index.files.filter(file=>serverReadsFile(file,shard.terrain?.collider)&&(file.name===undefined||file.kind==='wasm'||file.kind==='tile'))
    .map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,readFileSync(join(directory,file.path))]));
  const rapier=await loadRapier(readFileSync(require.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));
  const world=await openWorld({shard,assets,product,rapier},{room:true});
  try{
    const owner=world.resident.host.adapters.get(shelterRows.step);assert.ok(owner,'The declared shelter continuation must be installed');
    let maxSheltered=0,firstShelterTick;
    for(let frame=1;frame<=60_000;frame++){
      world.resident.step([{kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:0}}]);
      if(frame%600===0){
        const sheltered=owner.snapshot().shelters.filter(row=>row?.spot!==null&&row?.spot!==undefined).length;
        if(sheltered>0)firstShelterTick??=frame;
        maxSheltered=Math.max(maxSheltered,sheltered);
      }
    }
    assert.equal(world.resident.host.state.tick,60_000);
    assert.ok(maxSheltered>0,'Natural rain must actually select shelter sites');
    return {inputs:60_000,worldTick:world.resident.host.state.tick,maxSheltered,firstShelterTick};
  }finally{world.dispose();}
});

await criterion('actual shelter guest selects later batches and keeps first ties',()=>{
  const rows=shelterRows;
  // The original shipped v1 bytes and declaration, through normal admission.
  // No compiler, guest double, fuel adjustment or projection interception.
  assert.equal(rows.program.v2,undefined);
  const hash=rows.program.script.module.slice('blobs/wasm/'.length,-'.wasm'.length);
  const file=descriptor.index.files.find(row=>row.hash===hash);assert.ok(file);
  const program=ReturnProgram.page({...rows.program,bytes:readFileSync(join(directory,file.path)).toString('base64')});
  const trees=Array.from({length:11},(_,i)=>({x:40+i,z:0,r:1,height:20,cover:0}));
  assert.ok(trees.every(tree=>tree.height>=rows.look.bigTree&&Math.hypot(tree.x,tree.z)<=rows.look.reach),'Every test tree must pass the actual shelter filters');
  trees[8]={x:6,z:8,r:1,height:50,cover:1};
  const select=()=>{
    const herd={kind:'deer',cx:0,cz:0,members:[]};
    const shelter=new HerdShelter({herds:[herd]},trees,rows.look,program);
    shelter.update(.1,rows.look.wet+.1);
    const spot=shelter.snapshot().shelters[0]?.spot;assert.ok(spot);
    return spot;
  };
  const later=select(),offset=1-(1+rows.look.clear)/10;
  assert.ok(Math.abs(later.x-6*offset)<1e-12);assert.ok(Math.abs(later.z-8*offset)<1e-12);
  trees[2]={x:-6,z:8,r:1,height:50,cover:1};
  const tied=select();assert.ok(Math.abs(tied.x+6*offset)<1e-12);assert.equal(tied.z,later.z);
  return {sites:trees.length,laterWinner:8,firstTiedWinner:2,later,tied};
});

await criterion('native roster admits authored variants absent from its initial draw',async()=>{
  const assets=new Map(descriptor.index.files.filter(file=>serverReadsFile(file,shard.terrain?.collider)&&(file.name===undefined||file.kind==='wasm'||file.kind==='tile'))
    .map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,readFileSync(join(directory,file.path))]));
  const rapier=await loadRapier(readFileSync(require.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));
  const world=await openWorld({shard,assets,product,rapier},{room:true});
  try{
    const host=world.resident.host,roster=populationRoster(host,shelterRows.roster);
    const before=[...host.entities.keys()];
    assert.ok([...host.entities.values()].every(body=>body.kind!=='bear'||body.variant!=='black-blaze'),'The regression must exercise a variant absent at boot');
    const body=roster.spawn('bear',100,100,0,'black-blaze');
    assert.equal(body.kind,'bear');assert.equal(body.variant,'black-blaze');assert.ok(body.alive&&body.hp>0);
    assert.equal(body.maxHp,220);assert.equal(body.label,'Black bear');assert.equal(body.rarity,'common');
    assert.equal(body.mods.speed,1);assert.equal(body.mods.chargeDamage,35);assert.equal(body.mods.relentless,false);
    assert.equal(host.entities.size,before.length+1);
    assert.deepEqual([...host.entities.keys()].slice(0,before.length),before,'A new draw preserves existing actor identities');
    return {kind:body.kind,variant:body.variant,entity:body.entityId,hp:body.hp};
  }finally{world.dispose();}
});
