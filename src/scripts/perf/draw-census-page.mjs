/** Browser-serialized census. Baseline reads native completed-frame counters;
 * attribution wraps submissions and optional property counts only in a separate diagnostic window.
 * @param {{frames: number, attribution: boolean, propertyCalls?: boolean, programSources?: boolean, systemIds?: string[]}} options */
export function drawFrames({ frames, attribution, propertyCalls = false, programSources = false, systemIds }) {
  const api = window.__wildshard, world = api?.world, game = world?.game;
  if (!game || !world.hud.entered || world.hud.paused || !game.frameGate()) throw new Error('Census requires uncovered, entered controls');
  if (programSources && !attribution) throw new Error('Program sources require the separate attribution window');
  const renderer = game.renderer, gl = renderer.getContext();
  const restores = [], results = [];
  const selectedSystems = new Set(systemIds), presentSystems = new Set();
  let systemBucket;
  let bucket, current = null, shadow = 0, pass = 'outside-composer', started = false, last = game.frameCount;
  let program = gl.getParameter(gl.CURRENT_PROGRAM), nextProgram = 0;
  const programs = new Map();
  const programId = () => {
    if (program === null) {
      if (programSources) throw new Error('Native submission has no linked program');
      return null;
    }
    if (!programs.has(program)) programs.set(program, ++nextProgram);
    return programs.get(program);
  };
  const fresh = () => ({ draws: [], useProgram: 0, uniforms: 0, glCalls: 0, propertyReads: propertyCalls ? { total: 0, byKind: {} } : null });
  const replace = (object, name, wrap) => {
    const original = Reflect.get(object, name), descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (typeof original !== 'function') throw new Error(`Missing census port ${name}`);
    if (!Reflect.set(object, name, wrap(original))) throw new Error(`Cannot instrument census port ${name}`);
    restores.push(() => { if (descriptor) Object.defineProperty(object, name, descriptor); else Reflect.deleteProperty(object, name); });
  };
  const submission = (count, method) => {
    if (!bucket) return;
    bucket.glCalls++;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid native draw count');
    const target = renderer.getRenderTarget();
    bucket.draws.push({ ...current, owner: current?.owner ?? '(unattributed)', method, count: 1, subDraws: count, program: programId(),
      pass: shadow > 0 ? 'shadow' : target === null ? 'screen' : 'render-target', composerPass: pass });
  };
  if (systemIds !== undefined) {
    if (attribution || selectedSystems.size !== systemIds.length || systemIds.length === 0) throw new Error('System census needs a separate, unique native window');
    try {
      for (const specs of Object.values(game.app.systemsByPhase())) for (const spec of specs) {
        if (!selectedSystems.has(spec.id)) continue;
        if (presentSystems.has(spec.id)) throw new Error('Duplicate census system identity');
        presentSystems.add(spec.id);
        replace(spec, 'run', original => function censusSystem(...args) {
          if (systemBucket === undefined) return Reflect.apply(original, this, args);
          const start = performance.now();
          try { return Reflect.apply(original, this, args); }
          finally { const row = systemBucket[spec.id]; row.calls++; row.ms += performance.now() - start; }
        });
      }
    } catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
  }
  if (attribution) {
    try {
      if (propertyCalls) replace(renderer.properties, 'get', original => function censusProperties(resource) {
        if (bucket?.propertyReads) {
          const kind = resource?.isTexture ? 'texture' : resource?.isMaterial ? 'material'
            : resource?.isBufferGeometry ? 'geometry' : resource?.isSource ? 'source'
              : resource?.isRenderTarget ? 'target' : resource?.isObject3D ? 'object' : 'other';
          bucket.propertyReads.total++;
          bucket.propertyReads.byKind[kind] = (bucket.propertyReads.byKind[kind] ?? 0) + 1;
        }
        return Reflect.apply(original, this, [resource]);
      });
      replace(renderer, 'renderBufferDirect', original => function censusCall(...args) {
        const previous = current, geometry = args[2], material = args[3], object = args[4], chain = [];
        for (let node = object; node; node = node.parent) chain.push(node.name === '' ? node.type : node.name);
        current = { owner: chain.reverse().join('>'), object: object.type, material: material.type,
          materialId: material.uuid, geometryId: geometry.uuid, instances: object.isInstancedMesh ? object.count : 1,
          nodeMaterial: material.isNodeMaterial === true, skinned: object.isSkinnedMesh === true };
        try { return Reflect.apply(original, this, args); } finally { current = previous; }
      });
      replace(renderer.shadowMap, 'render', original => function censusCall(...args) {
        shadow++; try { return Reflect.apply(original, this, args); } finally { shadow--; }
      });
      for (const [index, item] of game.composer.passes.entries()) replace(item, 'render', original => function censusCall(...args) {
        const previous = pass; pass = `${index}:${typeof item.name === 'string' && item.name !== '' ? item.name : item.constructor.name}`;
        try { return Reflect.apply(original, this, args); } finally { pass = previous; }
      });
      replace(gl, 'useProgram', original => function censusCall(...args) {
        program = args[0]; if (bucket) bucket.useProgram++;
        return Reflect.apply(original, this, args);
      });
      // WebGL2 inherits scalar uniform methods from WebGLRenderingContext.
      const names = new Set();
      for (let prototype = gl; prototype; prototype = Object.getPrototypeOf(prototype)) for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
      for (const name of names) if (/^uniform(?:Matrix)?[1234]/u.test(name)) replace(gl, name, original => function censusCall(...args) {
        if (bucket) bucket.uniforms++; return Reflect.apply(original, this, args);
      });
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) replace(gl, name, original => function censusCall(...args) {
        const value = Reflect.apply(original, this, args); submission(1, name); return value;
      });
      const extension = gl.getExtension('WEBGL_multi_draw');
      if (extension) for (const [name, offset] of [['multiDrawElementsWEBGL', 6], ['multiDrawArraysWEBGL', 5], ['multiDrawElementsInstancedWEBGL', 8], ['multiDrawArraysInstancedWEBGL', 7]]) {
        replace(extension, name, original => function censusCall(...args) {
          const value = Reflect.apply(original, this, args); submission(args[offset], name); return value;
        });
      }
    } catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
  }
  return new Promise((resolve, reject) => {
    let stop, finished = false;
    // oxlint-disable-next-line prefer-const -- finish closes over this timer before installation
    let deadline;
    const finish = error => {
      if (finished) return; finished = true; stop?.(); clearTimeout(deadline);
      for (const restore of restores.reverse()) restore();
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else try {
        const tail = results.at(-1);
        if (programSources) {
          if (tail === undefined) throw new Error('Program source window has no completed frames');
          // Only actual submissions enter this map, never renderer.info's
          // compiled cache. Query after the window and observer restoration.
          tail.programSources = [...programs].map(([linked, id]) => {
            const shaders = gl.getAttachedShaders(linked);
            if (shaders === null || shaders.length === 0) throw new Error('Drawn program has no attached shaders');
            const attributes = gl.getProgramParameter(linked, gl.ACTIVE_ATTRIBUTES), uniforms = gl.getProgramParameter(linked, gl.ACTIVE_UNIFORMS);
            if (!Number.isSafeInteger(attributes) || attributes < 0 || !Number.isSafeInteger(uniforms) || uniforms < 0) throw new Error('Invalid native program interface');
            return { id, shaders: shaders.map(shader => {
              const source = gl.getShaderSource(shader), type = gl.getShaderParameter(shader, gl.SHADER_TYPE);
              if (typeof source !== 'string' || source.length === 0 || type !== gl.VERTEX_SHADER && type !== gl.FRAGMENT_SHADER) throw new Error('Drawn program has no shader source');
              return { type, source };
            }), attributes: Array.from({length: attributes}, (_, index) => {
              const row = gl.getActiveAttrib(linked, index);
              if (row === null) throw new Error('Missing native active attribute');
              return {name: row.name, type: row.type, size: row.size, location: gl.getAttribLocation(linked, row.name)};
            }), uniforms: Array.from({length: uniforms}, (_, index) => {
              const row = gl.getActiveUniform(linked, index);
              if (row === null) throw new Error('Missing native active uniform');
              return {name: row.name, type: row.type, size: row.size};
            }) };
          });
        }
        resolve(results);
      } catch (failure) { reject(failure instanceof Error ? failure : new Error(String(failure))); }
    };
    deadline = setTimeout(() => finish(new Error('Census frame window exceeded 30 seconds')), 30000);
    try {
      stop = game.watchFrames(() => {
        try {
          if (window.__wildshard !== api || api.world !== world || !world.hud.entered || world.hud.paused || !game.frameGate() || document.hidden) throw new Error('Census world or presentation changed');
          // watchFrames is in the NEXT update: native rings/lastFrame describe
          // the completed draw, while the current renderer.info was reset.
          if (started) {
            if (game.frameCount !== last + 1) throw new Error('Census missed a completed frame');
            const index = (game.frameI + game.frameMs.length - 1) % game.frameMs.length;
            const row = { frame: game.frameCount, calls: game.lastFrame.calls, triangles: game.lastFrame.triangles,
              frameMs: game.frameMs[index], workMs: game.workMs[index], renderMs: game.renderMs[index], ...bucket };
            if (systemIds !== undefined) row.systems = systemBucket;
            if (attribution && row.draws.reduce((sum, draw) => sum + draw.count, 0) !== row.calls) throw new Error('Native draw submissions disagree with whole-frame calls');
            results.push(row);
          }
          if (results.length >= frames) { finish(); return; }
          started = true; last = game.frameCount; bucket = attribution ? fresh() : undefined;
          if (systemIds !== undefined) systemBucket = Object.fromEntries([...presentSystems].map(id => [id, {calls:0, ms:0}]));
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
}
