import {expect,test} from 'vitest';
import {checkedReplayPipeline} from './fixtures/headless/checkedReplayPipeline';

function gate():{promise:Promise<void>;release:()=>void}{
  let release=():void=>{throw new Error('Gate is not installed');};
  const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};
}

test('capture advances beside one replay and the next part waits for its exact commit',async()=>{
  const first=gate(),second=gate(),seen:number[]=[];
  const pipeline=checkedReplayPipeline<number>(async part=>{seen.push(part);await(part===1?first:second).promise;});
  await pipeline.offer(1);expect(seen).toEqual([1]);
  // A recorder can now perform its actual next fixed steps while part 1 runs.
  let accepted=false;const next=pipeline.offer(2).then(()=>{accepted=true;return undefined;});
  await Promise.resolve();expect(accepted).toBe(false);expect(seen).toEqual([1]);
  first.release();await next;expect(seen).toEqual([1,2]);
  let done=false;const finished=pipeline.finish().then(()=>{done=true;return undefined;});
  await Promise.resolve();expect(done).toBe(false);second.release();await finished;
  expect(()=>pipeline.check()).toThrow('ended');await pipeline.stop();
});

test('an actual replay refusal stops capture and prevents later requests',async()=>{
  const first=gate(),seen:number[]=[],refusal=new Error('Checked native mismatch');
  const pipeline=checkedReplayPipeline<number>(async part=>{seen.push(part);await first.promise;throw refusal;});
  await pipeline.offer(1);const next=pipeline.offer(2);
  const refused=expect(next).rejects.toBe(refusal);first.release();await refused;
  expect(()=>pipeline.check()).toThrow(refusal);await expect(pipeline.finish()).rejects.toBe(refusal);
  expect(seen).toEqual([1]);await pipeline.stop();
});

test('stopping drains the owned request and publishes no pending next part',async()=>{
  const first=gate(),seen:number[]=[];
  const pipeline=checkedReplayPipeline<number>(async part=>{seen.push(part);await first.promise;});
  await pipeline.offer(1);const next=pipeline.offer(2),refused=expect(next).rejects.toThrow('ended');
  let stopped=false;const ending=pipeline.stop().then(()=>{stopped=true;return undefined;});
  await Promise.resolve();expect(stopped).toBe(false);first.release();await ending;await refused;
  expect(seen).toEqual([1]);
});

test('racing producers cannot put two requests beyond one checked boundary',async()=>{
  const first=gate(),seen:number[]=[];
  const pipeline=checkedReplayPipeline<number>(async part=>{seen.push(part);if(part===1)await first.promise;});
  await pipeline.offer(1);const second=pipeline.offer(2);
  await expect(pipeline.offer(3)).rejects.toThrow('pending offer');
  await expect(pipeline.finish()).rejects.toThrow('unsettled offer');
  expect(seen).toEqual([1]);first.release();await second;await pipeline.finish();expect(seen).toEqual([1,2]);
});
