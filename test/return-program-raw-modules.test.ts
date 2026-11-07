import {weatherRaw,weatherWitness,weatherModuleBytes,nightParameters} from './fixtures/weatherInlineWitness';
import {Rng} from '../src/shared/engine/core/rng';
import {parseReturnProjectionV2} from '@wildshard/format/returnProjectionV2';
import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {ReturnProjectionV2} from '../src/shared/game/population/returnProjectionV2';
import type {ReturnModuleRow} from '@wildshard/format/scriptContract';
import {titanPrograms as programs} from './fixtures/titanInlineWitness';

function fixture(){
  const row=structuredClone(programs.attack),artifact=parseReturnProjectionV2(row.v2).artifact;
  const bytes=Uint8Array.from(atob(row.v2.bytes),value=>value.codePointAt(0)??0);
  const assets=new Map([[artifact.hash,bytes]]);
  const contract={id:'fixture.projection',module:`blobs/wasm/${artifact.hash}.wasm`,side:'sim' as const,abi:2 as const,
    lane:'project' as const,pages:artifact.pages,ioBytes:artifact.ioBytes,compilerRevision:artifact.compilerRevision,admissionRevision:artifact.admissionRevision};
  row.v2.bytes='';
  return {row,assets,contract,bytes};
}

test('the original map lends raw projections to the real owner and its children only',()=>{
  const f=fixture(),owner=new Scope('raw.owner'),child=owner.child('construction'),other=new Scope('raw.other');
  try{
    expect(()=>ReturnProgram.page(f.row,owner)).toThrow('raw return module loan');
    ReturnProgram.lendModules(owner,f.assets,[f.contract]);
    const first=ReturnProgram.page(f.row,child);
    expect(ReturnProgram.page(structuredClone(f.row),child)).toBe(first);
    expect(first.project('bossClamp',{fullHp:100,share:.3})).toEqual({hp:30});
    expect(()=>ReturnProgram.page(f.row,other)).toThrow('raw return module loan');
    expect(()=>ReturnProgram.page(f.row)).toThrow('raw return module loan');
    expect(()=>new ReturnProjectionV2(f.row.v2)).toThrow('raw return module loan');
    const retirement=owner.disposeSteps();retirement.next();
    expect(()=>first.project('bossClamp',{fullHp:100,share:.3})).toThrow('owner disposed');
    expect(()=>ReturnProgram.page(f.row,child)).toThrow('owner disposed');
    for(const _ of retirement){/* finish the original teardown */}
  }finally{owner.dispose();other.dispose();}
});

test('raw admission refuses foreign bytes, incomplete contracts and executable rows',()=>{
  const f=fixture(),owner=new Scope('raw.refusals');
  try{
    expect(()=>ReturnProgram.lendModules(owner,new Map([[f.contract.module,f.bytes]]),[f.contract])).toThrow('hash mismatch');
    expect(()=>ReturnProgram.lendModules(owner,new Map([[f.row.v2.artifact.hash,new Uint8Array([0])]]),[f.contract])).toThrow();
    expect(()=>ReturnProgram.lendModules(owner,f.assets,[{...f.contract,pages:f.contract.pages+1}])).toThrow();
    expect(()=>ReturnProgram.lendModules(owner,f.assets,[{...f.contract,ioBytes:f.contract.ioBytes+64}])).toThrow();
    let called=0;
    const hostile:ReturnModuleRow={...f.contract,get module(){called++;return f.contract.module;}};
    expect(()=>ReturnProgram.lendModules(owner,f.assets,[hostile])).toThrow();expect(called).toBe(0);
    ReturnProgram.lendModules(owner,f.assets,[f.contract]);
    expect(()=>ReturnProgram.lendModules(owner,new Map(f.assets),[f.contract])).toThrow('loan changed');
    const altered=structuredClone(f.row);altered.v2.artifact.ioBytes+=64;
    expect(()=>ReturnProgram.page(altered,owner)).toThrow();
  }finally{owner.dispose();}
});

