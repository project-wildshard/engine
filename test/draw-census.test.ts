import { expect, test, vi } from 'vitest';
import { drawFrames } from '../scripts/perf/draw-census-page.mjs';
import { nativeSummary, attributionSummary, sampledCpu } from '../scripts/perf/draw-census-report.mjs';
import { censusSelection, censusEntry } from '../scripts/perf/draw-census-poses.mjs';

test('census enters by the one ENTER WORLD and refuses a locked card', () => {
  expect(censusEntry('Enter world')).toBe('.ws-menu-play');
  expect(censusEntry(' Enter world ')).toBe('.ws-menu-play');
  expect(()=>censusEntry('Coming soon')).toThrow('unavailable');
});

test('census measures the shardfile only, at standing golden P1 cameras', () => {
  expect(censusSelection().map(row => [row.slug, row.poseName, row.modes])).toEqual([
    ['nine-dragon-stack', 'P4', ['shardfile']], ['pine-hollow', 'Q4', ['shardfile']],
  ]);
  expect(censusSelection('pine-hollow', 'P1', 'shardfile')[0]?.pose).toEqual({x:0,z:-235,yaw:Math.PI,pitch:0});
  expect(()=>censusSelection('pine-hollow', 'P1', 'legacy')).toThrow('LEGACY census leg is gone');
  expect(()=>censusSelection('nine-dragon-stack', 'Q4', 'both')).toThrow('LEGACY census leg is gone');
  // Input fixtures exercise both authored representations; the CLI lends its
  // actual camera table instead of making this pure module import art/.
  const cameras = {
    'driftwood-isle': [{n:1,name:'pier',yaw:-180,pitch:0,probe:{x:0,z:-194,yaw:Math.PI,pitch:0}}],
    'nalati-grasslands': [{n:1,name:'camp',yaw:90,pitch:0,probe:{x:60,z:214,yaw:-Math.PI/2,pitch:0}}],
    'far-reach': [{n:1,name:'spawn',yaw:0,pitch:0,feet:[0,30,-5.5]}],
    'sunscar-dunes': [{n:1,name:'spawn',yaw:0,pitch:2,feet:[0,21.363867328746412,70]}],
  };
  expect(censusSelection('driftwood-isle', 'Q4', 'shardfile', cameras)[0]).toMatchObject({poseName:'P1:pier',pose:{x:0,z:-194,yaw:Math.PI,pitch:0},modes:['shardfile']});
  expect(censusSelection('nalati-grasslands', 'Q4', 'shardfile', cameras)[0]?.pose).toMatchObject({x:60,z:214,yaw:-Math.PI/2,pitch:0});
  expect(censusSelection('far-reach', 'Q4', 'shardfile', cameras)[0]?.pose).toMatchObject({x:0,y:30,z:-5.5,yaw:-0,pitch:0});
  expect(censusSelection('sunscar-dunes', 'Q4', 'shardfile', cameras)[0]?.pose).toMatchObject({x:0,z:70,yaw:-0,pitch:2*Math.PI/180});
  expect(() => censusSelection('far-reach')).toThrow('Missing golden census camera 1');
  expect(() => censusSelection('far-reach','Q4','shardfile',{'far-reach':[{n:2,name:'wrong',yaw:0,pitch:0,feet:[0,0,0]}]})).toThrow('Missing golden census camera 1');
  expect(() => censusSelection('far-reach','Q4','shardfile',{'far-reach':[{n:1,name:'invalid',yaw:0,pitch:0,feet:[Number.NaN,0,0]}]})).toThrow('not a standing pose');
  expect(() => censusSelection('missing')).toThrow('Unknown census shard');
  expect(() => censusSelection('', 'missing')).toThrow('Unknown Pine census pose');
  expect(() => censusSelection('', 'P1', 'missing')).toThrow('Unknown census mode');
});

test('render cost stays paired with its completed frame and zero draws stay unknown', () => {
  const result = nativeSummary([
    { calls: 10, renderMs: 2, workMs: 4, triangles: 100 },
    { calls: 100, renderMs: 1, workMs: 5, triangles: 200 },
    { calls: 0, renderMs: 3, workMs: 6, triangles: 0 },
  ]);
  expect(result.renderUsPerDrawP50).toBe(200);
  expect(result.zeroDrawFrames).toBe(1);
  expect(nativeSummary([{ calls: 0, renderMs: 0, workMs: 0, triangles: 0 }]).renderUsPerDrawP50).toBeNull();
  expect(() => nativeSummary([{ calls: 1, renderMs: Number.NaN, workMs: 0, triangles: 0 }])).toThrow('Invalid native');
});

