import { nalatiSpecimens } from './fixtures/nalati-specimens';
import { nalatiBalbal } from './fixtures/nalati-balbal';
import { nalatiRuntime } from './fixtures/nalati-runtime';
import { nalatiDecorative } from './fixtures/nalati-decorative';
import { expect,test } from 'vitest';
import * as v from 'valibot';
import { BoxGeometry,BufferAttribute,Group,InstancedMesh,Matrix4,MeshBasicMaterial,Vector3 } from 'three';
import { SceneInstancesSchema } from '@wildshard/format/sceneInstances';
import { SceneInstanceFields } from '../src/client/game/shardfile/sceneInstances';
import { setTerrainHeight } from '../src/shared/engine/world/terrainHeight';
import { dressingScene } from './fixtures/nalati-dressing-scene';
import { kokparOval } from './fixtures/nalati-kokpar-oracle';

function instanced(value:unknown):value is InstancedMesh{return value instanceof InstancedMesh;}
test('an orchard fixture projects copied numeric rows on the declared cadence and retires its buffers',()=>{
  setTerrainHeight(()=>4);
  const input=[{id:'orchard-leaves',name:'petals',group:'orchard',geometry:'leaf',material:'paint',step:.25,initialCredit:0,clock:'elapsed',states:[[2,3],[4,5]],pose:{x:0,z:1},blocked:[],palette:[],ground:.1,near:0,far:10,bounds:[0,0,0,10],groundBounds:true,castShadow:false,receiveShadow:true,attributes:[{name:'phase',width:1,values:[0,1]}],
    programs:[{row:{id:'orchard.drift',reads:['x'],nodes:[{op:'read',index:0},{op:'clock',value:'delta'},{op:'add',a:0,b:1},{op:'constant',value:7}],channels:[{property:'x',value:2},{property:'z',value:3}]},inputs:[{kind:'state',slot:0}],outputs:[{property:'x',slot:0},{property:'z',slot:1}]}]}];
  const rows=v.parse(SceneInstancesSchema,input),root=new Group(),shape=new BoxGeometry(),paint=new MeshBasicMaterial(),before=structuredClone(input);
  const host=new SceneInstanceFields(rows,new Map([['leaf',shape]]),new Map([['paint',paint]]),new Map([['orchard',root]]));
  const mesh=root.children[0];if(!instanced(mesh))throw new Error('Missing fixture instances');
  expect(mesh.name).toBe('petals');host.update(.1,new Vector3(),0);expect(mesh.count).toBe(0);
  host.update(.15,new Vector3(),0);expect(mesh.count).toBe(2);
  const matrix=new Matrix4(),position=new Vector3();mesh.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);
  expect(position.x).toBeCloseTo(2.25);expect(position.z).toBeCloseTo(7);expect(position.y).toBeCloseTo(4.1);
  expect(mesh.geometry.getAttribute('phase').count).toBe(2);expect(input).toEqual(before);
  const normal=mesh.geometry.getAttribute('normal'),vertices=mesh.geometry.getAttribute('position');
  if(!(normal instanceof BufferAttribute))throw new Error('Missing static normals');
  const count=normal.count;normal.onUploadCallback();
  expect(normal.array.byteLength).toBe(0);expect(normal.count).toBe(count);
  expect(shape.getAttribute('normal').array.byteLength).toBeGreaterThan(0);
  expect(vertices.array.byteLength).toBeGreaterThan(0);expect(mesh.geometry.index?.array.byteLength).toBeGreaterThan(0);
  host.update(.25,new Vector3(),0);mesh.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);
  expect(position.x).toBeCloseTo(2.5);expect(mesh.count).toBe(2);
  host.update(.25,new Vector3(100,0,100),0);expect(mesh.visible).toBe(false);
  host.dispose();expect(root.children).toHaveLength(0);shape.dispose();paint.dispose();
});

test('declared Kokpar poses keep the original oval and gallop height',()=>{
  setTerrainHeight(()=>10);
  const row=dressingScene('phone',nalatiDecorative,nalatiRuntime,nalatiBalbal,nalatiSpecimens).instances.find(candidate=>candidate.id==='nalati-kokpar-riders');if(row===undefined)throw new Error('Missing declared riders');
  const rows=structuredClone([row]);delete rows[0]?.uniform;
  const root=new Group(),shape=new BoxGeometry(),paint=new MeshBasicMaterial();
  const host=new SceneInstanceFields(rows,new Map([[row.geometry,shape]]),new Map([[row.material,paint]]),new Map([[row.group,root]]));
  host.update(.1,new Vector3(),1.2);const mesh=root.children[0];if(!instanced(mesh))throw new Error('Missing rider instances');
  const state=row.states[0];if(state===undefined)throw new Error('Missing rider state');const t=state[0],k=state[1],speed=state[2];if(t===undefined||k===undefined||speed===undefined)throw new Error('Incomplete rider state');
  const expected=kokparOval(t+speed*.1,k),phase=1.2*2.2*Math.PI*2,position=new Vector3(),matrix=new Matrix4();mesh.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);
  expect(position.x).toBeCloseTo(expected.x,4);expect(position.z).toBeCloseTo(expected.z,4);
  expect(position.y).toBeCloseTo(10+(.5+.5*Math.sin(phase*2-.4))*.16-.06,5);expect(mesh.count).toBe(6);
  host.dispose();shape.dispose();paint.dispose();
});