test('raw lookup uses the original concrete map without invoking an overridden getter',()=>{
  const f=fixture(),owner=new Scope('raw.map');
  const get=vi.spyOn(f.assets,'get').mockImplementation(()=>{throw new Error('executable map getter');});
  try{
    ReturnProgram.lendModules(owner,f.assets,[f.contract]);
    expect(ReturnProgram.page(f.row,owner).project('bossClamp',{fullHp:20,share:.5})).toEqual({hp:10});
    expect(get).not.toHaveBeenCalled();
    f.assets.set(f.contract.module,new Uint8Array([0]));
    f.assets.set(f.row.v2.artifact.hash,new Uint8Array([0]));
    expect(()=>ReturnProgram.page(f.row,owner)).toThrow('hash mismatch');
  }finally{get.mockRestore();owner.dispose();}
});

test('inline descriptors keep their original admission and owner cache',()=>{
  const owner=new Scope('raw.inline');
  try{
    const first=ReturnProgram.page(programs.attack,owner);
    expect(ReturnProgram.page(programs.attack,owner)).toBe(first);
    expect(first.project('bossClamp',{fullHp:100,share:.3})).toEqual({hp:30});
    const bad=structuredClone(programs.attack);bad.v2.bytes='';
    expect(()=>ReturnProgram.page(bad,owner)).toThrow('raw return module loan');
  }finally{owner.dispose();}
});

test('raw ABI1 weather keeps its module loan, outputs, stream and owner',()=>{
  const owner=new Scope('raw.weather'),other=new Scope('raw.weather.other');
  const hash=weatherRaw.script.module.slice('blobs/wasm/'.length,-'.wasm'.length);
  expect(weatherRaw.bytes).toBe('');
  const assets=new Map([[hash,weatherModuleBytes]]),row={script:weatherRaw.script,bytes:''};
  try{
    expect(()=>ReturnProgram.page(row,owner)).toThrow('raw return module loan');
    ReturnProgram.lendModules(owner,new Map(),[row.script]);
    expect(()=>ReturnProgram.page(row,owner)).toThrow('raw return module loan');
    const child=owner.child('construction');
    ReturnProgram.lendModules(child,assets,[row.script]);
    const raw=ReturnProgram.page(row,child),inline=ReturnProgram.page({script:weatherWitness.script,bytes:weatherWitness.bytes});
    const a=new Rng(503),b=new Rng(503);
    for(let i=0;i<100;i++){
      const input={...nightParameters,at:-1,px:i,pz:24};
      expect(raw.project('lineStart',input,a)).toEqual(inline.project('lineStart',input,b));
      expect(a.snapshot()).toEqual(b.snapshot());
    }
    expect(ReturnProgram.page(row,child)).toBe(raw);
    expect(()=>ReturnProgram.page(row,other)).toThrow('raw return module loan');
    const bad=child.child('bad');
    expect(()=>ReturnProgram.lendModules(bad,new Map([[hash,new Uint8Array([0])]]),[row.script])).toThrow('hash mismatch');
    expect(()=>ReturnProgram.lendModules(bad,assets,[{...row.script,pages:2}])).toThrow();
    const retirement=owner.disposeSteps();retirement.next();
    expect(()=>raw.project('lineStart',{...nightParameters,at:-1,px:0,pz:24},a)).toThrow('owner disposed');
    for(const _ of retirement){/* finish the original lifetime */}
  }finally{owner.dispose();other.dispose();}
});

test('ABI1 retirement during a request refuses results and restores its original RNG',()=>{
  const owner=new Scope('raw.weather.inflight'),hash=weatherRaw.script.module.slice('blobs/wasm/'.length,-'.wasm'.length);
  const random=new Rng(503),before=random.snapshot(),next=random.next.bind(random);
  try{
    ReturnProgram.lendModules(owner,new Map([[hash,weatherModuleBytes]]),[weatherRaw.script]);
    const program=ReturnProgram.page({script:weatherRaw.script,bytes:''},owner);
    vi.spyOn(random,'next').mockImplementationOnce(()=>{const value=next();owner.dispose();return value;});
    expect(()=>program.project('lineStart',{...nightParameters,at:-1,px:0,pz:24},random)).toThrow('owner disposed');
    expect(random.snapshot()).toEqual(before);
  }finally{owner.dispose();}
});
