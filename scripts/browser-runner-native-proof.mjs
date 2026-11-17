// J402 native Playwright Test qualification. KEYCHAIN_ARGS keeps every
// launch muted with --use-mock-keychain and --password-store=basic.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {cpuRoot} from './cpu-admission.mjs';
import * as playwright from './browser-playwright.mjs';
import {install} from './browser-machine-policy.mjs';
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {runT1Child} from './t1-runner.mjs';

install(playwright);

const parent=resolve('tmp',process.env.WS_LANE_NAME??'browser-task');mkdirSync(parent,{recursive:true});
const scratch=mkdtempSync(join(parent,'runner-native-')),policy=join(scratch,'policy.json'),worker=join(scratch,'worker'),config=join(scratch,'config.mjs');
writeFileSync(policy,JSON.stringify({version:1,module:resolve('scripts/browser-machine-policy.mjs')}),{mode:0o600});
writeFileSync(config,`export default {testDir:${JSON.stringify(scratch)},testMatch:'owned.spec.mjs',workers:1,timeout:5000,reporter:'line',use:{headless:true,launchOptions:{args:${JSON.stringify(KEYCHAIN_ARGS)}}}};`);
writeFileSync(join(scratch,'owned.spec.mjs'),`import {createBrowserTest,expect} from ${JSON.stringify(pathToFileURL(resolve('scripts/browser-test.mjs')).href)};
import {readFileSync,writeFileSync} from 'node:fs';
if(process.env.TEST_WORKER_INDEX!==undefined)writeFileSync(${JSON.stringify(worker)},String(process.pid));
const test=createBrowserTest({path:${JSON.stringify(policy)}});
test('runner uses its pre-case reservation',async({browser})=>{
 const rows=JSON.parse(readFileSync(${JSON.stringify(join(cpuRoot(),'queue.json'))},'utf8')).cpuActive.filter(row=>row.browser===true&&row.holder===process.pid);
 expect(rows).toHaveLength(1);expect(rows[0].browserWeight??rows[0].slots).toBe(4);
 const page=await browser.newPage();await page.goto('data:text/html,<title>admitted</title>');await expect(page).toHaveTitle('admitted');await page.close();
});`);
/** @type {import('playwright').BrowserServer[]} */const held=[];
let pending;
try{
 held.push(await playwright.chromium.launchServer({headless:true,args:[...KEYCHAIN_ARGS]}),await playwright.chromium.launchServer({headless:true,args:[...KEYCHAIN_ARGS]}));
 pending=runT1Child(['pnpm','exec','playwright','test','--config',config],process.env,{timeoutMs:45000,capture:true});
 const deadline=Date.now()+30000;
 for(;;){
  const pid=existsSync(worker)?Number(readFileSync(worker,'utf8')):0;
  if(pid>1)break;
  if(Date.now()>deadline)throw new Error('Runner did not reach its pre-case browser queue');
  await delay(50);
 }
 await delay(7000); // Longer than the case budget, before collection/case work.
 await held[0]?.close();
 const result=await pending;pending=undefined;
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.equal(result.error,null);
 const pid=Number(readFileSync(worker,'utf8'));
 const rows=JSON.parse(readFileSync(join(cpuRoot(),'queue.json'),'utf8')).cpuActive;
 assert.equal(rows.filter((/** @type {{browser?:boolean,holder?:number}} */row)=>row.browser===true&&row.holder===pid).length,0);
 console.log(JSON.stringify({builtInBrowserFixture:true,queuedBeforeCaseMs:7000,caseBudgetMs:5000,singleFourCoreReservation:true,workerRowsAfterDrain:0}));
}finally{
 await Promise.all(held.map(browser=>browser.close()));
 await pending;
 rmSync(scratch,{recursive:true,force:true});
}
