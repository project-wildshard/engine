import {expect,test} from 'vitest';
import * as proofs from '../scripts/push-proof-cache.mjs';
const before={tree:'same-tree',execution:'same-execution',runtime:'bound',dependencies:'installed'};
test('a completed full gate can publish uncached when only input observation is unavailable',()=>{
 expect(proofs.pushProofDisposition(before,{...before,runtime:'unavailable',dependencies:null},{full:true,inherited:false})).toBe('uncached');
 expect(()=>proofs.pushProofDisposition(before,{...before,runtime:'unavailable',dependencies:null},{full:true,inherited:true})).toThrow('inputs');
});
test('changed source, execution policy and known installed bytes still refuse publication',()=>{
 for(const change of [{tree:'changed'},{execution:'changed'},{runtime:'changed',dependencies:'changed'}])
  expect(()=>proofs.pushProofDisposition(before,{...before,...change},{full:true,inherited:false})).toThrow('changed');
 expect(()=>proofs.pushProofDisposition(before,null,{full:true,inherited:false})).toThrow('changed');
});
