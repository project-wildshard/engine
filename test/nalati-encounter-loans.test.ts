import {expect,test} from 'vitest';
import type {SpeciesData,SpeciesVariantData} from '@wildshard/format/speciesPrograms';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import type {NalatiEncounterIntake} from './fixtures/nalati-world';
import {validateEncounterLoans,encounterDriver} from '../src/server/game/population/encounterIntake';

const variant:SpeciesVariantData={id:'king',label:'King',rarity:'legendary',weight:1,scale:[1.22,1.22],hp:2400};
const species:SpeciesData={id:'test.king',kind:'king',label:'King',tick:'always',variants:[variant]};
const intake:NalatiEncounterIntake={species:[species],recipes:[],borrowedKinds:['king'],alwaysKinds:['king']};
const boot={species:{king:{kind:'king',variants:[variant]}},hunt:{},recipes:[]};
test('a closed variant book lends only its exact existing declaration without mutation',()=>{
  const before=structuredClone(boot);validateEncounterLoans(boot,intake);expect(boot).toEqual(before);
  validateEncounterLoans(boot,{species:[],recipes:[]});
});
test('missing, foreign, duplicate and changed variant loans refuse',()=>{
  for(const changed of [{...intake,borrowedKinds:['missing']},{...intake,borrowedKinds:['king','king']},
    {...intake,species:[{...species,variants:[{...variant,hp:2399}]}]},
    {...intake,species:[{...species,variants:[{...variant,scale:[-0,1.22] as [number,number]}]}]}])
    expect(()=>validateEncounterLoans(boot,changed)).toThrow();
  expect(()=>validateEncounterLoans({...boot,species:{}},intake)).toThrow();
});
test('an existing decision owner cannot be replaced by a recipe loan',()=>{
  expect(()=>validateEncounterLoans({...boot,hunt:{king:species}},intake)).toThrow();
});
test('always cadence is an explicit admitted species loan',()=>{
  expect(()=>validateEncounterLoans(boot,{...intake,alwaysKinds:['other']})).toThrow();
  expect(()=>validateEncounterLoans(boot,{...intake,alwaysKinds:['king','king']})).toThrow();
  expect(()=>validateEncounterLoans(boot,{...intake,species:[{...species,tick:'ai'}]})).toThrow();
});

test('even an otherwise admitted body recipe cannot be overwritten',()=>{
  const recipe=SIM_LEVEL.entities[0]?.spec;if(recipe===undefined)throw new Error('Missing unplayed recipe');
  expect(()=>validateEncounterLoans({...boot,recipes:[recipe]},{species:[],recipes:[recipe]})).toThrow('replace');
});

test('ordinary always metadata cannot change the preceding chapter driver',()=>{
  const driver={dispatch:'original'};
  expect(encounterDriver(driver,{species:[species],recipes:[]})).toBe(driver);
  expect(encounterDriver(driver,intake)).toEqual({...driver,alwaysKinds:['king']});
});