test('all multi-draw submissions retain shadow, screen and owner attribution', () => {
  const draw = { owner: 'level>trees', count: 4, program: 1, materialId: 'm', geometryId: 'g', nodeMaterial: true, instances: 10, skinned: false };
  const result = attributionSummary([{ draws: [{ ...draw, pass: 'shadow' }, { ...draw, pass: 'render-target' },
    { ...draw, owner: 'post', pass: 'screen', program: 2, count: 1 }], useProgram: 3, uniforms: 8 }]);
  expect(result.draws).toBe(9);
  expect(result.passes).toEqual({ shadow: 4, 'render-target': 4, screen: 1 });
  expect(result.byOwner.find(row => row.owner === 'shadow|level>trees')?.drawsPerFrame).toBe(4);
  expect(result.programs).toBe(2);
});

test('CPU wrapper overhead excludes the stock draw and counts nested hooks once', () => {
  const callFrame = (source: string, name: string) => ({ source, name });
  const profile = { nodes: [
    { id: 1, callFrame: callFrame('/src/client/engine/core/worldDepth.ts', 'renderWorld'), children: [2] },
    { id: 2, callFrame: callFrame('/src/client/engine/render/uploadOwnership.ts', 'renderer.renderBufferDirect'), children: [3] },
    { id: 3, callFrame: callFrame('/src/client/engine/render/memorySaver.ts', 'renderer.renderBufferDirect'), children: [4] },
    { id: 4, callFrame: callFrame('/node_modules/three/src/renderers/WebGLRenderer.js', 'renderBufferDirect') },
  ], samples: [2, 3, 4], timeDeltas: [1000, 2000, 4000] };
  const result = sampledCpu(profile, frame => frame, 1);
  expect(result.msPerFrame).toMatchObject({ renderWorld: 7, stockDraw: 4, drawWrappers: 3 });
  expect(sampledCpu(profile, () => ({ source: '', name: '' }), 1).msPerFrame['drawWrappers']).toBeNull();
});

test('a source-mapped minified submission stays attributed outside the stock draw', () => {
  const profile = { nodes: [
    { id: 1, callFrame: { source: '/src/client/engine/render/drawHooks.ts', name: 'o submit' }, children: [2] },
    { id: 2, callFrame: { source: '/node_modules/three/src/renderers/WebGLRenderer.js', name: 'renderBufferDirect' } },
  ], samples: [1, 2], timeDeltas: [2000, 5000] };
  const result = sampledCpu(profile, frame => frame, 2);
  expect(result.msPerFrame['drawWrappers']).toBe(1);
  expect(result.msPerFrame['stockDraw']).toBe(2.5);
});


test('function rankings retain source positions and count recursive inclusive samples once', () => {
  const frame = { source: '/src/client/engine/render/drawHooks.ts', name: 'submit', line: 48, column: 2 };
  const profile = { nodes: [
    { id: 1, callFrame: frame, children: [2] },
    { id: 2, callFrame: frame, children: [3] },
    { id: 3, callFrame: { ...frame, source: '/node_modules/three/native.js', name: 'native' } },
  ], samples: [2, 3], timeDeltas: [2000, 4000] };
  const result = sampledCpu(profile, value => value, 2);
  expect(result.functions).toEqual([{ ...frame, selfMs: 2, inclusiveMs: 6, selfMsPerFrame: 1, inclusiveMsPerFrame: 3 }]);
  expect(sampledCpu(profile, value => value, 0).functions[0]?.selfMsPerFrame).toBeNull();
  expect(sampledCpu(profile, () => ({ source: '', name: '' }), 2).functions).toEqual([]);
});


test('property totals require complete, internally consistent frame coverage', () => {
  const frame = {draws:[], useProgram:0, uniforms:0};
  expect(attributionSummary([frame]).propertyReads).toBeNull();
  const first = {...frame, propertyReads:{total:3, byKind:{texture:2, material:1}}};
  expect(attributionSummary([first, frame]).propertyReads).toBeNull();
  expect(attributionSummary([first, {...frame, propertyReads:{total:1, byKind:{texture:1}}}]).propertyReads)
    .toEqual({totalPerFrame:2, byKind:{texture:1.5, material:.5}});
  expect(() => attributionSummary([{...frame, propertyReads:{total:3, byKind:{texture:2}}}])).toThrow('Invalid property read census');
});

