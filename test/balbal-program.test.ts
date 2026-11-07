import { originalSpeciesJson } from './fixtures/nalati-original-species';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import { lendNalatiHeld } from './fixtures/nalati-return-modules';
import { object, parse } from 'valibot';
import { CreatureGuestSchema } from '@wildshard/format/speciesBookRows';
import { program } from './fixtures/projectedCreature';
import * as strikes from '../src/shared/engine/ai/strikeRows';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';

const generated=parse(object({presentation:object({guest:CreatureGuestSchema})}),originalSpeciesJson('species.json'));

let scope:Scope;
beforeEach(()=>{scope=new Scope('balbal-program');scope.expose(app,'levelScope',scope);lendNalatiHeld(scope);});
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
  expect(strikeRead).toHaveBeenCalledExactlyOnceWith(generated.presentation.guest.strike);
  expect(programRead).toHaveBeenCalledOnce();
  expect(strikeRead.mock.invocationCallOrder[0]).toBeLessThan(programRead.mock.invocationCallOrder[0]??0);
});

test('the defining admission refuses malformed native strike rows',()=>{
  const guest=generated.presentation.guest;
  for(const shape of [{kind:'wedge',length:-1,halfAngle:.96},{kind:'wedge',length:3.5,halfAngle:Number.NaN},{kind:'unknown'}]) {
    expect(()=>parse(CreatureGuestSchema,{...guest,strike:{...guest.strike,shape}})).toThrow();
  }
});
