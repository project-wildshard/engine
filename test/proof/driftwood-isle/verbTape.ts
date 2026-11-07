import type {HeadlessTapePlan,HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';

const walk=(id:string,points:[number,number][],ticks:number):HeadlessTapeSegment=>({id,ticks,commands:[],route:points.map(([x,z])=>({x,z}))});
const use=(id:string,value:number):HeadlessTapeSegment=>({id,ticks:1,commands:[{kind:'script',actorId:'driftwood.interact',value}]});
/** A continuous walk from the shipping spawn; every reward comes from its
 * range/quest owner. These are steering inputs, never poses or saved flags. */
export function driftwoodQuestIntroTape():HeadlessTapePlan {
  return {version:1,observe:[],segments:[
    use('chest-out-of-reach',100),
    walk('walk-to-castaway',[[0,-186.5],[-8,-172],[-17,-161],[-20,-150],[-30,-142],[-30,-130],[-30,-118],[-30,-106],[-30,-104],[-24,-80],[-22,-74],[-22,-71.5]],5000),
    use('talk-to-castaway',0),
    walk('walk-to-chest',[[-22,-71.5],[-22,-68.9],[-22,-67.6],[-22,-66.7],[-22,-65.2],[-22,-62.9]],900),
    use('open-chest',100),use('open-chest-again',100),
    walk('walk-to-lookout',[[-22,-67.6],[-22,-71.5],[-8,-50],[10.8,-27.8],[15.4,-8.6],[15.6,-7],[13.88,11.88],[15.29,13.29],[23.99,21.99],[31.98,29.98],[35.8,33.8],[46,46],[60,60],[76,76],[86.1,82.45],[86.94,83.68],[87.68,84.76],[90.27,88.55],[92.76,92.18],[94.17,94.25]],9000),
    use('light-beacon',101),
    walk('walk-to-lookout-shard',[[94.17,94.25],[93.65,95.2]],600),
    use('take-lookout-shard',102),use('take-lookout-shard-again',102),
  ]};
}