function propertyFixture() {
  const native = {}, get = vi.fn((_resource:unknown) => native);
  const texture = {isTexture:true}, source = {isSource:true}, callbacks:{frame?:()=>void} = {};
  const gl = {CURRENT_PROGRAM:1, getParameter:()=>null, getExtension:()=>null,
    useProgram:()=>undefined, drawElements:()=>undefined, drawArrays:()=>undefined,
    drawElementsInstanced:()=>undefined, drawArraysInstanced:()=>undefined, drawRangeElements:()=>undefined};
  const renderer = {properties:{get}, shadowMap:{render:()=>undefined}, getRenderTarget:()=>null, getContext:()=>gl,
    renderBufferDirect:(..._args:unknown[]) => {renderer.properties.get(texture);renderer.properties.get(texture);renderer.properties.get(source);gl.drawArrays();}};
  const originalDraw = renderer.renderBufferDirect;
  const game = {renderer, composer:{passes:[]}, frameGate:()=>true, frameCount:0, frameI:0, frameMs:[1], workMs:[1], renderMs:[1],
    lastFrame:{calls:1,triangles:1},watchFrames:(observeFrame:()=>void) => {callbacks.frame=observeFrame;return()=>{delete callbacks.frame;};}};
  const world = {game,hud:{entered:true,paused:false}};
  const mesh = {name:'fixture',type:'Mesh',parent:null};
  const draw = () => {renderer.renderBufferDirect({}, {}, {uuid:'g'}, {uuid:'m'}, mesh, null);};
  return {native,get,renderer,originalDraw,game,world,callbacks,draw};
}

function browserFixture(world:object):()=>void {
  const values={window:{__wildshard:{world}},document:{hidden:false}};
  const descriptors=new Map(Object.keys(values).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const [name,value] of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  return()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}};
}

test('property census calls the real getter and restores it after success and refusal', async () => {
  for (const fail of [false,true]) {
    const f=propertyFixture();
    const restore=browserFixture(f.world);
    try {
      const capture=drawFrames({frames:1,attribution:true,propertyCalls:true});
      expect(f.renderer.properties.get).not.toBe(f.get);
      f.callbacks.frame?.();
      if(fail){f.world.hud.paused=true;f.callbacks.frame?.();await expect(capture).rejects.toThrow('presentation changed');}
      else {
        f.draw();f.game.frameCount++;f.callbacks.frame?.();
        const rows=await capture;
        expect(rows[0]?.propertyReads).toEqual({total:3,byKind:{texture:2,source:1}});
        expect(f.get).toHaveBeenCalledTimes(3);
      }
      expect(f.renderer.properties.get).toBe(f.get);expect(f.renderer.renderBufferDirect).toBe(f.originalDraw);
    }finally{restore();}
  }
});

test('native baseline never installs a property observer', async () => {
  const f=propertyFixture(),restore=browserFixture(f.world);
  try {
    const capture=drawFrames({frames:1,attribution:false,propertyCalls:true});
    expect(f.renderer.properties.get).toBe(f.get);
    f.callbacks.frame?.();f.game.frameCount++;f.callbacks.frame?.();
    expect((await capture)[0]?.propertyReads).toBeUndefined();
  }finally{restore();}
});

function programFixture(fault: 'source' | 'attribute' | 'count' | null = null) {
  const f = propertyFixture(), program = {}, cachedOnly = {}, vertex = {}, fragment = {};
  const attached = vi.fn((drawn: object) => {
    expect(drawn).toBe(program);
    expect(f.renderer.renderBufferDirect).toBe(f.originalDraw);
    expect(f.renderer.properties.get).toBe(f.get);
    return [vertex, fragment];
  });
  const source = vi.fn((shader: object) => fault === 'source' ? null : shader === vertex ? 'vertex source' : 'fragment source');
  Object.assign(f.renderer, {info: {programs: [program, cachedOnly]}});
  Object.assign(f.renderer.getContext(), {
    SHADER_TYPE: 2, ACTIVE_ATTRIBUTES: 3, ACTIVE_UNIFORMS: 4, VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632,
    getParameter: () => program, getAttachedShaders: attached, getShaderSource: source,
    getShaderParameter: (shader: object) => shader === vertex ? 35633 : 35632,
    getProgramParameter: () => fault === 'count' ? Number.NaN : 1,
    getActiveAttrib: () => fault === 'attribute' ? null : {name: 'position', type: 35665, size: 1},
    getAttribLocation: () => 0,
    getActiveUniform: () => ({name: 'modelViewMatrix', type: 35676, size: 1}),
  });
  return {...f, program, attached, source};
}

