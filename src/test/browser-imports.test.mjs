import {expect,test} from 'vitest';
import {runtimePlaywrightImports,unadmittedBrowserImports} from '../scripts/browser-imports.mjs';

test('runtime browser imports include aliases and dynamic loading but exclude types and examples',()=>{
 for(const source of ["import {chromium as engine} from 'playwright';", "const {webkit}=await import('playwright');", "import * as drivers from 'playwright';", "import 'playwright';", "import driver,{type Browser} from 'playwright';", "const engine=require('playwright');"]){expect(runtimePlaywrightImports(source)).toHaveLength(1);}
 for(const source of ["import type {Browser} from 'playwright';", "import {type Browser} from 'playwright';", "type Driver=import('playwright').Browser;", "// import {chromium} from 'playwright';", "import {admittedPlaywright as admit} from './.kit/browser-machine-loader.mjs';const engine=await admit(require('playwright'));", 'const example="import {chromium} from \'playwright\';";']){expect(runtimePlaywrightImports(source)).toEqual([]);}
});
test('every executable engine Playwright import passes through the admission bridge',()=>{
 expect(unadmittedBrowserImports()).toEqual([]);
});

test('core, runner authority and re-exports cannot bypass launch admission',()=>{
 for(const source of ["import {chromium} from 'playwright-core';","import {test as trial} from '@playwright/test';","export * from 'playwright';","export {chromium} from 'playwright';","export {test} from '@playwright/test';","const core=await import('playwright-core');"]){expect(runtimePlaywrightImports(source)).toHaveLength(1);}
 for(const source of ["import {expect,defineConfig,devices,errors} from '@playwright/test';","export {expect} from '@playwright/test';","export type {Browser} from 'playwright';"]){expect(runtimePlaywrightImports(source)).toEqual([]);}
});
