import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapePlan} from '../../../src/shared/host/headlessTape';

const press=(actorId:string,value=1):HeadlessCommand=>({kind:'script',actorId,value});
const type=(text:string):HeadlessCommand[][]=>Array.from(text,character=>{
  const point=character.codePointAt(0);if(point===undefined)throw new Error('Missing typed name code point');
  return [press('nalati.name.character',point)];
});

/** USE and actual text editing at the rail; the name is not a gameplay flag
 * or an actor override carried by the tape. The camp horses are unbonded. */
export function nalatiHorseNameTape():HeadlessTapePlan {
  return {version:1,observe:['nalati.companions'],segments:[
    {id:'name-out-of-reach',ticks:1,commands:[press('nalati.name.open')]},
    {id:'remote-draft',ticks:4,commands:[],frames:type('Away')},
    {id:'remote-submit',ticks:1,commands:[press('nalati.name.submit')]},
    {id:'unbonded-whistle',ticks:1,commands:[press('nalati.whistle')]},
    {id:'walk-to-hitch-rail',ticks:6000,commands:[],route:[{x:20,z:216},{x:40,z:218},{x:60,z:214},
      {x:66,z:209.5},{x:66,z:211.5},{x:70.5,z:212.6}]},
    {id:'await-name-prompt',ticks:12,commands:[]},
    {id:'open-cancelled-name',ticks:1,commands:[press('nalati.name.open')]},
    {id:'erase-cancelled-name',ticks:32,commands:[press('nalati.name.character',8)]},
    {id:'cancelled-draft',ticks:9,commands:[],frames:type('Cancelled')},
    {id:'cancel-name',ticks:1,commands:[press('nalati.name.close')]},
    {id:'await-prompt-again',ticks:12,commands:[]},
    {id:'open-name',ticks:1,commands:[press('nalati.name.open')]},
    {id:'erase-name',ticks:32,commands:[press('nalati.name.character',8)]},
    {id:'type-name',ticks:5,commands:[],frames:type('Kunes')},
    {id:'submit-name',ticks:1,commands:[press('nalati.name.submit')]},
    {id:'close-name',ticks:1,commands:[press('nalati.name.close')]},
    {id:'renamed-unbonded-whistle',ticks:1,commands:[press('nalati.whistle')]},
  ]};
}
