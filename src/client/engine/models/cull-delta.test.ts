import {expect,test} from 'vitest';
import * as THREE from 'three';
import {InstancedCull,type InstancedSink} from './cull';

function fixture(n=3): {cull:InstancedCull;sink:InstancedSink;matrices:Float32Array;colors:Float32Array;camera:THREE.PerspectiveCamera;pick:()=>void} {
  const matrices=new Float32Array(n*16),colors=new Float32Array(n*3),bounds=new Float32Array(n*4);
  for(let i=0;i<n;i++){
    new THREE.Matrix4().makeTranslation(i,0,-10).toArray(matrices,i*16);
    colors.set([i/4,.5,1],i*3);bounds.set([i,0,-10,.1],i*4);
  }
  const matrix=new THREE.InstancedBufferAttribute(new Float32Array(n*16),16),color=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);
  const mesh=new THREE.InstancedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial(),n);
  mesh.instanceMatrix=matrix;mesh.instanceColor=color;
  const sink:InstancedSink={matrix,color,meshes:[mesh]},camera=new THREE.PerspectiveCamera(60,1,.1,100);
  const cull=new InstancedCull([[sink]],1,new Uint16Array(n),matrices,colors,bounds,[0],{view:{onViewChange:()=>undefined}});
  const pick=():void=>{camera.updateMatrixWorld();cull.updateWith(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),camera.position);};
  return{cull,sink,matrices,colors,camera,pick};
}

test('unchanged packing uploads nothing; changed matrix and colour spans stay independent',()=>{
 const f=fixture();f.pick();f.sink.matrix.clearUpdateRanges();f.sink.color?.clearUpdateRanges();
 const matrixVersion=f.sink.matrix.version,colorVersion=f.sink.color?.version;
 f.camera.rotation.y=.01;f.pick();
 expect(f.sink.matrix.version).toBe(matrixVersion);expect(f.sink.color?.version).toBe(colorVersion);
 f.matrices[28]=3;f.colors[8]=.25;f.pick();
 expect(f.sink.matrix.updateRanges).toEqual([{start:28,count:1}]);
 expect(f.sink.color?.updateRanges).toEqual([{start:8,count:1}]);
 expect(Array.from(f.sink.matrix.array).slice(0,48)).toEqual(Array.from(f.matrices));
 expect(Array.from(f.sink.color?.array??[])).toEqual(Array.from(f.colors));
});

test('several choices before rendering retain the union of every pending change',()=>{
 const f=fixture();f.pick();f.sink.matrix.clearUpdateRanges();
 f.matrices[12]=2;f.pick();f.matrices[44]=4;f.pick();
 expect(f.sink.matrix.updateRanges).toEqual([{start:12,count:33}]);
 f.sink.matrix.clearUpdateRanges();f.matrices[28]=7;f.pick();
 expect(f.sink.matrix.updateRanges).toEqual([{start:28,count:1}]);
});

test('a held padded view keeps objects crossing the true edge until a turn or travel threshold',()=>{
 const n=1,matrices=new Float32Array(16),bounds=new Float32Array([6.5,0,-10,.1]);
 new THREE.Matrix4().makeTranslation(6.5,0,-10).toArray(matrices);
 const matrix=new THREE.InstancedBufferAttribute(new Float32Array(16),16),mesh=new THREE.InstancedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial(),1);
 const cull=new InstancedCull([[{matrix,color:null,meshes:[mesh]}]],1,new Uint16Array(n),matrices,null,bounds,[0],{});
 const camera=new THREE.PerspectiveCamera(60,1,.1,100);
 cull.update(camera);expect(mesh.count).toBe(1);matrix.clearUpdateRanges();const version=matrix.version;
 camera.rotation.y=-THREE.MathUtils.degToRad(3);cull.update(camera);
 expect(mesh.count).toBe(1);expect(matrix.version).toBe(version);
 // LOD/range choices also wait for actual >1m travel, but the sphere padding covers the retained view's edge.
 camera.position.x=.9;cull.update(camera);expect(matrix.version).toBe(version);
 camera.position.x=1.1;cull.update(camera);expect(mesh.count).toBe(1);
 camera.rotation.y=THREE.MathUtils.degToRad(50);cull.update(camera);expect(mesh.count).toBe(0);
});
