import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {fixedDraws,coldFixedDraws,folderFixedDraws} from '../src/client/game/models/fixedDraws';
import {createOwnedGeometry} from '../src/client/engine/models/ownedGeometry';

const baked={attrs:[['position','f32',3,false]],count:3,index:null,indexCount:0,box:true,expand:false};
const named={slot:'named',file:'models/named.bin',channels:[],baked};
const inline={slot:'inline',inline:'eJxjYGBwAGIoaLBHsFH5jFAMADHKAcE=',channels:[],baked};

test.each([{rows:[inline]},{rows:[named,inline]}])('fixed libraries refuse all inline rows before template allocation or reads',({rows})=>{
  const file=vi.fn(()=>Promise.resolve(new Uint8Array(36))),intake=vi.fn(createOwnedGeometry),lane=vi.fn(()=>Promise.resolve(new Uint8Array(36)));
  expect(()=>fixedDraws({slug:'files',file},rows,intake,lane)).toThrow('Fixed draws require binary sources');
  expect(file).not.toHaveBeenCalled();expect(lane).not.toHaveBeenCalled();expect(intake).not.toHaveBeenCalled();
});

test('product metadata and cold cards reject inline rows before readers or templates, including unselected rows',async()=>{
  const file=vi.fn(()=>Promise.resolve(new Uint8Array(36))),intake=vi.fn(createOwnedGeometry),scope=new Scope('file-only.card');
  try{
    const book={slug:'files',file,json:()=>Promise.resolve([named,inline])};
    await expect(folderFixedDraws(book,'models/book.json')).rejects.toThrow('Fixed draws require binary sources');
    await expect(coldFixedDraws(book,[named,inline],scope,['named'],intake)).rejects.toThrow('Fixed draws require binary sources');
    expect(file).not.toHaveBeenCalled();expect(intake).not.toHaveBeenCalled();
  }finally{scope.dispose();}
});
