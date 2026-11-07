import {expect,test} from 'vitest';
import {parseContractBoardPage,ContractBoardPageSchema} from '@wildshard/format/contracts';
import {namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {CONTRACTS} from './fixtures/pine-contracts';

const rows=()=>({contracts:CONTRACTS,panel:{frame:{tag:'div'},lifetime:'open'},store:{slot:'lodge',state:'board'},at:{x:4,z:9,yaw:0},label:'Read board',filled:'Claim reward',height:1.3,radius:2.8,ammunition:{loadout:'bow',kind:'iron'},finishes:Object.fromEntries([...CONTRACTS.rows.flatMap(row=>row.reward.skin===undefined?[]:[row.reward.skin]),...CONTRACTS.milestones.map(row=>row.skin)].map(key=>[key,`Finish ${key}`])),notices:{claimed:'{claimed} · {streak}',filled:'{goal}',progress:'{goal}: {have}/{need}'}});
test('build admission retains the original page data and emits a structural product contract',()=>{
 const input=rows(),admitted=parseContractBoardPage(input);
 expect(admitted).toEqual(input);
 const schema=namedJsonSchema(ContractBoardPageSchema);
 expect(schema).toMatchObject({type:'object',additionalProperties:false});
 expect(schema['required']).toEqual(expect.arrayContaining(['contracts','panel','store','at','notices']));
});
test('page admission refuses missing feedback, unknown notice tokens, invalid prompt and callback data',()=>{
 const input=rows();
 for(const invalid of [{...input,radius:0},{...input,at:{...input.at,x:Infinity}},{...input,finishes:{}},{...input,notices:{...input.notices,claimed:'{payout}'}},{...input,panel:{frame:{text:()=>''},lifetime:'open'}},{...input,ammunition:undefined}])expect(()=>parseContractBoardPage(invalid)).toThrow();
});