test('program sources describe submitted links, not the compiled cache, after observer restoration', async () => {
  const f = programFixture(), restore = browserFixture(f.world);
  try {
    const capture = drawFrames({frames: 1, attribution: true, programSources: true});
    f.callbacks.frame?.(); f.draw(); f.draw(); f.game.lastFrame.calls = 2; f.game.frameCount++; f.callbacks.frame?.();
    const rows = await capture;
    expect(rows[0]?.programSources).toEqual([{id: 1,
      shaders: [{type: 35633, source: 'vertex source'}, {type: 35632, source: 'fragment source'}],
      attributes: [{name: 'position', type: 35665, size: 1, location: 0}],
      uniforms: [{name: 'modelViewMatrix', type: 35676, size: 1}],
    }]);
    expect(rows[0]?.draws?.map(draw => draw.program)).toEqual([1, 1]);
    expect(f.attached).toHaveBeenCalledExactlyOnceWith(f.program); expect(f.source).toHaveBeenCalledTimes(2);
  } finally {restore();}
});

test('each submitted link keeps its own shaders and active interface', async () => {
  const f = programFixture(), second = {}, restore = browserFixture(f.world);
  const a = [{type: 35633, source: 'vertex A'}, {type: 35632, source: 'fragment A'}];
  const b = [{type: 35633, source: 'vertex B'}, {type: 35632, source: 'fragment B'}];
  const gl = f.renderer.getContext();
  Object.assign(gl, {
    getAttachedShaders: (linked: object) => linked === f.program ? a : b,
    getShaderParameter: (shader: {type: number}) => shader.type,
    getShaderSource: (shader: {source: string}) => shader.source,
    getActiveAttrib: (linked: object) => ({name: linked === f.program ? 'position' : 'normal', type: 35665, size: 1}),
    getAttribLocation: (linked: object) => linked === f.program ? 0 : 1,
    getActiveUniform: (linked: object) => ({name: linked === f.program ? 'matrixA' : 'matrixB', type: 35676, size: 1}),
  });
  try {
    const capture = drawFrames({frames: 1, attribution: true, programSources: true});
    f.callbacks.frame?.(); f.draw(); Reflect.apply(gl.useProgram, gl, [second]); f.draw();
    f.game.lastFrame.calls = 2; f.game.frameCount++; f.callbacks.frame?.();
    const sources = (await capture)[0]?.programSources;
    expect(sources?.map(row => [row.id, row.shaders, row.attributes[0]?.name, row.attributes[0]?.location, row.uniforms[0]?.name])).toEqual([
      [1, a, 'position', 0, 'matrixA'], [2, b, 'normal', 1, 'matrixB'],
    ]);
    expect(f.renderer.renderBufferDirect).toBe(f.originalDraw);
  } finally {restore();}
});

test.each(['source', 'attribute', 'count'] as const)('program introspection %s failure refuses after restoring native hooks', async fault => {
  const f = programFixture(fault), restore = browserFixture(f.world);
  try {
    const capture = drawFrames({frames: 1, attribution: true, programSources: true});
    f.callbacks.frame?.(); f.draw(); f.game.frameCount++; f.callbacks.frame?.();
    await expect(capture).rejects.toThrow(fault === 'source' ? 'shader source' : fault === 'attribute' ? 'active attribute' : 'program interface');
    expect(f.renderer.renderBufferDirect).toBe(f.originalDraw); expect(f.renderer.properties.get).toBe(f.get);
    expect(f.callbacks.frame).toBeUndefined();
  } finally {restore();}
});

test.each([false, true])('default native/attribution window never queries shader sources (attribution=%s)', async attribution => {
  const f = programFixture(), restore = browserFixture(f.world);
  try {
    const capture = drawFrames({frames: 1, attribution});
    f.callbacks.frame?.(); f.draw(); f.game.frameCount++; f.callbacks.frame?.();
    expect((await capture)[0]?.programSources).toBeUndefined(); expect(f.attached).not.toHaveBeenCalled(); expect(f.source).not.toHaveBeenCalled();
    expect(() => drawFrames({frames: 1, attribution: false, programSources: true})).toThrow('separate attribution');
    expect(f.renderer.renderBufferDirect).toBe(f.originalDraw);
  } finally {restore();}
});

