import type {HeadlessTapePlan} from '../../../src/shared/host/headlessTape';

/** Only actual keeper commands: the unearned roost/vanes/winch never become
 * synthetic setup flags. Later combat and traversal remain separate work. */
export function skyKeeperTape():HeadlessTapePlan {
  return {version:1,observe:[],segments:[
    {id:'keeper-out-of-reach',ticks:1,commands:[{kind:'script',actorId:'far.interact',value:0}]},
    {id:'walk-to-keeper',ticks:1200,route:[{x:0,z:-5.5},{x:-2.4,z:-13.6}],commands:[]},
    {id:'talk-to-keeper',ticks:1,commands:[{kind:'script',actorId:'far.interact',value:0}]},
    {id:'talk-to-keeper-again',ticks:1,commands:[{kind:'script',actorId:'far.interact',value:0}]},
    {id:'unearned-winch',ticks:1,commands:[{kind:'script',actorId:'far.interact',value:2}]},
  ]};
}
