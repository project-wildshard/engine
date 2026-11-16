import {expect,test} from 'vitest';
import {nativeContention} from '../fixtures/nativeContention';

test('Nalati physics queues before collection and preserves original cases',async()=>{
 expect(await nativeContention('test/physics-nalati-headless.test.ts')).toEqual({files:[{file:'test/physics-nalati-headless.test.ts',queuedBeforeCollection:true,originalCasesPassed:true}],allGrantsReleased:true});
},60000);
