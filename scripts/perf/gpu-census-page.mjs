/** Browser-serialized frozen-frame throughput. Tile-based GPU queries are deliberately
 * not split by draw: those boundaries force flushes and invalidate attribution. */
export function installGpuProbe(){
 const w=window.__wildshard.requireWorld(),g=w.game,r=g.renderer,gl=r.getContext(),composer=g.composer,root=g.rootScene??g.scene;
 // oxlint-disable-next-line typescript/unbound-method -- Preserve exact identities for restoration; calls use their native receiver.
 const rawDraw=r.renderBufferDirect,rawBlit=gl.blitFramebuffer,passes=composer.passes.map((pass,index)=>({pass,index,name:pass.name === '' ? pass.constructor.name : pass.name,render:pass.render}));
 const materials=new Map();let mode='off',passName='outside',skip=null,skipDepth=false;
 const names=['rain-streaks','canopy-cards','crowd-umbrellas','facades-slabs','neon-signs-glyphs','lanterns','wet-reflection','movers','viewmodel','terrain','sky','other'];
 function group(object,material){
  let at=object,path='';while(at){if(at===g.camera)return 'viewmodel';path+=` ${at.name ?? ''}`;at=at.parent;}
  const s=(`${path} ${material.name ?? ''}`).toLowerCase();
  if(material.name==='BackgroundCubeMaterial')return 'sky';if(/rain|streak|splash/.test(s))return 'rain-streaks';if(/crowd|umbrella|pedestrian/.test(s))return 'crowd-umbrellas';
  if(/canopy|awning|needle|foliage|leaf-card/.test(s))return 'canopy-cards';if(/train|gondola|drone|mover/.test(s))return 'movers';
  if(/lantern|lamp|cage/.test(s))return 'lanterns';if(/wet|reflection|water|pool/.test(s))return 'wet-reflection';
  if(/neon|sign|glyph|screen/.test(s))return 'neon-signs-glyphs';if(/architecture|facade|slab|whole|building/.test(s))return 'facades-slabs';
  if(s.includes('kit:'))return 'facades-slabs';if(/terrain|ground|floor/.test(s))return 'terrain';if(/sky|cloud|horizon/.test(s))return 'sky';return 'other';
 }
 r.renderBufferDirect=function renderBufferDirect(camera,scene,geometry,material,object,range){
  const key=material.name.includes('NdJiehuaGraph.')?`post:${material.name}`:`group:${group(object,material)}`;
  if(skip&&skip({key,object,material,pass:passName}))return;
  if(mode==='inventory'){
   let row=materials.get(material);if(!row){row={name:material.name,type:material.type,uuid:material.uuid,alphaTest:material.alphaTest,transparent:material.transparent,depthTest:material.depthTest,depthWrite:material.depthWrite,passes:[],groups:[],objects:[],draws:0,viewportPixelUpperBound:0,fullscreenPixels:0,fragmentShader:typeof material.fragmentShader==='string'?material.fragmentShader:null};materials.set(material,row);}
   row.draws++;const vp=gl.getParameter(gl.VIEWPORT);row.viewportPixelUpperBound+=vp[2]*vp[3];
   if(material.name.includes('NdJiehuaGraph.'))row.fullscreenPixels+=vp[2]*vp[3];
   if(!row.passes.includes(passName))row.passes.push(passName);if(!row.groups.includes(key))row.groups.push(key);if(row.objects.length<8&&!row.objects.includes(object.name))row.objects.push(object.name);
  }
  rawDraw.call(this,camera,scene,geometry,material,object,range);
 };
 gl.blitFramebuffer=function blitFramebuffer(...args){if(skipDepth&&(args[8]&gl.DEPTH_BUFFER_BIT)&&!(args[8]&gl.COLOR_BUFFER_BIT))return;rawBlit.apply(this,args);};
 for(const row of passes)row.pass.render=function render(...args){const before=passName;passName=`${row.index}:${row.name}`;try{row.render.apply(this,args);}finally{passName=before;}};
 const sync=()=>{const target=r.getRenderTarget(),scissor=r.getScissorTest(),rect={x:0,y:0,z:0,w:0,copy(v){this.x=v.x;this.y=v.y;this.z=v.z;this.w=v.w;return this;}};r.getScissor(rect);r.setRenderTarget(null);r.setScissor(0,0,1,1);r.setScissorTest(true);r.clear(true,false,false);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));r.setRenderTarget(target);r.setScissor(rect.x,rect.y,rect.z,rect.w);r.setScissorTest(scissor);if(gl.getError()!==gl.NO_ERROR||gl.isContextLost())throw new Error('Invalid GPU readback');};
 const P={names,groupOf:object=>group(object,Array.isArray(object.material)?object.material[0]:object.material),meshes:()=>{const rows=[];root.traverseVisible(o=>{if(o.isMesh||o.isPoints||o.isLine)rows.push(o);});return rows;},passes:passes.map(x=>({index:x.index,name:x.name,effects:(x.pass.effects??[]).map(e=>e.name === '' ? e.constructor.name : e.name)})),
  batch(want,k=16,variant='none'){
   if(!['inventory','throughput'].includes(want)||!Number.isSafeInteger(k)||k<1||k>64)throw new Error('Invalid GPU census batch');
   const variants=new Set(variant.split('|')), groups=new Set([...variants].filter(v=>v.startsWith('group:')));
   for(const v of variants)if(v.startsWith('pass:')&&!passes[Number(v.slice(5))])throw new Error('Unknown pass');
   for(const v of variants)if(v.startsWith('effect:')){const[,passIndex,effectIndex]=v.split(':');if(!passes[Number(passIndex)]?.pass.effects?.[Number(effectIndex)]?.blendMode)throw new Error('Unknown effect');}
   const shadow={auto:r.shadowMap.autoUpdate,needs:r.shadowMap.needsUpdate},disabled=[],disabledEffects=[];skip=null;skipDepth=variants.has('depthcopy');
   try{
   if(variants.has('shadow')){r.shadowMap.autoUpdate=false;r.shadowMap.needsUpdate=false;}
   for(const v of variants)if(v.startsWith('pass:')){const index=Number(v.slice(5)),row=passes[index];if(!row)throw new Error('Unknown pass');disabled.push([row.pass,row.pass.enabled]);row.pass.enabled=false;}
   for(const v of variants)if(v.startsWith('effect:')){const[,passIndex,effectIndex]=v.split(':'),effect=passes[Number(passIndex)].pass.effects[Number(effectIndex)];disabledEffects.push([effect,effect.blendMode.blendFunction,Object.getOwnPropertyDescriptor(effect,'update')]);effect.update=()=>{ /* DST omits this effect; its inputs need no update. */ };effect.blendMode.blendFunction=1;}
   skip=x=>groups.has(x.key)||variants.has(`material:${x.material.name}`)||(variants.has('alpha-tested')&&x.material.alphaTest>0)||(variants.has('silhouette')&&/NdJiehuaGraph\.silhouette/.test(x.material.name))||(variants.has('jiehua')&&/NdJiehuaGraph\.jiehua/.test(x.material.name));
    mode='off';for(let i=0;i<4;i++)composer.render(0);
    if(want==='inventory'){materials.clear();r.info.reset();mode='inventory';composer.render(0);mode='off';sync();return {materials:[...materials.values()],calls:r.info.render.calls,triangles:r.info.render.triangles};}
    if(want==='throughput'){sync();const start=performance.now();for(let i=0;i<k;i++)composer.render(0);const submitted=performance.now();sync();return {whole:(performance.now()-start)/k,cpu:(submitted-start)/k};}
    throw new Error('Unknown GPU census mode');
   }finally{mode='off';skip=null;skipDepth=false;r.shadowMap.autoUpdate=shadow.auto;r.shadowMap.needsUpdate=shadow.needs;for(const[p,v]of disabled)p.enabled=v;for(const[e,blend,descriptor]of disabledEffects){e.blendMode.blendFunction=blend;if(descriptor===undefined)Reflect.deleteProperty(e,'update');else Object.defineProperty(e,'update',descriptor);}}
  },
  restore(){mode='off';for(const row of passes)row.pass.render=row.render;r.renderBufferDirect=rawDraw;gl.blitFramebuffer=rawBlit;},
  environment(){const dbg=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],timer:'synchronized whole-frame throughput including CPU submission',camera:{world:g.camera.matrixWorld.toArray(),projection:g.camera.projectionMatrix.toArray(),fov:g.camera.fov,aspect:g.camera.aspect},player:w.player.position.toArray(),programs:r.info.programs?.length,frame:g.frameCount,passes:P.passes};}
 };window.__gpuCensus=P;return P.environment();
}
