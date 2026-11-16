import {expect,test} from 'vitest';
import {nativeContention} from '../fixtures/nativeContention';

test('net-fuzz queues before collection and preserves original cases',async()=>{
 expect(await nativeContention('test/net-fuzz.test.ts')).toEqual({files:[{file:'test/net-fuzz.test.ts',queuedBeforeCollection:true,originalCasesPassed:true}],allGrantsReleased:true});
},60000);
