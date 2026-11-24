import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {Rng} from '@wildshard/format/seededRng';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {ReturnProjectionV2} from '../src/shared/game/population/returnProjectionV2';
import {parseReturnProjectionV2} from '@wildshard/format/returnProjectionV2';
import {ReturnProgramSchema} from '@wildshard/format/namedJsonContracts';
import {parse} from 'valibot';
import {sdkBuiltJson} from './fixtures/sdk-built/snapshots';

// SDK retains all seven cases. Keep the original private unscoped refusal
// and its complete cache identity case against the exact compiled descriptor.
test('full group metadata participates in cache identity before any second instance can be constructed', () => {
  const parsed=parse(ReturnProgramSchema,sdkBuiltJson('sdk-return-group.json'));
  if(parsed.v2===undefined || parsed.v2.groups===undefined)throw new Error('Missing group descriptor');
  const descriptor={...parsed,v2:parsed.v2},groups=parsed.v2.groups;
  const owner = new Scope('shared-group-declarations');
  try {
    const programme = ReturnProgram.page(descriptor, owner), changed = structuredClone(descriptor);
    changed.v2.groups = { ...groups, signals: ['different'] };
    expect(() => ReturnProgram.page(changed, owner)).toThrow('Shared return declaration changed');
    expect(ReturnProgram.page(descriptor, owner)).toBe(programme);
    const unowned=ReturnProgram.page(descriptor),random=new Rng(43),oracle=new Rng(43);
    expect(unowned.project('run',{value:3},random)).toStrictEqual({out:3+oracle.next()});
    expect(unowned.prepareGroup).toBeUndefined();
    expect(()=>new ReturnProjectionV2(descriptor.v2).prepareGroup({group:'first',handle:1,signal:'advance',tick:0,state:Float64Array.of(0),members:[],references:[]})).toThrow('entered scope');
    expect(() => parseReturnProjectionV2({ ...descriptor.v2, groups: { ...groups, pages: 2 } })).toThrow('pages');
  } finally { owner.dispose(); }
});
