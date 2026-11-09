// @vitest-environment happy-dom
// Outside hook discovery: real Player, real socket door, cooked Driftwood and disk.
// oxlint-disable-next-line import/no-nodejs-modules -- The proof owns its log directory.
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the operator's real table CLI.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch is supplied by the proof operator.
import {join} from 'node:path';
import {WebSocket as RawSocket} from 'ws';
import {Vector3} from 'three';
import {expect,test,vi} from 'vitest';
import {connectOnline} from '../src/client/host/online/shell';
import {NetPlayer} from '../src/client/engine/net/netPlayer';
import {PlaytestFile} from '../src/server/host/dedicated/playtest';
import {hitHistoryOf} from '../src/server/engine/combat/rewind';
import {seenRequest} from '../src/server/game/plugin/nativeRewind';
import type {NetRecord} from '../src/shared/engine/net/measurements';
import {roomBench} from './fixtures/dedicated/roomBench';
import {RoomBot,stillThumb} from './fixtures/dedicated/roomBot';
import {PageSide,loadCourseRapier} from './fixtures/motion-trace/parity';

test('two actual online seats report corrections and settled rewind to the operator file', {timeout:9000},async()=>{
 const base=process.env['WS_E7_PROOF_DIR'];if(base===undefined)throw new Error('Set WS_E7_PROOF_DIR to owned scratch');
 const directory=mkdtempSync(join(base,'record-')),lines:Record<string,unknown>[]=[],records:NetRecord[]=[];
 const file=new PlaytestFile({directory,build:'bench',tag:'sitting-proof',log:line=>{lines.push(line);}});
 vi.stubGlobal('WebSocket',RawSocket);
 const bench=await roomBench({playtest:row=>{file.append(row);}});
 const options={socket:bench.url,build:'bench',loaded:'driftwood-isle'},view={link:()=>undefined,countdown:()=>undefined,elsewhere:()=>undefined};
 const a=connectOnline({...options,identity:{player:'device:record-a',name:'Private name A'},record:{install:'anonymous-a',session:'session-a',tag:'sitting-proof',send:row=>{records.push(row);}}},view);
 const b=connectOnline({...options,identity:{player:'device:record-b',name:'Private name B'},record:{install:'anonymous-b',session:'session-b',tag:'sitting-proof',send:row=>{records.push(row);}}},view);
 const page=new PageSide(await loadCourseRapier(),{id:'e7-record',start:{x:0,z:0,yaw:0},ticks:0,intent:()=>({}),bodyAt:{x:30,z:30}});
 let net:NetPlayer|undefined;
 try{
  await Promise.all([a.booted,b.booted]);a.ready();b.ready();
  await vi.waitFor(()=>{expect(a.client.latest).not.toBeNull();expect(b.client.latest).not.toBeNull();},{timeout:3000,interval:10});
  net=new NetPlayer(a.client,page.player,page.physics);page.player.link=net;net.reconcile();
  const room=bench.room('driftwood-isle'),player=room?.bodyOf('device:record-a');if(room===undefined||player===undefined)throw new Error('No real player');
  for(let frame=0;frame<18;frame++){
   net.reconcile();net.step(stillThumb(frame));net.present(1/60);a.client.present();b.client.present();
   if(frame===5)player.position.x+=1;
   await new Promise(resolve=>{setTimeout(resolve,20);});
  }
  net.reconcile();
  expect(net.predictor.corrections).toBeGreaterThan(0);
  await vi.waitFor(()=>{expect(room.host.state.tick).toBeGreaterThan(25);},{timeout:1000,interval:10});
  const seen=hitHistoryOf(room.host)?.at(room.host.state.tick-20)?.find(row=>row.body.alive);
  if(seen===undefined)throw new Error('No admitted native target');
  const target=seen.body.combatActor();
  const hit=room.host.combat.hit(seenRequest({source:player.health,sourceTags:[],target,amount:1,point:seen.body.position.clone(),dir:new Vector3(1,0,0),attackSeq:1},{seen:seen.position.clone(),rewind:seen.rewind}));
  expect(hit).not.toBeNull();
  a.flushRecords();b.flushRecords();
  await vi.waitFor(()=>{expect(lines.some(line=>line['at']==='playtest.failed')).toBe(false);expect(readdirSync(directory).length).toBeGreaterThan(0);},{timeout:1000});
  await vi.waitFor(()=>{
   const durable=readdirSync(directory).flatMap(name=>readFileSync(join(directory,name),'utf8').trim().split('\n').map(line=>JSON.parse(line)));
   expect(durable.some(row=>row.kind==='hit'&&row.rewind.requested===20)).toBe(true);
  },{timeout:1000,interval:10});
  expect(await file.close()).toBe(true);
  const rows=readdirSync(directory).flatMap(name=>readFileSync(join(directory,name),'utf8').trim().split('\n').map(line=>JSON.parse(line)));
  expect(rows.some(row=>row.kind==='correction'&&row.session==='session-a'&&row.offset>0)).toBe(true);
  expect(rows.some(row=>row.kind==='hit'&&row.rewind.requested===20&&row.rewind.applied<=12&&row.rewind.clamped===true)).toBe(true);
  expect(records).toHaveLength(2);expect(records[0]?.corrections.foot).toBe(net.predictor.corrections);
  expect(records[0]?.frames).toBe(18);expect(records[0]?.fps).toBeGreaterThan(0);
  expect(records[1]?.frames).toBe(0); // A seated wire-only peer renders no game frames.
  expect(JSON.stringify({rows,records})).not.toMatch(/device:record|Private name/u);
  const exportFile=join(directory,'net-export.jsonl');writeFileSync(exportFile,[...records,...lines].map(row=>JSON.stringify(row)).join('\n'));
  const table=JSON.parse(execFileSync(process.execPath,['scripts/e7-playtest-table.mjs','--json',exportFile,...readdirSync(directory).filter(name=>name.startsWith('playtest-')).map(name=>join(directory,name))],{encoding:'utf8'}));
  expect(table.clients).toHaveLength(2);expect(table.rewind).toMatchObject({settledNetworkHits:1,clamped:1,clampedPercent:100,reviewJ127:true});
  expect(table.playtest).toMatchObject({complete:true,dropped:0});
 }finally{net?.dispose();a.dispose();b.dispose();page.dispose();await bench.close();await file.close();vi.unstubAllGlobals();rmSync(directory,{recursive:true,force:true});}
});

