import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import type {Reporter,TestModule,TestRunEndReason} from 'vitest/node';

/** J193 is a real wall-clock gate. Quarantine retains its separate, ordinary results. */
// oxlint-disable-next-line import/no-default-export -- Vitest's reporter entry point.
export default class EngineBudget implements Reporter{
  private readonly began=Date.now();
  private readonly limit:number;
  constructor(options:{maxMs?:number}={}){
    const limit=options.maxMs??60_000;
    if(!Number.isFinite(limit)||limit<1)throw new Error('Invalid CI file budget');
    this.limit=Math.min(limit,60_000);
  }
  onTestRunEnd(modules:readonly TestModule[],_errors:readonly unknown[],reason:TestRunEndReason):void{
    const files=modules.map(module=>{
      const diagnostic=module.diagnostic();
      return {file:relative(process.cwd(),module.moduleId).replaceAll('\\','/'),state:module.state(),
        durationMs:diagnostic.duration+diagnostic.collectDuration+diagnostic.setupDuration+diagnostic.prepareDuration+diagnostic.environmentSetupDuration,
        testAndHookMs:diagnostic.duration,collectMs:diagnostic.collectDuration};
    });
    const slow=files.filter(file=>file.durationMs>this.limit);
    const {WS_CI_TIMINGS:timings,GITHUB_SHA:sha,GITHUB_RUN_ID:run}=process.env;
    const out=resolve(timings??`tmp/engine-ci/timings-${process.pid}.json`);mkdirSync(dirname(out),{recursive:true});
    writeFileSync(out,`${JSON.stringify({sha:sha??null,run:run??null,reason,startedAt:this.began,endedAt:Date.now(),files},null,2)}\n`);
    for(const file of slow)console.error(`::error file=${file.file}::CI test file ${file.durationMs.toFixed(0)} ms exceeds ${this.limit} ms`);
    if(slow.length>0)process.exitCode=1;
  }
}
