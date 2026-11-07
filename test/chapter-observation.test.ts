import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exact pure report/refusal assertions do not enter a native tape.
import assert from 'node:assert/strict';
import type {HeadlessTapeReport} from '../src/shared/host/headlessTape';
import {packChapterReport,unpackChapterReport} from './fixtures/headless/chapterReportCodec';
import {Scope} from '../src/shared/engine/app/scope';
import {packChapterTaming,unpackChapterTaming,chapterObservationWire,installPackedChapterTaming,PACKED_CHAPTER_TAMING} from './fixtures/headless/chapterObservation';
import type {SimHost,SimStateAdapter,SimValue} from '../src/server/engine/sim';
// oxlint-disable-next-line import/no-nodejs-modules -- Construct an actual bounded decompression refusal, not a metadata-only substitute.
import {deflateSync,brotliCompressSync} from 'node:zlib';

test('complete observations round-trip every numeric bit and field within the unchanged byte boundary',()=>{
  const value={pose:Array.from({length:4000},(_,index)=>[index%2?0:-0,index%11,1.1234567890123457]),
    clock:{past:-Infinity,future:Infinity},text:'actual native owner',fields:{yaw:-0,health:100}};
  const raw=chapterObservationWire(value),wire=packChapterTaming(value);
  expect(wire.length).toBeLessThan(raw.length/2);expect(unpackChapterTaming(wire)).toStrictEqual(value);
  expect(Object.is((unpackChapterTaming(packChapterTaming(-0))),-0)).toBe(true);
  expect(()=>packChapterTaming({bad:Number.NaN})).toThrow('NaN');
  expect(()=>packChapterTaming('x'.repeat(1_000_001))).toThrow('byte bound');
});
test('foreign metadata, damaged data and decompression limits refuse without a fallback',()=>{
  const wire=packChapterTaming({all:[1,2,3],minus:-0}),value:unknown=JSON.parse(wire);
  if(value===null||typeof value!=='object')throw new Error('Missing fixture envelope');
  expect(()=>unpackChapterTaming(JSON.stringify({...value,owner:'foreign'}))).toThrow();
  expect(()=>unpackChapterTaming(JSON.stringify({...value,bytes:1}))).toThrow('byte count');
  expect(()=>unpackChapterTaming(JSON.stringify({...value,data:'@@@@'}))).toThrow();
  expect(()=>unpackChapterTaming(JSON.stringify({...value,bytes:1_000_001}))).toThrow();
  expect(()=>unpackChapterTaming(JSON.stringify({...value,extra:true}))).toThrow();
  const oversized=deflateSync(Buffer.alloc(1_000_001)).toString('base64');
  expect(()=>unpackChapterTaming(JSON.stringify({...value,bytes:1,data:oversized}))).toThrow();
});
test('the observation loan samples the same primary owner and restores without writing it',()=>{
  const scope=new Scope('chapter-observation'),adapters=new Map<string,SimStateAdapter>();let calls=0;
  let state:SimValue={phase:'bonded',pose:[0,-0,1]};
  const primary:SimStateAdapter={snapshot:()=>{calls++;return state;},restore:()=>{throw new Error('Observation cannot restore its primary owner');}};
  adapters.set('nalati.taming',primary);
  const host:Pick<SimHost,'scope'|'adapters'|'hasStep'|'onStep'>={scope,adapters,hasStep:id=>adapters.has(id),onStep:(id,_run,adapter)=>{
    if(adapter===undefined)throw new Error('Missing original loan');adapters.set(id,adapter);return ()=>{adapters.delete(id);};}};
  // The installer borrows only this concrete registry/scope surface.
  installPackedChapterTaming(host);const loan=adapters.get(PACKED_CHAPTER_TAMING);if(loan===undefined)throw new Error('Missing observation');
  try{
    const saved=loan.snapshot(),before=structuredClone(state);loan.restore(saved);expect(state).toStrictEqual(before);expect(calls).toBe(2);
    expect(()=>installPackedChapterTaming(host)).toThrow('unique');
    state={phase:'bonded',pose:[-0,4,9]};expect(unpackChapterTaming(loan.snapshot())).toStrictEqual(state);
    expect(()=>loan.restore(saved)).toThrow('differs');expect(state).toStrictEqual({phase:'bonded',pose:[-0,4,9]});
    adapters.set('nalati.taming',{snapshot:()=>null,restore:()=>undefined});expect(()=>loan.snapshot()).toThrow('replaced');
  }finally{scope.dispose();}
});

