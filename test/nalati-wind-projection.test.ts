import {Scope} from '../src/shared/engine/app/scope';
import {lendNalatiPasture} from './fixtures/nalati-return-modules';
import { expect, test, beforeEach, afterEach } from 'vitest';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import {titanPrograms as programs} from './fixtures/titanInlineWitness';

let programmeScope:Scope;
beforeEach(()=>{programmeScope=new Scope('original-pasture-fixture');lendNalatiPasture(programmeScope);});
afterEach(()=>{programmeScope.dispose();});

test('packed wind preserves the existing native trajectory and hit clock',()=>{
  const law=ReturnProgram.page(programs.wind,programmeScope);
  for(const start of [0,177.2,100000]){
    let expected={x:17,z:-6,vx:0,vz:0,cd:.3};const actual={...expected};
    for(let i=0;i<160;i++){
      const frame={dt:i%9===0?.3:.1,cx:2,cz:-3,radius:30,t:start+i*.1,index:i%3,hit:Number(i%5===0),open:1,px:10,pz:-5,flank:4,wx:.7,wz:-.4};
      const {dt,cx,cz,radius,t,index,hit,open,px,pz,flank,wx,wz}=frame;
      let {x,z,vx,vz}=expected;const cd=expected.cd-(hit>0?dt:0);
      const angle=Math.sin(t*.3+index*2)*1.2+Math.atan2(cz-z,cx-x)*.35,k=Math.min(1,dt*.6);
      vx+=(Math.cos(angle)*4.2+wx*1.5-vx)*k;vz+=(Math.sin(angle)*4.2+wz*1.5-vz)*k;x+=vx*dt;z+=vz*dt;
      const d=Math.sqrt((x-cx)*(x-cx)+(z-cz)*(z-cz));if(d>radius-8){x=cx+(x-cx)*(radius-8)/d;z=cz+(z-cz)*(radius-8)/d;}
      const hurt=open>0&&cd<=0&&Math.sqrt((px-x)*(px-x)+(pz-z)*(pz-z))<flank;
      expected={x,z,vx,vz,cd:hurt?2:cd};
      const out=law.project('whirl',{...actual,...frame});
      for(const key of ['x','z','vx','vz','cd']as const){const value=out[key];if(value===undefined)throw new Error('Missing wind continuation');actual[key]=value;expect(value).toBeCloseTo(expected[key],8);}
      expect(out['hurt']).toBe(Number(hurt));expect(out['broke']).toBe(Number(hit>0||hurt));
    }
  }
});
