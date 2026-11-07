import {expect,test} from 'vitest';
import {ShaderMaterial} from 'three';
import {worldPixelDifference} from '../scripts/perf/world-pixel-difference.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- The browser loan checks the identical complete source digest.
import {createHash} from 'node:crypto';
import {loanMaterialPrograms,trackMaterialProgramDraws,type ProgramSource,type MaterialProgramLoan,type ProgramDrawRenderer} from '../scripts/perf/material-program-loan.mjs';

function source(body:string):ProgramSource{
 const vertex='attribute vec3 aSeed; uniform float phase; void main(){gl_Position=vec4(aSeed,1.0);}';
 const fragment=`uniform float phase; void main(){gl_FragColor=${body};}`;
 const hash=(text:string):string=>createHash('sha256').update(text).digest('hex');
 return {vertex,fragment,vertexHash:hash(vertex),fragmentHash:hash(fragment)};
}
function fixture():{material:ShaderMaterial;program:MaterialProgramLoan}{
 const before=source('vec4(phase)'),after=source('vec4(phase*1.0)');
 const material=new ShaderMaterial({vertexShader:before.vertex,fragmentShader:before.fragment,uniforms:{phase:{value:7}}});material.name='owned';
 return {material,program:{aliases:['owned'],before,after,uniforms:['phase']}};
}

test('loans only source and restores native material policy and uniforms by identity',async()=>{
 const {material,program}=fixture(),uniforms=material.uniforms,defines=material.defines;
 const onBeforeCompile:unknown=Reflect.get(material,'onBeforeCompile');
 try{
  const loan=await loanMaterialPrograms([material],[program]);
  expect(material.fragmentShader).toBe(program.after.fragment);
  expect(loan.receipts[0]).toMatchObject({materials:1,before:{fragmentHash:program.before.fragmentHash},after:{fragmentHash:program.after.fragmentHash}});
  expect(material.uniforms).toBe(uniforms);expect(uniforms['phase']?.value).toBe(7);
  expect(Reflect.get(material,'onBeforeCompile')).toBe(onBeforeCompile);expect(material.defines).toBe(defines);
  loan.restore();loan.restore();
  expect(material.fragmentShader).toBe(program.before.fragment);expect(material.vertexShader).toBe(program.before.vertex);
  expect(material.uniforms).toBe(uniforms);
 }finally{material.dispose();}
});

test('draw evidence counts only native target identities and restores the submission owner',async()=>{
 const {material,program}=fixture();
 const loan=await loanMaterialPrograms([material],[program]);
 const calls:unknown[][]=[];
 const renderer:ProgramDrawRenderer={renderBufferDirect(...args){expect(this).toBe(renderer);calls.push(args);return 17;}};
 const original=renderer.renderBufferDirect,track=trackMaterialProgramDraws(renderer,loan.receipts);
 try{
  expect(renderer.renderBufferDirect(null,null,null,material)).toBe(17);
  renderer.renderBufferDirect(null,null,null,{uuid:'unrelated'});
  expect(track.read()).toEqual({owned:1});expect(calls).toHaveLength(2);
  track.restore();track.restore();expect(renderer.renderBufferDirect).toBe(original);
 }finally{track.restore();loan.restore();material.dispose();}
});

test('wrong source, missing uniforms and attribute/uniform changes refuse before any mutation',async()=>{
 for(const kind of ['hash','actual','uniform-value','attribute','uniform-declaration','missing','overlap','unchanged']){
  const {material,program}=fixture(),before=material.fragmentShader;
  let proposed=program;
  if(kind==='hash')proposed={...program,after:{...program.after,fragmentHash:'f'.repeat(64)}};
  if(kind==='actual')material.vertexShader+='\n';
  if(kind==='uniform-value')proposed={...program,uniforms:['other']};
  if(kind==='attribute'){
   const vertex=program.after.vertex.replace('vec3 aSeed','vec2 aSeed');
   proposed={...program,after:{...program.after,vertex,vertexHash:createHash('sha256').update(vertex).digest('hex')}};
  }
  if(kind==='uniform-declaration'){
   const fragment=program.after.fragment.replace('uniform float phase','uniform vec2 phase');
   proposed={...program,after:{...program.after,fragment,fragmentHash:createHash('sha256').update(fragment).digest('hex')}};
  }
  if(kind==='missing')proposed={...program,aliases:['absent']};
  if(kind==='unchanged')proposed={...program,after:program.before};
  try{
   await expect(loanMaterialPrograms([material],kind==='overlap'?[program,program]:[proposed]),kind).rejects.toThrow();
   expect(material.fragmentShader,kind).toBe(before);
  }finally{material.dispose();}
 }
});


test('G941 retains raw differences and permits only its exact pose, coordinate and RGBA pairs',()=>{
 const width=804,height=1748,a=new Uint8Array(width*height*4),b=a.slice(),at=(1139*width+569)*4;
 a.set([14,15,15,1],at);b.set([15,16,15,1],at);
 expect(worldPixelDifference(a,b,width,height,'P1')).toMatchObject({pixels:1,approvedPixels:0,unapprovedPixels:1});
 expect(worldPixelDifference(a,b,width,height,'P1',true)).toMatchObject({pixels:1,approvedPixels:1,unapprovedPixels:0});
 expect(worldPixelDifference(b,a,width,height,'P1',true).approvedPixels).toBe(1);
 expect(worldPixelDifference(a,b,width,height,'P2',true).unapprovedPixels).toBe(1);
 b[0]=1;expect(worldPixelDifference(a,b,width,height,'P1',true).unapprovedPixels).toBe(1);b[0]=0;
 b[at+3]=2;expect(worldPixelDifference(a,b,width,height,'P1',true).unapprovedPixels).toBe(1);
 a.fill(0);b.fill(0);const canopy=(715*width+591)*4;
 a.set([26,30,22,1],canopy);b.set([25,30,22,1],canopy);
 expect(worldPixelDifference(a,b,width,height,'P2',true)).toMatchObject({pixels:1,approvedPixels:1,unapprovedPixels:0});
 b[canopy]=24;expect(worldPixelDifference(a,b,width,height,'P2',true).unapprovedPixels).toBe(1);
 expect(()=>worldPixelDifference(a,b,width,height-1,'P2',true)).toThrow('dimensions');
});
