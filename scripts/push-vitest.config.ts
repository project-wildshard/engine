import {defineConfig} from 'vitest/config';
import base from '../vitest.config.ts';
import {CI_SERIAL_TESTS} from './vitest-ci-files.ts';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {PUSH_PROFILE,PUSH_BUDGET} from './push-budget.mjs';

const {WS_PUSH_GATE_PROFILE:profile,WS_PUSH_TEST_PHASE:phase}=process.env;
if(profile!==PUSH_PROFILE||(phase!=='native'&&phase!=='ordinary'))throw new Error('Missing authenticated push cohort');
assertHeavyLease('full-test');
// Actual native and wall-clock proofs run without ordinary worker siblings.
// oxlint-disable-next-line import/no-default-export -- Vitest's config entry point.
export default defineConfig({...base,test:{...base.test,isolate:true,pool:'forks',
  ...(phase==='native'?{include:[...CI_SERIAL_TESTS],maxWorkers:1}
    :{exclude:[...(base.test?.exclude??[]),...CI_SERIAL_TESTS],maxWorkers:PUSH_BUDGET.workers})}});
