import {readFileSync} from 'node:fs';
import {defineConfig} from 'vitest/config';
import base from '../vitest.config.ts';
import {readEnginePlan} from './engine-ci-plan.ts';
import {EngineCISequencer} from './engine-ci-sequencer.ts';
import {withTestEnvironments} from './vitest-environments.ts';

const {WS_CI_PLAN:filename,WS_CI_SHARD:index,WS_CI_PHASE:phase}=process.env;
if(filename===undefined||index===undefined||(phase!=='native'&&phase!=='ordinary'))throw new Error('Missing exact CI shard/phase');
const plan=readEnginePlan(filename),shard=plan.shards[Number(index)-1];
if(shard===undefined)throw new Error('Unknown CI shard');
const files=shard[phase];
// No fallback discovery and no broad path-substring filters: these exact paths are the plan.
if(files.length===0)throw new Error('An empty phase must not run Vitest');
for(const file of files)readFileSync(file);
// TEST-SPEED TS2 spike: the ordinary phase used 2 workers on the 4-vCPU runner (55 % busy). Four workers run two
// shards' worth of ordinary files at once; native files keep one worker and the runner to themselves.
const ORDINARY_WORKERS=4;
// oxlint-disable-next-line import/no-default-export -- Vitest's config entry point.
export default defineConfig(withTestEnvironments({...base,test:{...base.test,include:files,maxWorkers:phase==='native'?1:ORDINARY_WORKERS,isolate:true,pool:'forks',sequence:{sequencer:EngineCISequencer}}}));
