import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import type {Reporter,TestModule,TestRunEndReason} from 'vitest/node';
import * as v from 'valibot';
import {timingRequestSchema} from './push-test-timings.mjs';

/** Admission evidence only: normal file/case/shard gates retain their existing limits. */
// oxlint-disable-next-line import/no-default-export -- Vitest reporter entry point.
export default class PushTimingReporter implements Reporter{
 onTestRunEnd(modules:readonly TestModule[],errors:readonly unknown[],reason:TestRunEndReason):void{
  const {WS_PUSH_TIMING_REQUEST:path}=process.env;
  if(path===undefined)throw new Error('Missing new-test timing request');
  const request=v.parse(timingRequestSchema,JSON.parse(readFileSync(path,'utf8')) as unknown);
  const files=request.files.map(expected=>{
   const module=modules.find(row=>relative(process.cwd(),row.moduleId).replaceAll('\\','/')===expected.file);
   const stats=module?.diagnostic();
   return {...expected,state:module?.state()??'not-run',passedTests:module===undefined?0:[...module.children.allTests('passed')].length,
    durationMs:stats===undefined?0:stats.duration+stats.collectDuration+stats.setupDuration+stats.prepareDuration+stats.environmentSetupDuration};
  });
  writeFileSync(resolve(dirname(path),`${request.ring}.report.json`),`${JSON.stringify({...request,reason,errorCount:errors.length,files,finishedAt:new Date().toISOString()},null,2)}\n`);
 }
}