test('bad correction reports refuse and a failed operator disk keeps the real cell ticking',{timeout:9000},async()=>{
 const base=process.env['WS_E7_PROOF_DIR'];if(base===undefined)throw new Error('Set WS_E7_PROOF_DIR');
 const directory=mkdtempSync(join(base,'bad-disk-')),blocked=join(directory,'not-a-directory'),lines:Record<string,unknown>[]=[];
 writeFileSync(blocked,'occupied');
 const file=new PlaytestFile({directory:blocked,build:'bench',log:row=>{lines.push(row);}});
 vi.stubGlobal('WebSocket',RawSocket);
 const bench=await roomBench({playtest:row=>{file.append(row);}}),phone=new RoomBot(bench.url,'bench','device:disk-proof');
 try{
  expect(await phone.arrived(3000)).toBe(true);
  const send=(offset:number):void=>{phone.transport.control('playtest',new TextEncoder().encode(JSON.stringify({kind:'correction',session:'disk-proof',tick:phone.client.latest?.tick??0,mode:'foot',offset,snapped:false})).buffer);};
  send(1e9);await vi.waitFor(()=>{expect(bench.world.refusals['playtest-record']).toBe(1);},{timeout:1000,interval:10});
  send(.5);await vi.waitFor(()=>{expect(lines.some(row=>row['at']==='playtest.failed')).toBe(true);},{timeout:1000,interval:10});
  const before=phone.client.latest?.tick??0;
  await vi.waitFor(()=>{expect(phone.client.latest?.tick).toBeGreaterThan(before);},{timeout:1000,interval:10});
  expect(phone.closed).toBeNull();expect(bench.crashes).toEqual([]);expect(await file.close()).toBe(false);
 }finally{phone.drop();await bench.close();await file.close();vi.unstubAllGlobals();rmSync(directory,{recursive:true,force:true});}
});