function report(owner:string,rawState:string):HeadlessTapeReport {
  return {version:1,ticks:1,observations:[{id:'codec-pure',tick:1,position:[-0,2,3],peakY:4,grounded:true,
    flags:['codec.synthetic'],quests:[],effects:[{kind:'hint',text:'codec only'}],adapters:[{id:owner,state:rawState}]}]};
}
function codecState(row:HeadlessTapeReport):string {
  const value=row.observations[0]?.adapters[0]?.state;if(value===undefined)throw new Error('Missing pure codec state');return value;
}
function object(value:unknown):value is Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function change(row:HeadlessTapeReport,edit:(wire:Record<string,unknown>)=>void):HeadlessTapeReport {
  const copy=structuredClone(row),wire:unknown=JSON.parse(codecState(copy));if(!object(wire))throw new Error('Missing encoded envelope');
  edit(wire);const adapter=copy.observations[0]?.adapters[0];if(adapter===undefined)throw new Error('Missing encoded owner');
  adapter.state=JSON.stringify(wire);return copy;
}
const pad='unchanged-é🦁'.repeat(4000),codecOwner='nalati.king-closed';
const baseReport=report(codecOwner,JSON.stringify({kind:'entered',pad,counter:1,nested:{x:-0,items:[1,2,3]}}));
const currentReport=report(codecOwner,JSON.stringify({kind:'entered',pad,counter:2,nested:{x:0,items:[1,4,3]}}));
const encodedReport=packChapterReport(currentReport,baseReport);
test('complete report deltas recover every original field',()=>{assert.ok(codecState(encodedReport).includes('deflate-patch'));assert.deepEqual(unpackChapterReport(encodedReport,baseReport),currentReport);});
test('report encoding does not mutate its basis or input',()=>{const original=`${chapterObservationWire(baseReport)}${chapterObservationWire(currentReport)}`;packChapterReport(currentReport,baseReport);assert.equal(`${chapterObservationWire(baseReport)}${chapterObservationWire(currentReport)}`,original);});
test('encoded report metadata is detached from its input',()=>{const copy=packChapterReport(currentReport,baseReport);copy.observations[0]?.flags.push('changed');assert.deepEqual(currentReport.observations[0]?.flags,['codec.synthetic']);});
test('a missing report basis refuses',()=>assert.throws(()=>unpackChapterReport(encodedReport),/basis/u));
test('a foreign report basis refuses',()=>assert.throws(()=>unpackChapterReport(encodedReport,currentReport),/basis/u));
test('a different encoded owner refuses',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{wire['owner']='nalati.chapter-taming';}),baseReport),/basis/u));
test('a false decoded byte count refuses',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{wire['bytes']=1;}),baseReport),/result/u));
test('a false complete result hash refuses',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{wire['result']='0'.repeat(64);}),baseReport),/result/u));
test('malformed report base64 refuses',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{wire['data']='not-base64';}),baseReport)));
test('foreign report envelope fields refuse',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{wire['extra']=true;}),baseReport)));
test('truncated report payloads refuse',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{
  if(typeof wire['data']!=='string')throw new Error('Missing encoded data');wire['data']=wire['data'].slice(0,-8);
}),baseReport)));
test('trailing compressed report bytes refuse',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{
  if(typeof wire['data']!=='string')throw new Error('Missing encoded data');wire['data']=Buffer.concat([Buffer.from(wire['data'],'base64'),Buffer.from('junk')]).toString('base64');
}),baseReport),/Trailing/u));
test('report inflation retains the original bounded output',()=>assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{
  wire['data']=deflateSync(Buffer.alloc(1_000_001,32),{level:1}).toString('base64');
}),baseReport)));
test('delta paths cannot traverse object prototypes',()=>{assert.throws(()=>unpackChapterReport(change(encodedReport,wire=>{
  wire['data']=deflateSync(Buffer.from(JSON.stringify([{path:['__proto__','polluted'],value:true}]))).toString('base64');
}),baseReport),/path/u);assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);});
test('duplicate report owners refuse',()=>{const copy=structuredClone(currentReport),adapter=copy.observations[0]?.adapters[0];if(adapter===undefined)throw new Error('Missing owner');copy.observations[0]?.adapters.push(adapter);assert.throws(()=>packChapterReport(copy,baseReport),/Duplicate/u);});
test('already encoded report inputs refuse',()=>assert.throws(()=>packChapterReport(encodedReport,baseReport),/expanded/u));
test('an encoded report cannot masquerade as an expanded basis',()=>assert.throws(()=>unpackChapterReport(encodedReport,encodedReport),/expanded/u));
test('unselected observer bytes stay opaque and exact',()=>{const raw=report('opaque.owner','opaque / not JSON ♞');assert.equal(chapterObservationWire(unpackChapterReport(packChapterReport(raw))),chapterObservationWire(raw));});
test('noncanonical original strings remain raw and exact',()=>{const raw=report(codecOwner,' {"a": 1} ');assert.equal(codecState(packChapterReport(raw,baseReport)),codecState(raw));});
test('original object key order survives a delta',()=>{const a=report(codecOwner,JSON.stringify({pad,a:1})),b=report(codecOwner,JSON.stringify({a:2,pad}));assert.equal(codecState(unpackChapterReport(packChapterReport(b,a),a)),codecState(b));});
test('new fields and changed array lengths survive a delta',()=>{const a=report(codecOwner,JSON.stringify({pad,a:[1,2]})),b=report(codecOwner,JSON.stringify({pad,a:[1,2,3],newKey:'new'}));assert.equal(codecState(unpackChapterReport(packChapterReport(b,a),a)),codecState(b));});
test('report deltas retain signed zero and infinite clock sentinels',()=>{const a=report('nalati.chapter-taming',packChapterTaming({pad,x:0,y:Infinity,z:-Infinity,nested:[0]})),b=report('nalati.chapter-taming',packChapterTaming({pad,x:-0,y:-Infinity,z:Infinity,nested:[-0]}));assert.equal(codecState(unpackChapterReport(packChapterReport(b,a),a)),codecState(b));});
test('owned prototype-named data stays data',()=>{const a=report(codecOwner,JSON.stringify({pad,__proto__:'ignored',rows:[1,2]})),b=report(codecOwner,`{"pad":${JSON.stringify(pad)},"__proto__":{"safe":1},"rows":[2,3]}`);assert.equal(codecState(unpackChapterReport(packChapterReport(b,a),a)),codecState(b));assert.equal(Object.hasOwn(Object.prototype,'safe'),false);});
test('excessive patch complexity keeps the complete original state',()=>{const a=report(codecOwner,JSON.stringify({many:Array.from({length:9000},()=>0)})),b=report(codecOwner,JSON.stringify({many:Array.from({length:9000},()=>1)}));assert.equal(codecState(packChapterReport(b,a)),codecState(b));});


