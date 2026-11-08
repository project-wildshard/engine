import {relative} from 'node:path';
import {BaseSequencer,type TestSpecification} from 'vitest/node';
import {readEnginePlan} from './engine-ci-plan.ts';

/** The plan already orders each bin by descending observed cost; dispatch that order. */
export class EngineCISequencer extends BaseSequencer{
  override sort(files:TestSpecification[]):Promise<TestSpecification[]>{
    const {WS_CI_PLAN:filename,WS_CI_SHARD:index,WS_CI_PHASE:phase}=process.env;
    if(filename===undefined||(phase!=='native'&&phase!=='ordinary'))throw new Error('Missing CI ordering plan');
    const shard=readEnginePlan(filename).shards[Number(index)-1];if(shard===undefined)throw new Error('Unknown CI shard');
    const ranks=new Map(shard[phase].map((file,rank)=>[file,rank]));
    const rank=(file:TestSpecification):number=>{
      const path=relative(process.cwd(),file.moduleId).replaceAll('\\','/'),value=ranks.get(path);
      if(value===undefined)throw new Error(`Unplanned execution: ${path}`);return value;
    };
    return Promise.resolve([...files].sort((a,b)=>rank(a)-rank(b)));
  }
}
