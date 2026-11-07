import { expect,test } from 'vitest';
import { ProjectedState,ReturnProgram } from '../src/shared/game/population/returnProgram';
import { NALATI_NIGHT as nightInput } from './fixtures/nalati-night';
import {withWeatherWitness} from './fixtures/weatherInlineWitness';

const night=withWeatherWitness(nightInput);

test('authored slot cycles wake once, rotate nights and release corpses during daylight',()=>{
  const program=ReturnProgram.page(night.program),cycle=new ProjectedState({...night.slots.cycle,signals:{step:night.slots.cycle.signal}},program);
  const select=(count:number):number[]=>[...new Set(Array.from({length:night.slots.select.count},(_,slot)=>program.project(night.slots.select.signal,{...cycle.state,count,night:cycle.state.t,slot})['index']).flatMap(index=>index===undefined?[]:[index]))];
  expect(cycle.step(.05,{kind:1}).values).toEqual({});
  expect(cycle.step(.05,{kind:1}).values).toMatchObject({spawn:1,t:0});
  expect(select(12)).toEqual([0,2,4,7,9]);expect(select(3)).toEqual([0,2,1]);
  expect(cycle.step(.1,{kind:1}).values['spawn']).toBe(0);
  expect(cycle.step(.1,{kind:0}).values['dissolve']).toBe(1);
  const day=cycle.step(.1,{kind:0}).values;expect(day['dissolve']).toBe(0);expect(day[night.slots.release]).toBe(1);
  expect(cycle.step(.1,{kind:1}).values).toMatchObject({spawn:1,t:1});
  expect(select(12)).toEqual([2,4,6,0,10]);
});

test('authored slot members publish one break, retirement and a living home return',()=>{
  const member=new ProjectedState(night.slots.member,ReturnProgram.page(night.program));
  expect(member.project({dt:.1,alive:0,gone:0})).toMatchObject({broken:1,retire:0});
  expect(member.project({dt:.1,alive:0,gone:0})).toMatchObject({broken:0});
  expect(member.project({dt:3.2,alive:0,gone:0})).toMatchObject({retire:1});
  member.reset();expect(member.project({dt:.1,alive:1,gone:1})).toMatchObject({statue:1,retire:1});
});