test('valid multibyte states keep the original character boundary',()=>{const raw=report(codecOwner,JSON.stringify({unicode:'界'.repeat(350_000)}));assert.ok(codecState(raw).length<1_000_000);assert.equal(codecState(packChapterReport(raw,baseReport)),codecState(raw));assert.equal(codecState(unpackChapterReport(raw,baseReport)),codecState(raw));});
test('the original report character limit still refuses',()=>assert.throws(()=>packChapterReport(report(codecOwner,' '.repeat(1_000_001)),baseReport),/length bound/u));


test('unsupported JSON depth keeps the complete original state',()=>{let deep:unknown=0;for(let depth=0;depth<70;depth++)deep={deep};const raw=report(codecOwner,JSON.stringify({deep}));assert.equal(codecState(packChapterReport(raw,baseReport)),codecState(raw));});

test('new compact reports retain complete bytes when a patch is too complex',()=>{
  const a=report(codecOwner,JSON.stringify({many:Array.from({length:9000},()=>0)})),b=report(codecOwner,JSON.stringify({many:Array.from({length:9000},()=>1)}));
  const packed=packChapterReport(b,a,true);assert.ok(codecState(packed).includes('brotli-state'));
  assert.equal(chapterObservationWire(unpackChapterReport(packed,a)),chapterObservationWire(b));
  assert.equal(codecState(packChapterReport(b,a)),codecState(b),'the existing report encoder stays unchanged');
});
test('compact reports preserve noncanonical complete original strings',()=>{
  const raw=report(codecOwner,` { "pad": ${JSON.stringify(pad)}, "x": -0 } `),packed=packChapterReport(raw,baseReport,true);
  assert.equal(codecState(unpackChapterReport(packed,baseReport)),codecState(raw));
});
test('compact report state refuses trailing, truncated and foreign-basis payloads',()=>{
  const raw=report(codecOwner,` { "pad": ${JSON.stringify(pad)} } `),packed=packChapterReport(raw,baseReport,true);
  assert.ok(codecState(packed).includes('brotli-state'));
  assert.throws(()=>unpackChapterReport(packed,currentReport),/basis/u);
  assert.throws(()=>unpackChapterReport(change(packed,wire=>{if(typeof wire['data']!=='string')throw new Error('Missing compact state');wire['data']=wire['data'].slice(0,-8);}),baseReport));
  assert.throws(()=>unpackChapterReport(change(packed,wire=>{if(typeof wire['data']!=='string')throw new Error('Missing compact state');wire['data']=Buffer.concat([Buffer.from(wire['data'],'base64'),Buffer.from('junk')]).toString('base64');}),baseReport),/Trailing/u);
});

