// @vitest-environment node
import {expect,test} from 'vitest';
import {openFolderSession} from './fixtures/headless/folderSession';
import type {HeadlessCommand} from '../src/shared/host/tickProtocol';
import type {HeadlessTapeSegment} from '../src/shared/host/headlessTape';

const walk=(id:string,points:[number,number][]):HeadlessTapeSegment=>({id,ticks:5000,commands:[],route:points.map(([x,z])=>({x,z}))});
const CRANK={x:85.67,y:17.67,z:-6};

// OF19d crank bug (staging v0.1.53, Dunes rev 4): a page's heavy whip crack reaches the server as a HEAVY button (held, or one
// command's tap) let go with the look's pitch, never a script naming the crank. The server's half: from the CI stand and the
// walk's stands, facing the crank, that input raises it, and the well then gives the oil. (The staging miss was the page's: its
// grid kit was off the wire, so the server never heard the crack; regional-kit-wire.test.ts.)
test.each([{stand:[81.5,-5],hold:60},{stand:[88.1,-3.6],hold:1},{stand:[84.8,-4.4],hold:60}] as const)(
  'a page\'s heavy crack reaches the crank and the well gives the oil (%j)',async({stand:at,hold:holdTicks})=>{
  const f=await openFolderSession('sunscar-dunes');
  try{
    const declared=f.product.shardfile.questHost;
    if(declared===undefined||declared===null)throw new Error('Missing admitted Signal quest host');
    const action=(id:string)=>{const row=declared.interactions.rows.find(entry=>entry.id===id);if(row===undefined)throw new Error(`Missing Signal row ${id}`);return row.act;};
    const use=(id:string,row:string,ticks=1):HeadlessTapeSegment=>({id,ticks,commands:[{kind:'script',actorId:declared.graph.actor,value:action(row)}]});
    const part=async(segment:HeadlessTapeSegment)=>{
      const observation=(await f.sim.verbTapePart({version:1,observe:[declared.graph.step],segments:[segment]})).report.observations[0];
      if(observation===undefined)throw new Error(`Missing observation ${segment.id}`);return observation;
    };
    for(const segment of [walk('walk-to-sefa',[[0,70],[6,73]]),use('talk-to-sefa','talk'),
      walk('walk-to-logbook',[[-20,65],[-60,45],[-76.97,31.4]]),use('read-logbook','logbook')])await part(segment);
    const stand=(await part(walk('walk-to-stand',[[-60,35],[-20,20],[20,10],[60,0],[81.5,-5],[at[0],at[1]]]))).position;
    const [x,y,z]=stand,dx=CRANK.x-x,dz=CRANK.z-z;
    // the page's look: yaw toward the crank, pitch from the eye (1.68 m over the feet) to it
    const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(CRANK.y-y-1.68,Math.hypot(dx,dz));
    const held:HeadlessCommand={kind:'player',moveX:0,moveZ:0,yaw,pitch,heavy:{},swing:true};
    const free:HeadlessCommand={kind:'player',moveX:0,moveZ:0,yaw,pitch};
    // The well's skitterer pack stands about the crank stands; a lash that meets one of them strikes it, not the crank (Dunes r5's
    // pack sits in the 88.1 stand's lane on the tap's tick), so the page cracks again, as a player would, up to four times.
    const raised=(observation:{adapters:{id:string;state:string}[]})=>observation.adapters.some(row=>row.state.includes('"raised":true'));
    let hold=await part({id:'hold-heavy-0',ticks:holdTicks,commands:[held]}),go=await part({id:'let-go-0',ticks:90,commands:[free]});
    for(let attempt=1;attempt<4&&!raised(go);attempt++){
      hold=await part({id:`hold-heavy-${attempt}`,ticks:holdTicks,commands:[held]});go=await part({id:`let-go-${attempt}`,ticks:90,commands:[free]});
    }
    await part(walk('back-to-the-well',[[stand[0],stand[2]],[81.5,-5]]));
    const oil=await part(use('take-oil','well'));
    expect(oil.flags,JSON.stringify({stand,yaw,pitch,hold:hold.adapters,go:go.adapters})).toContain('sunscar.oil');
  }finally{await f.sim.dispose();}
},60_000);
