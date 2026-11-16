import {expect,test} from 'vitest';
import {nativeContention} from '../fixtures/nativeContention';

test('shard physics queues before collection and preserves original cases',async()=>{
 expect(await nativeContention('test/physics-shards-headless.test.ts')).toEqual({files:[{file:'test/physics-shards-headless.test.ts',queuedBeforeCollection:true,originalCasesPassed:true}],allGrantsReleased:true});
},60000);