const numericBefore=report(codecOwner,JSON.stringify({values:Array.from({length:512},(_,index)=>Math.sin(index*.123)*471.113),unchanged:Array.from({length:512},(_,index)=>Math.cos(index*.321)*132.733)}));
const numericAfter=report(codecOwner,JSON.stringify({values:Array.from({length:512},(_,index)=>Math.sin(index*.123)*471.113+(index<64?.25:0)),unchanged:Array.from({length:512},(_,index)=>Math.cos(index*.321)*132.733)}));
const numericPacked=packChapterReport(numericAfter,numericBefore,true);
test('compact numeric patches preserve the complete original floating-point report',()=>{
  assert.ok(codecState(numericPacked).includes('brotli-f64-patch'));
  assert.equal(chapterObservationWire(unpackChapterReport(numericPacked,numericBefore)),chapterObservationWire(numericAfter));
});
function numericPayload(shape:unknown,numbers:number[]):string {
  const text=Buffer.from(JSON.stringify(shape)),payload=Buffer.alloc(4+text.byteLength+numbers.length*8);
  payload.writeUInt32LE(text.byteLength);text.copy(payload,4);numbers.forEach((value,index)=>{payload.writeDoubleLE(value,4+text.byteLength+index*8);});
  return brotliCompressSync(payload).toString('base64');
}
test('numeric report framing, ordered slots and scalar validity refuse',()=>{
  const patch=(value:unknown)=>[{path:['values'],value}],slot={'chapter.report.float':0};
  for(const [shape,numbers]of [[patch(1),[]],[patch({'chapter.report.float':-1}),[1]],[patch([slot,slot]),[1]],[[],[1]],[patch(slot),[Number.NaN]]] as const){
    assert.throws(()=>unpackChapterReport(change(numericPacked,wire=>{wire['data']=numericPayload(shape,[...numbers]);}),numericBefore),/numeric|Numeric/u);
  }
  assert.throws(()=>unpackChapterReport(change(numericPacked,wire=>{wire['data']=brotliCompressSync(Buffer.alloc(4)).toString('base64');}),numericBefore),/shape/u);
  assert.throws(()=>unpackChapterReport(change(numericPacked,wire=>{wire['data']=brotliCompressSync(Buffer.alloc(1_000_001)).toString('base64');}),numericBefore));
});
