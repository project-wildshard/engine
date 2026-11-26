// Queue for the machine browser slot in an automatic worker fixture, before
// Playwright starts test/context clocks. One worker owns one physical browser.
import {test as base} from '@playwright/test';
import * as playwright from './browser-playwright.mjs';
import {installMachineBrowserAdmission,reserveMachineBrowserAdmission} from './browser-machine-loader.mjs';

/** @param {import('./browser-machine-loader.d.mts').BrowserMachineOptions} [options] */
export function createBrowserTest(options={}){
/** @type {import('@playwright/test').Fixtures<object,{browserAdmission:undefined},import('@playwright/test').PlaywrightTestArgs&import('@playwright/test').PlaywrightTestOptions,import('@playwright/test').PlaywrightWorkerArgs&import('@playwright/test').PlaywrightWorkerOptions>} */
const fixtures={browserAdmission:[async({browserName},use)=>{
 if(!['chromium','firefox','webkit'].includes(browserName))throw new Error('Unknown browser backend for admission');
 await installMachineBrowserAdmission(playwright,options);
 const lease=await reserveMachineBrowserAdmission(options);
 try{
  const used=use(undefined);
  await(lease===undefined?used:Promise.race([used,lease.lost.then(()=>{throw new Error('Browser worker admission was lost');})]));
 }finally{await lease?.release();}
},{scope:'worker',auto:true,timeout:310000}]};
return base.extend(fixtures);
}
export const test=createBrowserTest();
export{expect}from '@playwright/test';
