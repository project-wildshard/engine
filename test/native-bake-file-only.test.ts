import {expect,test,vi} from 'vitest';
import {createNativeBakeReader,nativeBakeGround} from '@wildshard/engine/game/population/nativeBake';

const options={label:'Binary native',resolution:2,size:4,parked:false,rig:'segments',provenance:'piece',shapes:[1,2,6,9]};
const ground={rows:1,cols:1,heights:{file:'data/floor.bin'},scale:{x:4,y:1,z:4},at:{x:0,y:0,z:0},friction:.9,groups:1};
const floor={file:ground.heights.file,bytes:new Uint8Array(16)};
const input={version:1,ground,solids:[],actors:[],herds:[]};
const solid={shape:6,body:null,at:[0,0,0],rot:[0,0,0,1],friction:1,groups:1};

test.each(['AAAAAAAAAAAAAAAAAAAAAA==','not-base64!',''])('inline native floors refuse before any decode (%s)',heights=>{
  const decode=vi.spyOn(globalThis,'atob').mockImplementation(()=>{throw new Error('Unexpected inline decoder');});
  try{
    const row={...ground,heights};
    expect(()=>nativeBakeGround(row,2,4,'Binary native',floor)).toThrow('Native floor requires a named binary file');
    expect(()=>createNativeBakeReader({...input,ground:row},options,floor).read()).toThrow('Native floor requires a named binary file');
    expect(decode).not.toHaveBeenCalled();
  }finally{decode.mockRestore();}
});

test.each(['AAAAAAAAAAAAAAAA','not-base64!',''])('inline native collider channels refuse before any decode (%s)',inline=>{
  const decode=vi.spyOn(globalThis,'atob').mockImplementation(()=>{throw new Error('Unexpected inline decoder');});
  try{
    for(const channel of ['vertices','indices']){
      const row={...solid,vertices:{file:'data/hull.bin',byteOffset:0,byteLength:12},indices:{file:'data/hull.bin',byteOffset:12,byteLength:12},[channel]:inline};
      const reader=createNativeBakeReader(input,options,floor,[{file:'data/hull.bin',bytes:new Uint8Array(24)}]);
      expect(()=>reader.solid(row)).toThrow('Native collider requires a named binary file');
      expect(()=>createNativeBakeReader({...input,solids:[row]},options,floor,[{file:'data/hull.bin',bytes:new Uint8Array(24)}]).read()).toThrow('Native collider requires a named binary file');
    }
    expect(decode).not.toHaveBeenCalled();
  }finally{decode.mockRestore();}
});
