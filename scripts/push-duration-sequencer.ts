import {relative} from 'node:path';
import {BaseSequencer,type TestSpecification} from 'vitest/node';
import {CPU_EXCLUSIVE_TESTS} from './vitest-ci-files.ts';
import {readWeights} from './test-timings.mjs';

/** Longest first, so no long file starts late and finishes alone (VITEST-BENCH VB8).
 * The bounded cook worker (a 4-slot grant) is ordered by its own weight. Files that
 * hold the whole CPU budget start last: the broker is strict FIFO, so an all-slot
 * request queued mid-run stalls every worker until the longest running file ends,
 * while at the end it waits only for the short files still in flight. */
export class PushDurationSequencer extends BaseSequencer{
  override sort(files:TestSpecification[]):Promise<TestSpecification[]>{
    const weights=readWeights('full');
    const exclusive=new Set<string>(CPU_EXCLUSIVE_TESTS);
    const path=(file:TestSpecification):string=>relative(process.cwd(),file.moduleId).replaceAll('\\','/');
    const cost=(file:TestSpecification):number=>{
      const name=path(file);
      if(exclusive.has(name))return -1;
      return weights[name]??60;
    };
    // VB14: a reused worker takes the next file only when that file also shares workers, so the light shared
    // files run as one block after the isolated ones and before the all-slot proofs.
    const rank=(file:TestSpecification):number=>exclusive.has(path(file))?2:file.project.config.isolate?0:1;
    return Promise.resolve([...files].sort((a,b)=>rank(a)-rank(b)||cost(b)-cost(a)||path(a).localeCompare(path(b))));
  }
}
