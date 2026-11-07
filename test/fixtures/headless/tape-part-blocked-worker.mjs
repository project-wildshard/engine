// Fixed adversarial fixture: a request blocks in its own isolate until the parent quarantines it.
import {runTickWorker} from '../../../src/server/host/tickWorkerLoop.ts';

await runTickWorker(({entered})=>Promise.resolve({
  step:()=>{throw new Error('No ordinary step in this fixture');},
  verbTape:()=>{
    const flag=new Int32Array(entered);Atomics.store(flag,0,1);Atomics.notify(flag,0);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60_000);
    throw new Error('Blocked request unexpectedly returned');
  },
  commit:()=>({tick:0,snapshot:'initial',effects:[]}),finish:()=>({ticks:0,lanes:0,steps:0}),
  dispose:()=>{/* Parent termination owns the blocked isolate. */},
}));
