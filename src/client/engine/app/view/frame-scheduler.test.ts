import {expect,test,vi} from 'vitest';
import {SharedFrameScheduler} from './frameScheduler';

function fixture(){
  let next=0;const pending=new Map<number,FrameRequestCallback>(),failed=vi.fn<(error:unknown)=>void>();
  const frames=new SharedFrameScheduler({frame:run=>{const id=++next;pending.set(id,run);return id;},cancel:id=>{pending.delete(id);},failed});
  const step=(at:number):void=>{const batch=[...pending.values()];pending.clear();for(const run of batch)run(at);};
  return {frames,pending,failed,step};
}

test('multiple owners share one native carrier and preserve registration order',()=>{
  const f=fixture(),seen:number[]=[];f.frames.frame(()=>{seen.push(1);});f.frames.frame(()=>{seen.push(2);});
  expect(f.pending.size).toBe(1);f.step(17);expect(seen).toEqual([1,2]);expect(f.pending.size).toBe(0);
});

test('reentrant frame work waits for exactly one next carrier',()=>{
  const f=fixture(),seen:number[]=[];
  f.frames.frame(()=>{seen.push(1);f.frames.frame(()=>{seen.push(3);});f.frames.frame(()=>{seen.push(4);});});
  f.frames.frame(()=>{seen.push(2);});f.step(17);expect(seen).toEqual([1,2]);expect(f.pending.size).toBe(1);
  f.step(34);expect(seen).toEqual([1,2,3,4]);expect(f.pending.size).toBe(0);
});

test('cancelled slots reused during dispatch cannot run a next-frame job early',()=>{
  const f=fixture(),seen:string[]=[];let id=0;
  f.frames.frame(()=>{f.frames.cancel(id);f.frames.frame(()=>{seen.push('later');});});
  id=f.frames.frame(()=>{seen.push('cancelled');});f.step(17);expect(seen).toEqual([]);
  f.step(34);expect(seen).toEqual(['later']);
});

test('hide cancels the native carrier while preserving owned work for show',()=>{
  const f=fixture(),run=vi.fn<()=>void>();f.frames.frame(run);const raced=[...f.pending.values()][0];
  if(raced===undefined)throw new Error('Missing original native carrier');
  f.frames.setActive(false);expect(f.pending.size).toBe(0);raced(17);expect(run).not.toHaveBeenCalled();
  f.frames.setActive(true);expect(f.pending.size).toBe(1);raced(18);expect(run).not.toHaveBeenCalled();
  f.step(34);expect(run).toHaveBeenCalledExactlyOnceWith(34);expect(f.pending.size).toBe(0);
});

test('work created or cancelled while hidden never creates a native callback',()=>{
  const f=fixture(),run=vi.fn<()=>void>();f.frames.setActive(false);const id=f.frames.frame(run);
  expect(f.pending.size).toBe(0);f.frames.cancel(id);f.frames.setActive(true);expect(f.pending.size).toBe(0);
  f.frames.setActive(false);f.frames.frame(run);expect(f.pending.size).toBe(0);f.frames.setActive(true);f.step(17);expect(run).toHaveBeenCalledOnce();
});

test('a failing callback reports without dropping siblings',()=>{
  const f=fixture(),error=new Error('frame fixture'),healthy=vi.fn<()=>void>();
  f.frames.frame(()=>{throw error;});f.frames.frame(healthy);f.step(17);
  expect(f.failed).toHaveBeenCalledExactlyOnceWith(error);expect(healthy).toHaveBeenCalledExactlyOnceWith(17);
});

test('hide during delivery parks the rest before reentrant next-frame work',()=>{
  const f=fixture(),seen:number[]=[];
  f.frames.frame(()=>{seen.push(1);f.frames.frame(()=>{seen.push(3);});f.frames.setActive(false);});
  f.frames.frame(()=>{seen.push(2);});f.step(17);expect(seen).toEqual([1]);expect(f.pending.size).toBe(0);
  f.frames.setActive(true);f.step(34);expect(seen).toEqual([1,2,3]);
});

test('a native scheduling refusal retires the unregistered logical job',()=>{
  let first=true;const pending:FrameRequestCallback[]=[],failed=vi.fn<(error:unknown)=>void>(),seen=vi.fn<()=>void>();
  const frames=new SharedFrameScheduler({frame:run=>{if(first){first=false;throw new Error('native refusal');}pending.push(run);return 1;},cancel:()=>undefined,failed});
  expect(()=>frames.frame(()=>{throw new Error('orphan callback');})).toThrow('native refusal');
  frames.frame(seen);expect(pending).toHaveLength(1);pending[0]?.(17);
  expect(seen).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled();expect(frames.pending).toBe(false);
});
