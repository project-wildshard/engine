// Actual headless forms under J402's machine CPU ledger. No personal browser.
// J381: legacy browser-lane hook is skipped only because every launch below
// uses J402 machine admission; Chromium keeps all KEYCHAIN_ARGS.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from './browser-playwright.mjs';
import {install,reserve} from './browser-machine-policy.mjs';
import {KEYCHAIN_ARGS} from './.kit/chromium-keychain.mjs';

install({chromium,firefox,webkit});
const scratch=resolve(process.argv[2]??'tmp/codex-pagesize/browser-native');mkdirSync(scratch,{recursive:true});
const profile=mkdtempSync(resolve(scratch,'webkit-profile-'));
/** @returns {{browser?:boolean,holder?:number,owner?:number,slots:number,browserWeight?:number}[]} */
function ownRows(){return JSON.parse(readFileSync(resolve(homedir(),'.wildshard-heavy-lanes','queue.json'),'utf8')).cpuActive.filter((/** @type {{browser?:boolean,holder?:number,owner?:number}} */row)=>row.browser===true&&(row.holder===process.pid||row.owner===process.pid));}
/** @type {string[]} */const forms=[];
try{
 for(const form of ['launch','launchServer','launchPersistentContext']){
  const handle=form==='launch'?await chromium.launch({headless:true,args:[...KEYCHAIN_ARGS]}):form==='launchServer'?await chromium.launchServer({headless:true,args:[...KEYCHAIN_ARGS]}):await webkit.launchPersistentContext(profile,{headless:true,viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  try{
   const rows=ownRows();assert.equal(rows.length,1);assert.equal(rows[0].browserWeight??rows[0].slots,4);
   forms.push(form);
  }finally{await handle.close();}
  assert.equal(ownRows().length,0,'physical close must drain its owned reservation');
 }
 const file=await reserve();
 try{
  assert.equal(ownRows().length,1);
  const browser=await chromium.launch({headless:true,args:[...KEYCHAIN_ARGS]});
  try{assert.equal(ownRows().length,1,'file admission must avoid a second browser slot');}finally{await browser.close();}
  assert.equal(ownRows().length,1,'file admission survives its physical browser until file teardown');
 }finally{await file.release();}
 assert.equal(ownRows().length,0);
 console.log(JSON.stringify({forms,ownedBrowserSlotsPerLaunch:1,chargedCoresPerLaunch:4,preCaseReservation:true,ownedRowsAfterDrain:ownRows().length}));
}finally{rmSync(profile,{recursive:true,force:true});}
