import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapePlan} from '../../../src/shared/host/headlessTape';

type Player=Extract<HeadlessCommand,{kind:'player'}>;
const player=(input:Partial<Player>={}):Player=>({kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,
  steer:{keyX:0,keyY:1,stickX:0,stickY:0},...input});

/** Real locomotion and water inputs from the unchanged entry. A board hop
 * clears the bridge rail; no teleport or collider exception opens the river. */
export function nalatiWorldTape():HeadlessTapePlan {
  return {version:1,observe:['nalati.world'],segments:[
    {id:'settle',ticks:60,commands:[]},
    {id:'walk',ticks:30,commands:[player()]},
    {id:'sprint',ticks:30,commands:[player({sprint:true})]},
    {id:'crouch',ticks:30,commands:[player({crouch:true})]},
    {id:'jump',ticks:1,commands:[player({jump:true})]},
    {id:'land',ticks:90,commands:[]},
    {id:'walk-to-bridge',ticks:6000,commands:[],route:[{x:0,z:200},{x:0,z:190},{x:0,z:172}]},
    {id:'board-to-clear-rail',ticks:1,commands:[player({hover:true,steer:{keyX:0,keyY:0,stickX:0,stickY:0}})]},
    {id:'board-settle',ticks:30,commands:[]},
    {id:'board-hop',ticks:1,commands:[player({yaw:-Math.PI/2,jump:true})]},
    {id:'cross-rail',ticks:60,commands:[player({yaw:-Math.PI/2})]},
    {id:'leave-board',ticks:1,commands:[player({hover:true})]},
    {id:'land-in-river',ticks:120,commands:[]},
    {id:'wade',ticks:600,commands:[],route:[{x:4,z:170},{x:4,z:163.5}]},
    {id:'swim',ticks:16,commands:[player()]},
    {id:'hover-on',ticks:1,commands:[player({hover:true})]},
    {id:'hover-river',ticks:120,commands:[player({yaw:-Math.PI/2})]},
    {id:'hover-off',ticks:1,commands:[player({hover:true})]},
  ]};
}
