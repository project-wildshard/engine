import {expect,test} from 'vitest';
import {browserErrorDeliveryAllowed} from './browserErrors';

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
