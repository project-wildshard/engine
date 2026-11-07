// oxlint-disable-next-line import/no-nodejs-modules -- The real shipped physics module owns prompt visibility.
import type { HeadlessCommand,HeadlessEffect } from '@wildshard/engine/host/tickProtocol';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { FigureGroupSchema } from '@wildshard/format/figures';
import { NpcDialogueRowSchema } from '@wildshard/format/npcs';
import { ChapterViewSchema } from '@wildshard/format/questPageComposition';
import { parseQuestData } from '@wildshard/format/quests';
import { parseChapterStoryPresentation } from '@wildshard/format/questStory';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { trustedLevel } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { nalatiPin } from './fixtures/engine-lift/pins';
import { installNalatiReadings } from './fixtures/nalati-verbs';
const content=v.parse(ChapterViewSchema,await nalatiPin.product.json('quests/content.json'));
const peopleRows=content.figures;
const chapters=await nalatiPin.product.json('quests/chapters.json');

test('the elder only grants his authored introduction when the real reading completes in reach',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const source=emptyShardfile({slug:'reading-proof',name:'Reading proof',author:'Test',revision:1,seed:1});
  const host=createSimHost(trustedLevel(source,{at:{x:0,y:0,z:0},yaw:0,speed:4.3},{size:500,height:0}),{rapier});
  let commands:HeadlessCommand[]=[];const effects:HeadlessEffect[]=[];
  const fixture=v.parse(v.object({figures:FigureGroupSchema,npcs:v.record(v.string(),NpcDialogueRowSchema)}),{figures:peopleRows,npcs:content.npcs});
  try{
    installNalatiReadings(host,{commands:()=>commands,emit:effect=>{effects.push(effect);}},parseQuestData(nalatiPin.product.shardfile.quests),fixture,parseChapterStoryPresentation(chapters));
    commands=[{kind:'script',actorId:'nalati.talk',value:0}];host.step();
    expect(host.flags.has('talked:elder')).toBe(false);expect(host.adapters.get('nalati.talk')?.snapshot()).toBeNull();
    leadPlayer(host).resetPose({x:86.6,y:0,z:219.5},0);host.step();
    expect(host.adapters.get('nalati.talk')?.snapshot()).not.toBeNull();expect(host.flags.has('talked:elder')).toBe(false);
    const reading=host.adapters.get('nalati.talk');if(reading===undefined)throw new Error('Missing actual reading owner');
    const saved=reading.snapshot();
    commands=[{kind:'script',actorId:'nalati.talk',value:-1}];host.step();
    expect(host.flags.has('talked:elder')).toBe(false);
    reading.restore(saved);expect(reading.snapshot()).toEqual(saved);expect(host.flags.has('talked:elder')).toBe(false);
    commands=[];leadPlayer(host).resetPose({x:0,y:0,z:0},0);host.step();
    expect(reading.snapshot()).toBeNull();expect(host.flags.has('talked:elder')).toBe(false);
    leadPlayer(host).resetPose({x:86.6,y:0,z:219.5},0);
    commands=[{kind:'script',actorId:'nalati.talk',value:0}];
    for(let tick=0;tick<64&&!host.flags.has('talked:elder');tick++)host.step();
    expect(host.flags.has('talked:elder')).toBe(true);
    expect(host.quests.find(row=>row.def.id==='tulpar')?.isStarted).toBe(true);
    expect(host.flags.has('tamed:horse')).toBe(false);expect(host.flags.has('won:kokpar')).toBe(false);
    expect(effects).toEqual([]);
  }finally{host.dispose();}
});

test('the moving child uses his live orbit prompt and restores its actual continuation',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const source=emptyShardfile({slug:'orbit-proof',name:'Orbit proof',author:'Test',revision:1,seed:1});
  const host=createSimHost(trustedLevel(source,{at:{x:0,y:0,z:0},yaw:0,speed:4.3},{size:500,height:0}),{rapier});
  let commands:HeadlessCommand[]=[];const effects:HeadlessEffect[]=[];
  const fixture=v.parse(v.object({figures:FigureGroupSchema,npcs:v.record(v.string(),NpcDialogueRowSchema)}),{figures:peopleRows,npcs:content.npcs});
  try{
    installNalatiReadings(host,{commands:()=>commands,emit:effect=>{effects.push(effect);}},parseQuestData(nalatiPin.product.shardfile.quests),fixture,parseChapterStoryPresentation(chapters));
    const figures=host.adapters.get('nalati.figures'),reading=host.adapters.get('nalati.talk');
    if(figures===undefined||reading===undefined)throw new Error('Missing actual camp owners');
    const saved=figures.snapshot();
    const initial=v.parse(v.array(v.object({id:v.string(),x:v.number(),z:v.number()})),saved).find(row=>row.id==='child');
    if(initial===undefined)throw new Error('Missing admitted child');
    for(let tick=0;tick<360;tick++)host.step();const advanced=figures.snapshot();
    expect(advanced).not.toEqual(saved);figures.restore(saved);
    for(let tick=0;tick<360;tick++)host.step();expect(figures.snapshot()).toEqual(advanced);
    const child=v.parse(v.array(v.object({id:v.string(),x:v.number(),z:v.number()})),advanced).find(row=>row.id==='child');
    if(child===undefined)throw new Error('Missing actual moving child');
    expect(()=>figures.restore([{id:'child',x:child.x,y:0,z:child.z,phase:Number.NaN,ring:0,idleYaw:0}])).toThrow();
    expect(figures.snapshot()).toEqual(advanced);
    expect(()=>figures.restore([{id:'foreign',x:child.x,y:0,z:child.z,phase:0,ring:0,idleYaw:0}])).toThrow('Moving speaker continuation differs');
    expect(figures.snapshot()).toEqual(advanced);
    leadPlayer(host).resetPose({x:initial.x,y:0,z:initial.z},0);commands=[{kind:'script',actorId:'nalati.talk',value:3}];host.step();
    expect(reading.snapshot()).toBeNull();
    leadPlayer(host).resetPose({x:child.x,y:0,z:child.z+1},0);host.step();
    expect(reading.snapshot()).toMatchObject({kind:'child'});
    const stopped=figures.snapshot();commands=[];for(let tick=0;tick<30;tick++)host.step();
    const xy=(input:unknown)=>v.parse(v.array(v.object({x:v.number(),z:v.number()})),input).map(row=>[row.x,row.z]);
    expect(xy(figures.snapshot())).toEqual(xy(stopped));
    commands=[{kind:'script',actorId:'nalati.talk',value:3}];
    for(let tick=0;tick<64&&reading.snapshot()!==null;tick++)host.step();
    expect(reading.snapshot()).toBeNull();expect(host.flags.has('talked:elder')).toBe(false);expect(effects).toEqual([]);
  }finally{host.dispose();}
});
