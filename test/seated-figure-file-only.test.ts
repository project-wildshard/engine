import {expect,test,vi} from 'vitest';
import * as v from 'valibot';
import {zlibSync} from 'fflate';
import {MountedSpecimenSeatSchema} from '@wildshard/format/mountedSpecimenRows';
import {prepareSeatedFigure,seatedFigureView} from '../src/client/game/riding/seatedFigure';
import {MOUNTED_FIGURE} from './fixtures/nalati-poi-paint-original';
import {SHAPE_BYTES} from './fixtures/nalatiShapes';
import * as geometry from '../src/client/game/plugin/geometry';
import { installWorldFixture } from './fixtures/worldSetup';

await installWorldFixture();

function inlineRows(mixed:boolean){
  return v.parse(MountedSpecimenSeatSchema,{...MOUNTED_FIGURE,shapes:MOUNTED_FIGURE.shapes.map((shape,index)=>{
    if(!('file'in shape))throw new Error('Shipped seat shape is inline');
    const bytes=SHAPE_BYTES.get(shape.file);if(bytes===undefined)throw new Error('Missing original shape');
    return mixed&&index===0?shape:{key:shape.key,geometry:shape.geometry,data:Buffer.from(zlibSync(bytes)).toString('base64')};
  })});
}

test.each([false,true])('seated shapes reject inline/mixed sources before reads or resource publication (%s)',async mixed=>{
  const rows=inlineRows(mixed),file=vi.fn((name:string)=>{
    const bytes=SHAPE_BYTES.get(name);if(bytes===undefined)throw new Error('Missing original shape');return Promise.resolve(bytes);
  }),owned=vi.fn<()=>void>();
  const decode=vi.spyOn(geometry,'readBakedGeometry');
  try{
    await expect(prepareSeatedFigure({file},rows)).rejects.toThrow('Seated shapes require named binary files');
    expect(file).not.toHaveBeenCalled();
    expect(()=>seatedFigureView(rows,owned,SHAPE_BYTES)).toThrow('Seated shapes require named binary files');
    expect(decode).not.toHaveBeenCalled();expect(owned).not.toHaveBeenCalled();
  }finally{decode.mockRestore();}
});

test('the complete shipped rider prepares every named shape once through its verified owner',async()=>{
  const names=MOUNTED_FIGURE.shapes.map(shape=>{
    if(!('file'in shape))throw new Error('Shipped seat shape is inline');return shape.file;
  });
  expect(names).toEqual(['models/shapes/paint-2.bin','models/shapes/paint-3.bin']);
  const file=vi.fn((name:string)=>{const bytes=SHAPE_BYTES.get(name);if(bytes===undefined)throw new Error('Missing original shape');return Promise.resolve(bytes);});
  const files=await prepareSeatedFigure({file},MOUNTED_FIGURE);
  expect(file.mock.calls).toEqual(names.map(name=>[name]));
  for(const name of names)expect(files.get(name)).toBe(SHAPE_BYTES.get(name));
  const cleanup:(()=>void)[]=[],view=seatedFigureView(MOUNTED_FIGURE,resource=>{cleanup.push(()=>{resource.dispose();});},files);
  try{expect([...view.parts.keys()]).toEqual(MOUNTED_FIGURE.figure.nodes.map(node=>node.id));}
  finally{view.dispose();for(const dispose of cleanup)dispose();}
});
