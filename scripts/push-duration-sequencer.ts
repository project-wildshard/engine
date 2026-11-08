import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {BaseSequencer,type TestSpecification} from 'vitest/node';
import * as v from 'valibot';

/** Long files begin early in a cold immutable checkout. Exclusive timing and
 * uncapped encoder proofs finish after shared work instead of blocking it. */
export class PushDurationSequencer extends BaseSequencer{
  override sort(files:TestSpecification[]):Promise<TestSpecification[]>{
    const weights=v.parse(v.record(v.string(),v.pipe(v.number(),v.finite(),v.minValue(0))),JSON.parse(readFileSync('test/durations.json','utf8')) as unknown);
    const path=(file:TestSpecification):string=>relative(process.cwd(),file.moduleId).replaceAll('\\','/');
    const cost=(file:TestSpecification):number=>{
      const name=path(file);
      if(name==='test/net-bots.test.ts'||name==='test/cook-worker.test.ts')return -1;
      return weights[name]??60;
    };
    return Promise.resolve([...files].sort((a,b)=>cost(b)-cost(a)||path(a).localeCompare(path(b))));
  }
}
