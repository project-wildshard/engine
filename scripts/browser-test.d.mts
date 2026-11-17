import type * as Playwright from '@playwright/test';
import type {BrowserMachineOptions} from './browser-machine-loader.d.mts';

export function createBrowserTest(options?:BrowserMachineOptions):typeof Playwright.test;
export const test:typeof Playwright.test;
export const expect:typeof Playwright.expect;
