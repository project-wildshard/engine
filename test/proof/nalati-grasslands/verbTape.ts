import type {HeadlessTapePlan} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';

const press=(value:number):HeadlessCommand=>({kind:'script',actorId:'nalati.talk',value});
const campRoad:readonly [number,number][]=[[20,216],[40,218],[60,214],[66,209.5],[73,206.1],[83,206],[84.8,203.8],[88,204.5],[95,204],
  [94,210],[91,216],[86.6,219.5]];
/** The real north-road approach and camp yard, followed by USE presses. No
 * teleport, planted flag, horse, score or quest completion enters the tape. */
export function nalatiCampIntroTape(start:{readonly x:number;readonly z:number}):HeadlessTapePlan {
  return {version:1,observe:['nalati.talk'],segments:[
    {id:'elder-out-of-reach',ticks:1,commands:[press(0)]},
    {id:'walk-to-elder',ticks:6000,commands:[],route:[{x:start.x,z:start.z},
      ...campRoad.map(([x,z])=>({x,z}))]},
    {id:'open-elder-reading',ticks:1,commands:[press(0)]},
    {id:'cancel-elder-reading',ticks:1,commands:[press(-1)]},
    {id:'finish-elder-reading',ticks:160,commands:[],frames:Array.from({length:160},(_,tick)=>tick%16===0?[press(0)]:[])},
  ]};
}

/** Continue through the camp yard to every authored speaker, including the
 * centre of Ayan's live orbit. USE still resolves the actual moving prompt. */
export function nalatiCampTalkTape(start:{readonly x:number;readonly z:number}):HeadlessTapePlan {
  const plan=nalatiCampIntroTape(start);
  const talk=(id:string,index:number):HeadlessTapePlan['segments']=>[
    {id:`open-${id}`,ticks:1,commands:[press(index)]},
    {id:`read-${id}`,ticks:96,commands:[],frames:Array.from({length:96},(_,tick)=>tick%16===0?[press(index)]:[])},
    {id:`dismiss-${id}`,ticks:1,commands:[press(-1)]},
  ];
  const walk=(id:string,points:readonly [number,number][]):HeadlessTapePlan['segments'][number]=>({id,ticks:2400,commands:[],route:points.map(([x,z])=>({x,z}))});
  return {...plan,observe:['nalati.talk','nalati.figures'],segments:[...plan.segments,
    {id:'leave-elder',ticks:1,commands:[press(-1)]},
    walk('walk-to-herderRail',[[86.6,219.5],[91,216],[94,210],[94,208.5],[88,207],[83,206],[73,206.1],[72.4,212.9]]),
    ...talk('herderRail',2),
    // The lane between the two yurts avoids their real overhanging roof hulls.
    walk('walk-to-herderGate',[[72.4,212.9],[73,206.1],[83,206],[88,207],[94,208.5],[98,208.5],[105.5,208.5],[106.5,215],[105.2,217.5]]),
    ...talk('herderGate',1),
    walk('walk-to-cook',[[105.2,217.5],[106.5,215],[105.5,208.5],[98,208.5],[94,208.5],[91.7,209]]),...talk('cook',4),
    // The orbit centre is the solid camp pole, so approach beside it.
    walk('walk-to-child',[[91.7,209],[90,209],[88.8,209.8]]),...talk('child',3),
  ]};
}
