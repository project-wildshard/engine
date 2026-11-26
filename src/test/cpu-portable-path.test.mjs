import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise native admission from a consumer directory.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every private ledger stays in this run's owned scratch.
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The consumer deliberately has no scripts folder.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Import the real provider by absolute module URL.
import {pathToFileURL} from 'node:url';

test('CPU admission and ancestor inspection use the provider paths from a foreign cwd',()=>{
 const root=resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','cpu-portable');mkdirSync(root,{recursive:true});const cwd=mkdtempSync(resolve(root,'consumer-'));
 const module=pathToFileURL(resolve('src/scripts/cpu-admission.mjs')).href;
 const inspect=`import {ancestorCpuBudget} from ${JSON.stringify(module)};const budget=ancestorCpuBudget();if(budget?.slots!==1||budget.capacity!==2)throw Error('wrong inherited budget');console.log('verified');`;
 const source=`import {holdCpu,parentCpuContext,PARENT_CONTEXT} from ${JSON.stringify(module)};import {execFileSync} from 'node:child_process';const root=${JSON.stringify(cwd)};const lease=await holdCpu(1,{root,capacity:2});try{const env={...process.env,WS_CPU_ROOT:root};env[PARENT_CONTEXT]=parentCpuContext(lease.proof,env);console.log(execFileSync(process.execPath,['--input-type=module','-e',${JSON.stringify(inspect)}],{env,encoding:'utf8'}).trim());}finally{await lease.release();}`;
 try{expect(execFileSync(process.execPath,['--input-type=module','-e',source],{cwd,encoding:'utf8',timeout:15000})).toBe('verified\n');}finally{rmSync(cwd,{recursive:true,force:true});}
},20000);
