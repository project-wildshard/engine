import {afterEach, expect, test, vi} from 'vitest';
import {bootRoadCompletionState, bootRoadFailure} from '../scripts/parity/boot-smoke.mjs';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Reflect.defineProperty(globalThis, 'window', originalWindow);
  vi.useRealTimers();
});

test('road refusal retains its primary cause and the actual compact/observer facts', async () => {
  const primary=new Error('Boot deadline: Signal road entry');
  const evidence={compact:{inside:'sunscar-dunes',current:'sunscar-dunes',ready:true},observer:{present:false}};
  const failure=await bootRoadFailure(() => Promise.resolve(evidence),primary);
  expect(failure.cause).toBe(primary);
  expect(failure.message).toContain(primary.message);
  expect(failure.message).toContain(JSON.stringify(evidence));
});

test('a failed diagnostic cannot replace the original road refusal', async () => {
  const primary=new Error('Original road deadline');
  const failure=await bootRoadFailure(() => Promise.reject(new Error('Page closed')),primary);
  expect(failure.cause).toBe(primary);
  expect(failure.message).toContain('Original road deadline');
  expect(failure.message).toContain('Page closed');
});

test('an unresponsive page has only a bounded failure diagnostic', async () => {
  vi.useFakeTimers(); const primary=new Error('Original road deadline');
  const result=bootRoadFailure(() => new Promise(() => { /* Deliberately no page response. */ }),primary);
  await vi.advanceTimersByTimeAsync(1000);
  const failure=await result;
  expect(failure.cause).toBe(primary);
  expect(failure.message).toContain('diagnostic did not answer in 1000 ms');
  expect(vi.getTimerCount()).toBe(0);
});

test('failure readout samples the real observer and narrow travel state without a full census', () => {
  const full=vi.fn(() => {throw new Error('No full census');}), narrow=vi.fn(() => ({inside:'sunscar-dunes',
    live:{live:{current:'sunscar-dunes',gameplayReady:true,pending:[]},crossing:{phase:'settled'}}}));
  const systems=vi.fn(() => ['healthy.update']);
  vi.stubGlobal('window',{__frameFloorGridStop:{leg:'boot-signal-road-entry',phase:'travel'},__wildshard:{
    world:{game:{levelScope:{name:'original-owner',disposed:true,disposing:false},levelSystemIds:systems,frameCount:722,
      engineScope:{census:{rafs:0}},frameRafTime:12,app:{state:'play',ui:{presentation:'covered',still:false,blocking:false,top:'hud'}}}},
    shard:{grid:{state:full,travelState:narrow}}}});
  expect(bootRoadCompletionState()).toMatchObject({observer:{present:false,systems:1},owner:{disposed:true},
    compact:{inside:'sunscar-dunes',current:'sunscar-dunes',ready:true,phase:'settled'},game:{frame:722,state:'play'},
    view:{coverage:'covered',still:false,top:'hud'},raf:{ownedRequests:0,lastDrawnAt:12}});
  expect(full).not.toHaveBeenCalled();expect(narrow).toHaveBeenCalledOnce();expect(systems).toHaveBeenCalledOnce();
});
