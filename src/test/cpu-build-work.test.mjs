import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Production CPU lifecycle contracts run with an injected kernel and clock.
import {execFileSync} from 'node:child_process';

test('service admission ignores unrelated census churn and refuses unreadable owned members',()=>{
 const report=JSON.parse(execFileSync('python3',['src/scripts/cpu-group-inventory-proof.py'],{encoding:'utf8',timeout:10000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 expect(report).toEqual({unrelatedChurnIndependent:true,ownedUnreadableRefused:true,disappearedPidIgnored:true,noSignalsSent:true});
});

test('service CPU work releases only on completion or verified group drain',()=>{
 const report=JSON.parse(execFileSync('python3',['-I','src/scripts/cpu-contract-proof.py','build'],{encoding:'utf8',timeout:60000}));
 expect(report.controls).toHaveLength(3);
},65000);
