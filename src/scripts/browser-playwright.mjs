import * as playwright from 'playwright';
import {admittedPlaywright} from './browser-machine-loader.mjs';

await admittedPlaywright(playwright);
export const {chromium,firefox,webkit,devices,request,selectors,errors}=playwright;
