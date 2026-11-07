import { expect,test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { configureGrassFieldData,populationMeadow } from '../../../../shared/game/systems/looks/grassField';
import { parse } from 'valibot';
import { PopulationFieldSchema } from '@wildshard/format/populationEnvironment';

test('orchard meadow rows preserve river widths and clamp beyond the admitted profile',()=>{
  const scope=new Scope('orchard.meadow'),input={seed:29,world:{res:2,size:20,water:-100,wet:'raster',pond:'raster'},trails:[],
    river:{from:-10,step:20,values:[[1,3],[5,7]]},meadow:{short:[],tall:[],bare:[],valley:.4,plateau:.7}};
  try{
    const field=configureGrassFieldData(input,scope);
    expect(field.riverZ(0)).toBe(3);expect(field.riverHalf(0)).toBe(5);
    expect(field.riverZ(-100)).toBe(1);expect(field.riverHalf(100)).toBe(7);
    expect(field.valley).toBe(.4);
    expect(()=>configureGrassFieldData({...input,river:{...input.river,step:0}},scope)).toThrow();
    expect(()=>configureGrassFieldData({...input,riverZ:()=>0},scope)).toThrow();
  }finally{scope.dispose();}
});

test('page and native meadow readers keep exact edge arithmetic and borrow admitted rows',()=>{
  const scope=new Scope('meadow.profile'),input={seed:29,world:{res:2,size:20,water:-100,wet:'raster',pond:'raster'},trails:[],
    river:{from:-6,step:4,values:[[-0,1],[2,3],[-2,7]]},meadow:{short:[],tall:[],bare:[],valley:.4,plateau:.7}};
  const rows=parse(PopulationFieldSchema,input),native=populationMeadow(rows);
  try{
    const page=configureGrassFieldData(input,scope);
    for(const [x,z,half] of [[-Infinity,0,1],[-100,0,1],[-6,0,1],[-4,1,2],[-2,2,3],[0,0,5],[2,-2,7],[100,-2,7],[Infinity,-2,7],[Number.NaN,Number.NaN,Number.NaN]]){
      if(x===undefined||z===undefined||half===undefined)throw new Error('Missing profile sample');
      expect(native.riverZ(x)).toBe(z);expect(page.riverZ(x)).toBe(z);
      expect(native.riverHalf(x)).toBe(half);expect(page.riverHalf(x)).toBe(half);
    }
    expect(native.short).toBe(rows.meadow.short);expect(native.tall).toBe(rows.meadow.tall);expect(native.bare).toBe(rows.meadow.bare);
    const first=rows.river.values[0];if(first===undefined)throw new Error('Missing river section');
    first[0]=3;expect(native.riverZ(-100)).toBe(3);
  }finally{scope.dispose();}
});