test('system attribution keeps native calls, frame buckets and descriptor restoration', async () => {
  for (const fail of [false, true]) {
    const f = propertyFixture(), calls: unknown[][] = [];
    const spec = {id:'main.world', run(...args: unknown[]) {calls.push([this, ...args]);}};
    const descriptor = Object.getOwnPropertyDescriptor(spec, 'run');
    Object.assign(f.game, {app:{systemsByPhase:()=>({update:[spec]})}});
    const restore = browserFixture(f.world);
    try {
      const capture = drawFrames({frames:1, attribution:false, systemIds:['main.world','absent']});
      const original = descriptor?.value;
      expect(Reflect.get(spec, 'run')).not.toBe(original);
      // A pre-window call runs normally but does not enter the first frame.
      spec.run(.1, 1); f.callbacks.frame?.();
      spec.run(.2, 2);
      if (fail) {f.world.hud.paused=true;f.callbacks.frame?.();await expect(capture).rejects.toThrow('presentation changed');}
      else {
        f.game.frameCount++;f.callbacks.frame?.();
        const rows = await capture;
        expect(rows[0]?.systems?.['main.world']?.calls).toBe(1);
        expect(rows[0]?.systems?.['main.world']?.ms).toBeGreaterThanOrEqual(0);
        expect(rows[0]?.systems).not.toHaveProperty('absent');
      }
      expect(calls).toEqual([[spec,.1,1],[spec,.2,2]]);
      expect(Object.getOwnPropertyDescriptor(spec,'run')).toEqual(descriptor);
      expect(f.renderer.properties.get).toBe(f.get);
      expect(f.renderer.renderBufferDirect).toBe(f.originalDraw);
    } finally {restore();}
  }
});

test('system window refuses mixed or duplicate observation identities before mutation', () => {
  const f=propertyFixture(), restore=browserFixture(f.world);
  try {
    expect(()=>drawFrames({frames:1,attribution:true,systemIds:['x']})).toThrow('separate');
    expect(()=>drawFrames({frames:1,attribution:false,systemIds:['x','x']})).toThrow('unique');
  }finally{restore();}
});


test('game gather functions remain visible without inflating draw-wrapper attribution', () => {
  const profile = {nodes:[
    {id:1,callFrame:{source:'/src/shared/game/plugin/channelPrograms.ts',name:'evaluate'},children:[2]},
    {id:2,callFrame:{source:'/src/shared/game/plugin/channels.ts',name:'evaluate'}},
  ],samples:[1,2],timeDeltas:[1000,2000]};
  const result=sampledCpu(profile,frame=>frame,2);
  expect(result.functions.map(row=>[row.source,row.selfMsPerFrame,row.inclusiveMsPerFrame])).toEqual([
    ['/src/shared/game/plugin/channels.ts',1,1],['/src/shared/game/plugin/channelPrograms.ts',.5,1.5],
  ]);
  expect(result.msPerFrame['drawWrappers']).toBeNull();
  expect(result.msPerFrame['propertyHooks']).toBeNull();
});


test('Nine P5 is explicit and keeps the default P4', () => {
  expect(censusSelection('nine-dragon-stack','Q4','shardfile',{},'P5')).toEqual([
    {slug:'nine-dragon-stack',poseName:'P5',pose:{x:76,y:146,z:6,yaw:-90*(Math.PI/180),pitch:4*(Math.PI/180)},modes:['shardfile']},
  ]);
  expect(censusSelection('nine-dragon-stack')[0]?.poseName).toBe('P4');
  expect(()=>censusSelection('nine-dragon-stack','Q4','shardfile',{},'missing')).toThrow('Unknown Nine census pose');
});


test('raw frame interval, game work and render cost refer to the same completed ring slot',async()=>{
 const f=propertyFixture(),restore=browserFixture(f.world);
 f.game.frameMs=[4,31,9];f.game.workMs=[5,6,7];f.game.renderMs=[8,9,10];f.game.frameI=2;
 try{
  const capture=drawFrames({frames:1,attribution:false});
  f.callbacks.frame?.();f.game.frameCount++;f.callbacks.frame?.();
  expect((await capture)[0]).toMatchObject({frame:1,frameMs:31,workMs:6,renderMs:9,calls:1,triangles:1});
  expect(f.renderer.properties.get).toBe(f.get);expect(f.renderer.renderBufferDirect).toBe(f.originalDraw);
 }finally{restore();}
});
