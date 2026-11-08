import {readFileSync} from 'node:fs';
import {defineConfig} from 'vitest/config';
import base from '../vitest.config.ts';
import {readEnginePlan} from './engine-ci-plan.ts';
import {EngineCISequencer} from './engine-ci-sequencer.ts';

const {WS_CI_PLAN:filename,WS_CI_SHARD:index,WS_CI_PHASE:phase}=process.env;
if(filename===undefined||index===undefined||(phase!=='native'&&phase!=='ordinary'))throw new Error('Missing exact CI shard/phase');
const plan=readEnginePlan(filename),shard=plan.shards[Number(index)-1];
if(shard===undefined)throw new Error('Unknown CI shard');
const files=shard[phase];
// No fallback discovery and no broad path-substring filters: these exact paths are the plan.
if(files.length===0)throw new Error('An empty phase must not run Vitest');
for(const file of files)readFileSync(file);
// oxlint-disable-next-line import/no-default-export -- Vitest's config entry point.
export default defineConfig({...base,test:{...base.test,include:files,maxWorkers:phase==='native'?1:2,isolate:true,pool:'forks',sequence:{sequencer:EngineCISequencer}}});
