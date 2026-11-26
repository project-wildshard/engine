/** Diagnostic depth-passing sample census. Keeps original draw order, depth,
 * vertex programs and fragment discards. Replaces only final output/blending.
 * This counts samples reaching colour, NOT early-Z rejected shader invocations.
 * @param {readonly string[]} [extraAliases] */
export function graphCoverage(extraAliases=[]){
 const w=window.__wildshard.requireWorld(),g=w.game,r=g.renderer,gl=r.getContext(),scene=g.rootScene,P=window.__gpuCensus;
 if(!w.hud.entered||w.hud.paused||g.frameGate())throw new Error('Coverage requires a frozen entered frame');
 const materials=new Map();for(const o of P.meshes())for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isNodeMaterial===true)throw new Error('Coverage requires classic materials');else if(m&&!materials.has(m))materials.set(m,{onBeforeCompile:m.onBeforeCompile,customProgramCacheKey:m.customProgramCacheKey,blending:m.blending,blendSrc:m.blendSrc,blendDst:m.blendDst,blendEquation:m.blendEquation,blendSrcAlpha:m.blendSrcAlpha,blendDstAlpha:m.blendDstAlpha,blendEquationAlpha:m.blendEquationAlpha,premultipliedAlpha:m.premultipliedAlpha,colorWrite:m.colorWrite});
 const aliases=[...new Set([...materials.keys()].map(m=>m.name).filter(n=>n.startsWith('graph:material:')===true||extraAliases.includes(n)))];
 if(aliases.length===0)throw new Error('No named graph coverage owners');
 const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,RT=g.composer.inputBuffer.constructor,rt=new RT(W,H,{depthBuffer:true});rt.texture.colorSpace='';
 const previous={target:r.getRenderTarget(),background:scene.background,shadow:r.shadowMap.autoUpdate,shadowNeeds:r.shadowMap.needsUpdate,clearAlpha:r.getClearAlpha(),dither:gl.isEnabled(gl.DITHER)};
 const color=[...materials.keys()].find(m=>m.color)?.color;if(!color)throw new Error('Missing native clear-colour loan');previous.clear=r.getClearColor(color.clone());
 const rows=[];
 try{
 scene.background=null;r.shadowMap.autoUpdate=false;gl.disable(gl.DITHER);
 for(let start=0;start<aliases.length;start+=3){const batch=aliases.slice(start,start+3);
  for(const [m,saved]of materials){const channel=batch.indexOf(m.name),v=[0,0,0];if(channel!==-1)v[channel]=1;
   m.onBeforeCompile=function onBeforeCompile(shader,renderer){saved.onBeforeCompile.call(this,shader,renderer);const fs=shader.fragmentShader,end=fs.lastIndexOf('}'),named=fs.match(/out\s+(?:highp\s+|mediump\s+)?vec4\s+(\w+)/);if(end===-1)throw new Error('Missing fragment main');const output=fs.includes('gl_FragColor')||named===null?'gl_FragColor':named[1];shader.fragmentShader=`${fs.slice(0,end)}\n${output}=vec4(${v.map(x=>`${x}.0`).join(',')},0.0)/255.0;\n}\n`;};
   m.customProgramCacheKey=function customProgramCacheKey(){return `${saved.customProgramCacheKey.call(this)}|g1coverage:${channel}`;};
   m.blending=5;m.blendEquation=100;m.blendSrc=201;m.blendDst=201;m.blendEquationAlpha=100;m.blendSrcAlpha=201;m.blendDstAlpha=201;m.premultipliedAlpha=false;m.colorWrite=true;m.needsUpdate=true;
  }
  r.setRenderTarget(rt);r.setClearColor(0,0);r.clear(true,true,true);r.render(scene,g.camera);
  const bytes=new Uint8Array(W*H*4);r.readRenderTargetPixels(rt,0,0,W,H,bytes);
  if(gl.getError()!==gl.NO_ERROR||gl.isContextLost())throw new Error('Coverage readback refused');
  for(let channel=0;channel<batch.length;channel++){let samples=0,coveredPixels=0,saturatedPixels=0;for(let i=channel;i<bytes.length;i+=4){const n=bytes[i];samples+=n;if(n>0)coveredPixels++;if(n===255)saturatedPixels++;}rows.push({alias:batch[channel],samples,coveredPixels,saturatedPixels});}
 }
 return {width:W,height:H,method:'native-order depth-passing additive RGBA8; original vertex/discards/depth; NOT shader-invocation count',rows};
 }finally{for(const[m,saved]of materials){Object.assign(m,saved);m.needsUpdate=true;}scene.background=previous.background;r.shadowMap.autoUpdate=previous.shadow;r.shadowMap.needsUpdate=previous.shadowNeeds;r.setRenderTarget(previous.target);r.setClearColor(previous.clear,previous.clearAlpha);if(previous.dither)gl.enable(gl.DITHER);else gl.disable(gl.DITHER);rt.dispose();}
}

/** Extend the default names only from actual compiled-source matches.
 * A shared name must never apportion samples across unknown shader sources.
 * @param {readonly {name:string,fragmentShaderHash?:string}[]} materials
 * @param {readonly string[]} hashes */
export function sourceMatchedCoverageAliases(materials,hashes){
 if(!Array.isArray(hashes)||hashes.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/u.test(hash)))throw new Error('Invalid coverage shader source hashes');
 const known=new Set(hashes),extra=new Set();
 for(const material of materials){
  if(material.fragmentShaderHash===undefined||!known.has(material.fragmentShaderHash)||material.name.startsWith('graph:material:'))continue;
  if(material.name.length===0)throw new Error('Matched coverage source has no unique material alias');
  const named=materials.filter(row=>row.name===material.name);
  if(named.some(row=>row.fragmentShaderHash!==material.fragmentShaderHash))throw new Error('Coverage alias names several shader sources');
  extra.add(material.name);
 }
 return [...extra];
}
