import {expect,test} from 'vitest';
import type {ErrorEvent} from '@sentry/browser';
import {browserErrorDeliveryAllowed,browserErrorEnvironment,browserErrorNoise,browserErrorRelease} from './browserErrors';

const origins=['https://play.example.invalid'] as const;
test.each([
  ['https://play.example.invalid',false,false,true],
  ['https://play.example.invalid',true,false,false],
  ['https://play.example.invalid',false,true,false],
  ['http://localhost:4401',false,false,false],
  ['http://127.0.0.1:4401',false,false,false],
  ['https://preview.example.invalid',false,false,false],
  ['https://play.example.invalid.evil.invalid',false,false,false],
  ['http://play.example.invalid',false,false,false],
] as const)('browser error eligibility %s automated=%s harness=%s', (origin,automated,harness,allowed)=>{
  expect(browserErrorDeliveryAllowed({origin,automated,harness},origins)).toBe(allowed);
});
test('an uninstalled or unconfigured app identity cannot opt in by build mode or DSN',()=>{
  expect(browserErrorDeliveryAllowed({origin:origins[0],automated:false,harness:false},[])).toBe(false);
});

test('an origin reports under its mapped environment, and an unmapped allowed origin is production',()=>{
  const environments={'https://staging.example.invalid':'staging','https://preview.example.invalid':'preview'};
  expect(browserErrorEnvironment('https://staging.example.invalid',environments)).toBe('staging');
  expect(browserErrorEnvironment('https://preview.example.invalid',environments)).toBe('preview');
  expect(browserErrorEnvironment('https://play.example.invalid',environments)).toBe('production');
  expect(browserErrorEnvironment('toString',environments)).toBe('production');
});

const desktop='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const page={environment:'production',userAgent:desktop};
const thrown=(value:string,files:readonly string[]=['https://play.example.invalid/assets/main-abc.js']):ErrorEvent=>({
  type:undefined,
  exception:{values:[{type:'Error',value,stacktrace:{frames:files.map((filename)=>({filename,function:'f',lineno:1,colno:1}))}}]},
});
test.each([
  ['extension-only frames',thrown('boom',['chrome-extension://abc/content.js','moz-extension://def/inject.js']),page,'extension'],
  ['safari extension frames',thrown('boom',['safari-web-extension://abc/x.js','webkit-masked-url://hidden/']),page,'extension'],
  ['the harness-pins probe error',thrown('Probe control requires the harness pins'),page,'probe'],
  ['a QB8 capture on production',thrown('QB8 capture: a forced uncaught error in play'),page,'qb8'],
  ['a QB8 capture on preview',thrown('QB8 capture: a forced uncaught error in play'),{...page,environment:'preview'},'qb8'],
  ['a headless Chrome agent',thrown('boom'),{...page,userAgent:desktop.replace('Chrome/','HeadlessChrome/')},'automation'],
  ['a Playwright agent',thrown('boom'),{...page,userAgent:`${desktop} Playwright/1.60`},'automation'],
  ['a PhantomJS agent',thrown('boom'),{...page,userAgent:'Mozilla/5.0 PhantomJS/2.1.1'},'automation'],
  ['a ResizeObserver loop limit',thrown('ResizeObserver loop limit exceeded'),page,'resize-observer'],
  ['a ResizeObserver undelivered loop',thrown('ResizeObserver loop completed with undelivered notifications.'),page,'resize-observer'],
  ['a frameless Script error.',thrown('Script error.',[]),page,'script-error'],
  ['a Script error. message event',{type:undefined,message:'Script error.'},page,'script-error'],
] as const)('S6 drops %s',(_name,event,where,reason)=>{
  expect(browserErrorNoise(event,where)).toBe(reason);
});
test.each([
  ['a real first-party error',thrown("Cannot read properties of undefined (reading 'position')"),page],
  ['a first-party frame among extension frames',thrown('boom',['chrome-extension://abc/content.js','https://play.example.invalid/assets/main-abc.js']),page],
  ['a QB8 capture on staging',thrown('QB8 capture: a forced uncaught error in play'),{...page,environment:'staging'}],
  ['a Script error. with a first-party frame',thrown('Script error.'),page],
  ['a Script error. with an anonymous frame',thrown('Script error.',['<anonymous>']),page],
  ['an extension frame beside an anonymous frame',thrown('boom',['chrome-extension://abc/content.js','<anonymous>']),page],
  ['an extension frame beside a nameless frame',thrown('boom',['chrome-extension://abc/content.js','']),page],
  ['a frameless real error',thrown('The game stopped loading at step "gap"',[]),page],
] as const)('S6 keeps %s',(_name,event,where)=>{
  expect(browserErrorNoise(event,where)).toBeNull();
});

test('S5: the release is the app slug at its version, and nothing without both',()=>{
  expect(browserErrorRelease('wildshard','0.1.7')).toBe('wildshard@0.1.7');
  expect(browserErrorRelease(undefined,'0.1.7')).toBeUndefined();
  expect(browserErrorRelease('wildshard',undefined)).toBeUndefined();
  expect(browserErrorRelease('wildshard','')).toBeUndefined();
});
