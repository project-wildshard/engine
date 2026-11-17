import * as playwright from 'playwright';
import {installMachineBrowserAdmission} from './browser-machine-loader.mjs';

await installMachineBrowserAdmission(playwright);
export const {chromium,firefox,webkit,devices,request,selectors,errors}=playwright;
