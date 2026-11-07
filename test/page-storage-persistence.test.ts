import {expect,test} from 'vitest';
import * as v from 'valibot';
import {SaveStore} from '../src/shared/engine/saves/store';
import {homeScreenPersistence,persistHomeScreen} from '../src/shared/engine/saves/runtime';

test('page boot asks outside standalone mode and coalesces with later content persistence',async()=>{
  let nativeRequests=0;
  const store=new SaveStore({local:null,session:null,persist:()=>{nativeRequests++;return Promise.resolve(true);}});
  const persisted=store.define({scope:'device',key:'storage.persisted',version:1,schema:v.boolean(),initial:()=>false});
  // The legacy helper still has its explicit installed-app policy.
  homeScreenPersistence(()=>false)(store);expect(nativeRequests).toBe(0);
  // The entry's page singleton runs before title/direct-chunk selection.
  persistHomeScreen(store);persistHomeScreen(store);
  expect(await store.persist()).toBe(true);
  expect(nativeRequests).toBe(1);expect(persisted.read()).toBe(true);
});
