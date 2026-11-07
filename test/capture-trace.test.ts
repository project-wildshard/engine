import { expect, test, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import { beginCaptureTrace, registerCaptureTrace, screenshotTraceStages } from '../scripts/parity/capture-trace.mjs';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const lines=(rows:object[])=>rows.map(row=>JSON.stringify(row)).join('\n');
test('stable screenshot trace retains actual API duration and font milestones',()=>{
  const text=lines([
    {type:'before',callId:'a',method:'screenshot',startTime:100},
    {type:'log',callId:'a',time:105,message:'waiting for fonts to load...'},
    {type:'log',callId:'a',time:120,message:'fonts loaded'},
    {type:'after',callId:'a',endTime:10100,error:{message:'Timeout 10000ms exceeded'}}
  ]);
  expect(screenshotTraceStages(text,'Nine title')).toEqual([
    {label:'Nine title',stage:'screenshot-api-log',state:'observed',ms:5,message:'waiting for fonts to load...'},
    {label:'Nine title',stage:'screenshot-api-log',state:'observed',ms:20,message:'fonts loaded'},
    {label:'Nine title',stage:'screenshot-api',state:'refused',ms:10000}
  ]);
});

test('other API calls and missing or malformed trace records never imply a successful screenshot',()=>{
  const unrelated=lines([{type:'before',callId:'b',method:'evaluate',startTime:1},{type:'after',callId:'b',endTime:5}]);
  expect(screenshotTraceStages(`${unrelated}\ninvalid\nnull\n`,'title')).toEqual([
    {label:'title',stage:'screenshot-api',state:'unavailable',ms:null}
  ]);
  expect(screenshotTraceStages(lines([{type:'before',callId:'c',method:'screenshot',startTime:1}]),'title')).toEqual([
    {label:'title',stage:'screenshot-api',state:'unfinished',ms:null}
  ]);
  expect(screenshotTraceStages(lines([{type:'before',callId:'c',method:'screenshot',startTime:1},{type:'after',callId:'c',endTime:51}]),'title')).toEqual([
    {label:'title',stage:'screenshot-api',state:'complete',ms:50}
  ]);
});

test('tracing start refusal is diagnostic only and never claims native RPC observations',async()=>{
  const start=vi.fn().mockRejectedValue(new Error('tracing unavailable')), stop=vi.fn();
  const tracing=legacyDouble<BrowserContext['tracing']>({start,stop});
  const context=legacyDouble<BrowserContext>({tracing});
  const page=legacyDouble<Page>({context:()=>context});
  registerCaptureTrace(page,'unused','nine');
  const log=vi.spyOn(console,'log').mockImplementation(()=>undefined);
  try {
    const finish=await beginCaptureTrace(page,'title'); await finish();
    expect(start).toHaveBeenCalledExactlyOnceWith({screenshots:false,snapshots:false,sources:false});
    expect(stop).not.toHaveBeenCalled();
    expect(log.mock.calls.filter(([line])=>String(line).includes('unavailable-in-stable-trace'))).toHaveLength(4);
    expect(log).toHaveBeenCalledWith('boot-capture-trace unavailable: Error: tracing unavailable');
  } finally {log.mockRestore();}
});
