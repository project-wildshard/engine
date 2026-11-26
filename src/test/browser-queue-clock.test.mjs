import {expect,test} from 'vitest';
import {queuedMilliseconds} from '../scripts/browser-queue-clock.mjs';

const row=(token,at,waiting,scope='one')=>({token,at,waiting,scope});
test('browser waits do not consume an outer active budget or double-count parallel queues',()=>{
 const events=[row('a',100,true),row('b',200,true),row('a',400,false),row('b',500,false)];
 expect(queuedMilliseconds(events,0,1000)).toBe(400);
 expect(queuedMilliseconds(events,300,450)).toBe(150);
 expect(queuedMilliseconds(events,0,1000,'foreign')).toBe(0);
});
test('browser clocks retain ordinary work, scope boundaries and a bounded lost-writer wait',()=>{
 const events=[row('a',100,true),row('b',200,true,'two'),row('b',500,false,'two')];
 expect(queuedMilliseconds([],0,1000)).toBe(0);
 expect(queuedMilliseconds(events,0,1000,'two')).toBe(300);
 expect(queuedMilliseconds(events,0,1000000,'one')).toBe(300000);
 expect(queuedMilliseconds(events,0,50,'one')).toBe(0);
});

test('waiting siblings cannot pause active leases or unfinished ordinary scopes',()=>{
 const events=[row('a',100,true),{...row('b',150,true),kind:'lease'},row('a',400,false),{...row('b',450,false),kind:'lease'}];
 expect(queuedMilliseconds(events,0,1000,'one')).toBe(50);
 const parallel=[{...row('one',0,true),kind:'scope'},{...row('two',0,true,'two'),kind:'scope'},row('a',100,true),row('b',200,true,'two'),{...row('two',400,false,'two'),kind:'scope'},row('a',500,false)];
 expect(queuedMilliseconds(parallel,0,1000,['one','two'])).toBe(300);
 expect(queuedMilliseconds(parallel,0,1000,['one','ordinary'])).toBe(0);
});
