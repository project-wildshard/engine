// @vitest-environment happy-dom
import {expect,test} from 'vitest';
import {Box3,BoxGeometry,InstancedMesh,MeshStandardMaterial,Vector3} from 'three';
import {defineModel,modelContext,paramsOf} from './model';
import {place} from './place';
import {listModel} from './live';
import {WorldRegistry} from '../world/registry';

for(const listed of [false,true])test(`${listed?'listed':'placed'} render choices preserve default specimens and public variant buttons`,()=>{
  const registry=new WorldRegistry(),material=new MeshStandardMaterial(),shapes=[new BoxGeometry(1,1,1),new BoxGeometry(4,1,1),new BoxGeometry(2,1,1)];
  const model=defineModel({id:`test/hidden-${String(listed)}`,name:'Palette test',category:'people',pipeline:'code',file:'src/client/engine/models/hidden-variant.test.ts',
    defaults:{pick:0},variants:[{id:'public',label:'Original',params:{pick:2}},{id:'internal',label:'Table',hidden:true,params:{pick:1}}],
    build:(_ctx,params)=>{const geometry=shapes[params.pick];if(geometry===undefined)throw new Error('Missing test shape');return[{geometry,material}];}});
  try{
    expect(paramsOf(model,'internal',undefined)).toEqual({pick:1});
    if(listed)listModel(model,{ctx:modelContext(null),registry});
    else{
      const placed=place(model,[{x:0,y:0,z:0,variant:'internal'},{x:8,y:0,z:0,variant:'internal'}],{ctx:modelContext(null),registry,draw:'instanced',piece:{id:'hidden-place'}});
      expect(placed.object).toBeInstanceOf(InstancedMesh);
      expect(placed.copyBox(0,new Box3()).getSize(new Vector3()).x).toBe(4);
    }
    const card=registry.get(listed?`model:${model.id}`:'hidden-place')?.model;if(card===undefined)throw new Error('Missing actual catalogue entry');
    expect(card.variants).toEqual([{id:'public',label:'Original'}]);
    expect(new Box3().setFromObject(card.object()).getSize(new Vector3()).x).toBe(1);
    card.rebuild?.('public');expect(new Box3().setFromObject(card.object()).getSize(new Vector3()).x).toBe(2);
  }finally{registry.retire();for(const shape of shapes)shape.dispose();material.dispose();}
});
