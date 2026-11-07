import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the report's identity with the actual material source.
import {createHash} from 'node:crypto';
import {ToonLook} from '../src/client/engine/render/families/toon';
import {emitClassicGraph} from '../src/client/engine/render/graph/glslProgram';
import {compileClassicGraph} from '../src/client/engine/render/graph/glslMaterial';
import {graphFragmentIdentity} from './fixtures/graph-fragment-identity';

const hash=(source:string):string=>createHash('sha256').update(source).digest('hex');
const look=new ToonLook({});
const fogGraph={version:1,kind:'fog',params:{density:{type:'float',value:0.5}},nodes:{f:{op:'fogInput'},d:{op:'param',param:'density'},e:{op:'engineFogged'},o:{op:'mix',in:['f','e','d']}},stages:{fog:{colour:'o'}}};
const surface={version:1,kind:'material',model:'unlit',effectState:{fog:'haze'},nodes:{},stages:{surface:{colour:[1,1,1]}}};

test('material identity includes the real selected fog and agrees with the ordinary compile',()=>{
 const fog=compileClassicGraph(fogGraph);
 if(fog.fog===null)throw new Error('The admitted fog has no lowering');
 const selected=fog.fog;
 const outlined={...surface,stages:{...surface.stages,outline:{offset:[0,0,0],colour:[0,0,0]}}};
 const material=compileClassicGraph(outlined,{toon:look,fog:()=>selected});
 try{
  const identity=graphFragmentIdentity(material.glsl,look,selected.glsl);
  expect(identity.main).toBe(hash(material.material.fragmentShader));
  if(material.outline===null)throw new Error('The admitted outline has no material');
  expect(identity.outline).toBe(hash(material.outline.fragmentShader));
  const changed=emitClassicGraph({...fogGraph,stages:{fog:{colour:[0,0,0]}}});
  expect(graphFragmentIdentity(material.glsl,look,changed).main).not.toBe(identity.main);
  fog.setParam('density',0.25);
  expect(graphFragmentIdentity(material.glsl,look,selected.glsl)).toEqual(identity);
 }finally{material.material.dispose();material.outline?.dispose();fog.material.dispose();}
});

test('a missing or wrong fog refuses while fog-only rows have no draw identity',()=>{
 const material=emitClassicGraph(surface),fog=emitClassicGraph(fogGraph);
 expect(()=>graphFragmentIdentity(material,look)).toThrow('admitted fog');
 expect(()=>graphFragmentIdentity(material,look,material)).toThrow('not a fog');
 expect(graphFragmentIdentity(fog,look)).toEqual({main:null,outline:null});
 expect(graphFragmentIdentity(material,look,fog).outline).toBeNull();
});
