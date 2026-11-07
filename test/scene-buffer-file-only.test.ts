// @vitest-environment happy-dom
import {expect,test,vi} from 'vitest';
import {type BufferGeometry,MeshBasicMaterial} from 'three';
import {Scope} from '../src/shared/engine/app/scope';
import {AssetService} from '../src/client/engine/app/assets';
import {admitSceneBuffers,createSceneBuffers} from '../src/client/game/shardfile/sceneBuffers';

const file='test/positions.bin',files=new Map([[file,new Uint8Array(12)]]);
const row=()=>({version:1,buffers:[{id:'position',storage:'f32',file,byteLength:12}],
  attributes:[{id:'position',buffer:'position',size:3}],geometries:[{id:'g',attributes:{position:'position'}}],
  draws:[{id:'d',draw:{kind:'points',geometry:'g'}}]});

test('whole scene admission refuses a later inline buffer before any named reads',()=>{
  const source=row(),get=vi.spyOn(files,'get');
  try{
    const input={...source,buffers:[...source.buffers,{id:'unused',storage:'u8',bytes:'AA=='}]};
    expect(()=>admitSceneBuffers(input,files)).toThrow('Scene buffers require named binary files');
    expect(get).not.toHaveBeenCalled();
  }finally{get.mockRestore();}
});

test('cached scene construction refuses inline storage before resource acquisition or child allocation',()=>{
  const assets=new AssetService<BufferGeometry>(),reuse={content:'/fixture/scene.json',assets};
  const first=new Scope('scene.first'),second=new Scope('scene.second'),material=new MeshBasicMaterial();
  try{
    createSceneBuffers(row(),material,first,undefined,reuse,files);first.dispose();
    const source=row(),input={...source,buffers:[{id:'position',storage:'f32',bytes:'AAAAAAAAAAAAAAAA'}]};
    const acquire=vi.spyOn(assets,'acquireResource'),register=vi.spyOn(assets,'register'),child=vi.spyOn(second,'child');
    expect(()=>createSceneBuffers(input,material,second,undefined,reuse,files)).toThrow('Scene buffers require named binary files');
    expect(acquire).not.toHaveBeenCalled();expect(register).not.toHaveBeenCalled();expect(child).not.toHaveBeenCalled();
  }finally{
    first.dispose();second.dispose();for(const retained of assets.retained())assets.evictCached(retained.key);material.dispose();
  }
});

test('empty buffer markers retain zero-length effects without phantom file reads',()=>{
  const empty={version:1,buffers:[{id:'empty',storage:'f32',bytes:''}],attributes:[],geometries:[],draws:[]};
  const get=vi.spyOn(files,'get'),scope=new Scope('scene.empty'),material=new MeshBasicMaterial();
  try{
    expect(admitSceneBuffers(empty,files).buffers[0]?.bytes).toBe('');
    expect(createSceneBuffers(empty,material,scope,undefined,undefined,files).children).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  }finally{get.mockRestore();scope.dispose();material.dispose();}
});
