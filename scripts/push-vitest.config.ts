import {defineConfig} from 'vitest/config';
import base from '../vitest.config.ts';
import {CI_SERIAL_TESTS} from './vitest-ci-files.ts';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {PUSH_PROFILE,PUSH_BUDGET} from './push-budget.mjs';
import {withTestEnvironments} from './vitest-environments.ts';

const {WS_PUSH_GATE_PROFILE:profile,WS_PUSH_TEST_PHASE:phase,WS_CPU_ADMISSION:admission}=process.env;
if(profile!==PUSH_PROFILE||(phase!=='native'&&phase!=='ordinary'&&phase!=='admitted'))throw new Error('Missing authenticated push cohort');
if(phase==='admitted'&&admission!=='1')throw new Error('Shared push cohort requires real file CPU admission');
assertHeavyLease('full-test');
// Native and ordinary are retained for paired profiling. The full admitted
// cohort keeps the exact union; per-file exclusive grants protect timing proofs.
// oxlint-disable-next-line import/no-default-export -- Vitest's config entry point.
export default defineConfig(withTestEnvironments({...base,test:{...base.test,isolate:true,pool:'forks',
  ...(phase==='native'?{include:[...CI_SERIAL_TESTS],maxWorkers:1}
    :phase==='ordinary'?{exclude:[...(base.test?.exclude??[]),...CI_SERIAL_TESTS],maxWorkers:PUSH_BUDGET.workers}
      :{maxWorkers:PUSH_BUDGET.workers})}}));
