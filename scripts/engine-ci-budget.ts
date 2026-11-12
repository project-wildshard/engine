import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import type {Reporter,TestModule,TestRunEndReason} from 'vitest/node';
import {AMBER,amberLine,judgeFile} from './test-amber.mjs';
import {readTimings} from './test-timings.mjs';

/** J193's per-file wall clock, judged by J295 (scripts/test-amber.mjs): a file over its budget is AMBER, warns and
 * stays green; at 2x, or amber on main too long, it is red. Quarantine retains its separate, ordinary results. */
// oxlint-disable-next-line import/no-default-export -- Vitest's reporter entry point.
export default class EngineBudget implements Reporter{
  private readonly began=Date.now();
  private readonly limit:number;
  constructor(options:{maxMs?:number}={}){
    const limit=options.maxMs??AMBER.budgetMs;
    if(!Number.isFinite(limit)||limit<1)throw new Error('Invalid CI file budget');
    this.limit=Math.min(limit,AMBER.budgetMs);
  }
  onTestRunEnd(modules:readonly TestModule[],errors:readonly unknown[],reason:TestRunEndReason):void{
    const files=modules.map(module=>{
      const diagnostic=module.diagnostic();
      const cases=[...module.children.allTests()].map(test=>({name:test.fullName,state:test.result().state,mode:test.options.mode}));
      const caseCounts={total:cases.length,passed:0,failed:0,skipped:0,pending:0};
      for(const test of cases)caseCounts[test.state]++;
      return {file:relative(process.cwd(),module.moduleId).replaceAll('\\','/'),state:module.state(),errorCount:module.errors().length,caseCounts,cases,
        durationMs:diagnostic.duration+diagnostic.collectDuration+diagnostic.setupDuration+diagnostic.prepareDuration+diagnostic.environmentSetupDuration,
        testAndHookMs:diagnostic.duration,collectMs:diagnostic.collectDuration};
    });
    const {WS_CI_TIMINGS:timings,GITHUB_SHA:sha,GITHUB_RUN_ID:run,GITHUB_RUN_ATTEMPT:attempt}=process.env;
    const ledger=readTimings()?.amber??{},now=Date.now();
    const verdicts=files.map(file=>judgeFile(file.file,file.durationMs,this.limit,ledger[file.file],now)).filter(verdict=>verdict.level!=='ok');
    const amber=verdicts.filter(verdict=>verdict.level==='amber'),red=verdicts.filter(verdict=>verdict.level==='red');
    const out=resolve(timings??`tmp/engine-ci/timings-${process.pid}.json`);mkdirSync(dirname(out),{recursive:true});
    writeFileSync(out,`${JSON.stringify({schema:'engine-ci-budget/2',sha:sha??null,run:run??null,attempt:attempt??null,reason,errorCount:errors.length,startedAt:this.began,endedAt:now,
      budget:{limitMs:this.limit,amber:amber.map(row=>amberLine(row,run)),red:red.map(row=>amberLine(row,run))},files},null,2)}\n`);
    for(const row of amber)console.error(`::warning file=${row.file},title=AMBER test file over budget (J295)::${amberLine(row,run)}`);
    for(const row of red)console.error(`::error file=${row.file}::CI test file ${row.ms} ms exceeds ${row.budget} ms, red: ${row.why}. ${amberLine(row,run)}`);
    if(red.length>0)process.exitCode=1;
  }
}
