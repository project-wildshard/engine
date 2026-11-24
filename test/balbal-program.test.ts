import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import { parse } from 'valibot';
import { CreatureGuestSchema } from '@wildshard/format/speciesBookRows';
import { program } from './fixtures/projectedCreature';
import * as strikes from '../src/shared/engine/ai/strikeRows';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { liveBalbalGuest } from './fixtures/liveNalati';
import { lendLiveNalati } from './fixtures/liveNalati';
const rows = liveBalbalGuest;

const generated=parse(CreatureGuestSchema,rows);

let scope:Scope;
beforeEach(()=>{scope=new Scope('balbal-program');scope.expose(app,'levelScope',scope);lendLiveNalati(scope);});
afterEach(()=>{vi.restoreAllMocks();scope.dispose();});

test('a strike refusal cannot publish a program or start a later encounter',()=>{
  const strikeRead=vi.spyOn(strikes,'strikeFromData').mockImplementation(()=>{throw new Error('Native strike refused');});
  const programRead=vi.spyOn(ReturnProgram,'page'),encounter=vi.fn();
  expect(()=>{encounter(program());}).toThrow('Native strike refused');
  expect(strikeRead).toHaveBeenCalledOnce();
  expect(programRead).not.toHaveBeenCalled();expect(encounter).not.toHaveBeenCalled();
});

test('native strike binding precedes program allocation and is reused',()=>{
  const strikeRead=vi.spyOn(strikes,'strikeFromData'),programRead=vi.spyOn(ReturnProgram,'page');
  const first=program();expect(program()).toBe(first);
  expect(strikeRead).toHaveBeenCalledExactlyOnceWith(generated.strike);
  expect(programRead).toHaveBeenCalledOnce();
  expect(strikeRead.mock.invocationCallOrder[0]).toBeLessThan(programRead.mock.invocationCallOrder[0]??0);
});

test('the defining admission refuses malformed native strike rows',()=>{
  const guest=generated;
  for(const shape of [{kind:'wedge',length:-1,halfAngle:.96},{kind:'wedge',length:3.5,halfAngle:Number.NaN},{kind:'unknown'}]) {
    expect(()=>parse(CreatureGuestSchema,{...guest,strike:{...guest.strike,shape}})).toThrow();
  }
});
