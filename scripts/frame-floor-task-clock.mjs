/**
 * sp-o13: the opt-in in-page task clock (`frame-floor.mjs --task-clock`, diagnostic only, no timing credit).
 *
 * WebKit's Timeline returns zero clocks on the iOS Simulator (progress/frame-floor/sp-o3-attribution-2026-10-12), and most
 * Simulator travel long frames carry neither GL time nor rAF work. Low game work and zero GL do not prove that JS ran
 * between frames (sp-x1): this clock records task spans so a long frame can be told apart as busy (callbacks executing),
 * unavailable (a gap no wrapped task covers) or display scheduling (tasks keep starting and ending on time while rAF is
 * late).
 *
 * It wraps the page's task entry points (timers, rAF, `message` listeners and `onmessage` on ports and workers). Each
 * task keeps `[startMs, syncMs, totalMs, end, kind, site]`:
 * - `syncMs`: the callback's own synchronous execution, exact.
 * - `totalMs`: until the next wrapped task starts (`end` 't') or a message posted when the callback returned arrives
 *   (`end` 'e'), whichever is first. The echo runs after the task's microtask checkpoint, so an async builder's
 *   continuation (an `await buildYield()` resuming) is inside `totalMs`. Both ends are upper bounds: `totalMs` can
 *   include queueing behind unwrapped work (network, decode), so it is busy time only where `syncMs` or a stack shows it.
 * - `site`: an index into `sites`: the stack where the callback was scheduled (or its listener added), then `<=` and
 *   the site of the task that scheduled it, up to three hops, so a paced frame wait (`nextDrawnFrame`: rAF, then a
 *   message) still names the builder that asked for it. Frames are bundle locations; the build's source maps resolve them.
 * Tasks under `minMs` total are dropped; the rest is enough to see timer continuity across a late rAF.
 */
export function installTaskClock(minMs = 4, cap = 20000) {
  const W = window;
  if (typeof W.__frameFloorTaskTake === 'function') return;
  let tasks = [], sites = [], siteIds = new Map(), calls = [], groups = [], open = null, current = '', serial = 0, dropped = 0;
  const activeGroups = [];
  const drawName = object => {
    const path = [];
    for (let node = object; node && path.length < 5; node = node.parent) path.push(node.name === '' ? node.type : node.name);
    return `${path.reverse().join('/')}:${object?.geometry?.type ?? ''}:${object?.geometry?.attributes?.position?.count ?? 0}`;
  };
  const shaderHash = source => {
    let hash = 2166136261;
    for (const point of source) hash = Math.imul(hash ^ point.codePointAt(0), 16777619);
    return (hash >>> 0).toString(16);
  };
  const now = () => performance.now();
  const round = (ms) => Math.round(ms * 10) / 10;
  const frames = (stack) => String(stack ?? '').split('\n').map((line) => line.trim())
    .filter((line) => line !== '' && !line.includes('__ffTask') && !line.startsWith('Error')).slice(0, 5).join(' | ');
  const site = () => {
    const own = frames(new Error('__ffTask').stack);
    const hops = current.split(' <= ').slice(0, 2).join(' <= ');
    return hops === '' ? own : `${own} <= ${hops}`;
  };
  const siteId = (text) => {
    let id = siteIds.get(text);
    if (id === undefined) { id = sites.length; sites.push(text); siteIds.set(text, id); }
    return id;
  };
  // Native/data work often resumes in an unwrapped promise continuation. Its exact
  // synchronous span distinguishes a slow unit from a task's queueing upper bound.
  const measured = new WeakMap();
  const preparedGeometry = new WeakMap();
  const seenPrograms = new WeakMap(), observedScenes = new WeakSet(), observedGeometry = new WeakSet();
  const noteGeometry = object => {
    const geometry = object?.geometry;
    if (!geometry || observedGeometry.has(geometry)) return;
    observedGeometry.add(geometry);
    if (calls.length < cap) calls.push([round(now()), 0, `Geometry.draw:${drawName(object)}`, '', {
      geometryBytes: Object.values(geometry.attributes).reduce((bytes, attribute) => bytes + attribute.count * attribute.itemSize
        * (attribute.array?.BYTES_PER_ELEMENT ?? attribute.data?.array?.BYTES_PER_ELEMENT ?? 0),
      (geometry.index?.count ?? 0) * (geometry.index?.array?.BYTES_PER_ELEMENT ?? 0)),
      prepared: preparedGeometry.get(geometry), instanceCount: object.isInstancedMesh === true ? object.count : null,
      boneMatrixBytes: object.skeleton?.boneMatrices?.byteLength ?? 0,
      boneTextureBytes: object.skeleton?.boneTexture?.image?.data?.byteLength ?? 0,
    }]);
  };
  const notePrograms = (renderer, root, phase) => {
    if (!root || !renderer?.properties?.get) return;
    root.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        const programs = renderer.properties.get(material)?.programs;
        if (!(programs instanceof Map)) continue;
        let known = seenPrograms.get(material);
        if (known === undefined) { known = new Map(); seenPrograms.set(material, known); }
        for (const [key, program] of programs) {
          const stages = known.get(key) ?? new Set();
          if (stages.has(phase)) continue;
          stages.add(phase); known.set(key, stages);
          if (calls.length < cap) calls.push([round(now()), 0, `Program.${phase}:${drawName(object)}:${material.name}`, '',
            { material: material.uuid, key, id: program.id, selected: renderer.properties.get(material).currentProgram === program,
              object: object.uuid, parents: (() => { const parents = []; for (let node = object; node; node = node.parent) parents.push({ id: node.uuid, name: node.name === '' ? node.type : node.name, visible: node.visible }); return parents; })(),
              pageScene: window.__wildshard?.world?.game?.rootScene?.uuid, contentScene: window.__wildshard?.world?.game?.scene?.uuid,
              phase: window.__frameFloorGridStop?.phase }]);
        }
      }
    });
  };
  const measure = (target, name, label, before) => {
    if (!target || measured.get(target)?.has(name)) return;
    const fn = Reflect.get(target, name);
    if (typeof fn !== 'function') return;
    let names = measured.get(target);
    if (names === undefined) { names = new Set(); measured.set(target, names); }
    names.add(name);
    Reflect.set(target, name, function measuredCall(...args) {
      if (before !== undefined) Reflect.apply(before, this, args);
      const start = now();
      const grouped = ['Game.runPhase', 'Composer.render', 'Renderer.render', 'RuntimeHooks.activate'].includes(label);
      const children = grouped ? new Map() : null;
      if (children !== null) activeGroups.push(children);
      try { return Reflect.apply(fn, this, args); }
      finally {
        const ms = now() - start;
        if (label === 'Renderer.compile') notePrograms(this, args[0], 'compile');
        if (label === 'Renderer.renderBufferDirect') { noteGeometry(args[4]); notePrograms(this, args[4], 'draw'); }
        const operation = ['Game.runPhase', 'BuildStages.build'].includes(label) && typeof args[0] === 'string' ? `${label}:${args[0]}`
          : label === 'Nodes.build' ? `${label}:${drawName(args[1])}:${args[0]?.name ?? ''}`
          : label === 'Renderer.renderBufferDirect' ? `${label}:${drawName(args[4])}:${args[3]?.name ?? ''}` : label;
        const compiled = label === 'Nodes.build' ? { key: args[0].customProgramCacheKey(),
          vertex: shaderHash(args[2].vertexShader), fragment: shaderHash(args[2].fragmentShader) } : null;
        if ((ms >= minMs || compiled !== null || label === 'RuntimeHooks.activate' || label === 'RuntimeSlots.activate') && calls.length < cap) calls.push([round(start), round(ms), operation, new Error('frame-floor native call').stack ?? '', compiled]);
        if (children !== null) {
          activeGroups.pop();
          if ((ms >= minMs || label === 'RuntimeHooks.activate') && groups.length < cap) groups.push([round(start), round(ms), operation,
            [...children].map(([operationName, value]) => [operationName, value[0], round(value[1]), round(value[2])])]);
        }
        for (const group of activeGroups) {
          const value = group.get(operation) ?? [0, 0, 0];
          value[0]++; value[1] += ms; value[2] = Math.max(value[2], ms); group.set(operation, value);
        }
      }
    });
  };
  measure(JSON, 'parse', 'JSON.parse');
  measure(TextDecoder.prototype, 'decode', 'TextDecoder.decode');
  // Keep the exact query span and its caller, not just the adjacent frame's
  // aggregate GL bucket. A cold index can originate in preparation or a draw.
  for (const Context of [W.WebGLRenderingContext, W.WebGL2RenderingContext]) {
    if (typeof Context === 'function') for (const name of ['getUniformBlockIndex', 'getProgramInfoLog']) measure(Context.prototype, name, `GL.${name}`);
  }
  const moduleCalls = new Set(), moduleErrors = [];
  const phaseLists = new WeakSet();
  const prepareWorldCalls = () => {
    const world = W.__wildshard?.world, game = world?.game, physics = game?.app?.physics;
    measure(game?.camera, 'clone', 'Camera.clone');
    measure(game, 'warmEnteredStages', 'Game.warmEnteredStages', (_owner, _composer, _trace, _current, root) => {
      if (!root) return;
      const eye = game.camera.getWorldPosition(game.camera.position.clone());
      calls.push([round(now()), 0, 'View.prepare', '', { root: root.name,
        player: world.player.position.toArray(), eye: eye.toArray(), localEye: root.worldToLocal(eye.clone()).toArray() }]);
      root.traverse(object => {
        if (!object.geometry) return;
        const ancestors = [];
        for (let node = object; node; node = node.parent) {
          ancestors.push({ name: node.name === '' ? node.type : node.name, visible: node.visible, layers: node.layers.mask });
          if (node === root) break;
        }
        preparedGeometry.set(object.geometry, { atMs: round(now()), name: drawName(object), ancestors,
          instanceCount: object.isInstancedMesh === true ? object.count : null, cameraLayers: game.camera.layers.mask });
      });
    });
    const input = game?.app?.input;
    for (const name of ['refresh', 'repaint', 'push', 'pop', 'register', 'touchLayout']) measure(input, name, `Input.${name}`);
    measure(game?.app, 'addSystem', 'App.addSystem');
    for (const name of ['on', 'answer', 'emit']) measure(game?.app?.events, name, `Events.${name}`);
    measure(game, 'runPhase', 'Game.runPhase', phase => {
      const systems = game.app.systemsByPhase()[phase];
      if (!systems || phaseLists.has(systems)) return;
      phaseLists.add(systems);
      for (const system of systems) measure(system, 'run', `System.${system.id}`);
    });
    for (const name of ['runFixed', 'flushEvents']) measure(game, name, `Game.${name}`);
    measure(game?.composer, 'render', 'Composer.render');
    measure(game?.renderer, 'render', 'Renderer.render', scene => {
      if (!scene || observedScenes.has(scene)) return; observedScenes.add(scene);
      calls.push([round(now()), 0, 'Scene.render', new Error('scene render origin').stack ?? '',
        { id: scene.uuid, name: scene.name, page: scene === game.rootScene, content: scene === game.scene, phase: W.__frameFloorGridStop?.phase }]);
    });
    measure(game?.renderer, 'renderBufferDirect', 'Renderer.renderBufferDirect');
    measure(game?.renderer, 'compile', 'Renderer.compile');
    measure(game?.renderer, 'initTexture', 'Renderer.initTexture');
    measure(game?.renderer?.shadowMap, 'render', 'ShadowMap.render');
    measure(game?.scene, 'updateMatrixWorld', 'Scene.updateMatrixWorld');
    measure(physics, 'step', 'Physics.step');
    measure(physics?.R?.ColliderDesc, 'convexHull', 'Rapier.convexHull');
    measure(physics?.R?.ColliderDesc, 'trimesh', 'Rapier.trimesh');
    const geometry = world?.game?.scene?.children?.flatMap(object => {
      const found = [];
      object.traverse(child => { if (child.geometry) found.push(child.geometry); });
      return found;
    })?.[0];
    for (const name of ['applyMatrix4', 'computeBoundingBox', 'computeBoundingSphere', 'computeVertexNormals', 'clone', 'toNonIndexed']) {
      let target = geometry;
      while (target && !Object.hasOwn(target, name)) target = Object.getPrototypeOf(target);
      measure(target, name, `BufferGeometry.${name}`);
    }
    for (const resource of performance.getEntriesByType('resource')) {
      if (!/\/(?:assets|b\/[\w.-]+)\/(?:place|weld|plan|audio|hybrid)-[^/]+\.js$/u.test(resource.name) || moduleCalls.has(resource.name)) continue;
      moduleCalls.add(resource.name);
      void (async () => { try {
        const exports = await import(resource.name);
        const nodes = (exports.EngineNodesHandler ?? Object.values(exports).find(value => typeof value === 'function'
          && value.prototype && typeof value.prototype.onUpdateProgram === 'function' && typeof value.prototype.setObject === 'function'))?.prototype;
        if (nodes) for (const name of ['build', 'setObject', 'beforeDraw', 'bindBlocks', 'bindDraw', 'onUpdateProgram', 'renderStart', 'updateLights']) measure(nodes, name, `Nodes.${name}`);
        for (const value of Object.values(exports)) {
          if (typeof value !== 'function' || !value.prototype) continue;
          const prototype = value.prototype;
          if (typeof prototype.activate === 'function' && typeof prototype.deactivate === 'function' && typeof prototype.install === 'function') {
            for (const name of ['activate', 'deactivate', 'install']) measure(prototype, name, `RuntimeHooks.${name}`);
          } else if (typeof prototype.installAhead === 'function' && typeof prototype.timings === 'function') {
            measure(prototype, 'install', 'Hybrid.install', function prepareRuntimeSlots() {
              // Instance slots are closure-backed, so observe them before entry.
              for (const active of this.retained.values()) measure(active.retained?.slots, 'activate', 'RuntimeSlots.activate');
            });
          } else if (typeof prototype.finish === 'function' && typeof prototype.join === 'function') {
            measure(prototype, 'finish', 'Weld.finish'); measure(prototype, 'join', 'Weld.join');
          } else if (typeof prototype.draw === 'function' && typeof prototype.add === 'function') {
            measure(prototype, 'draw', 'UnitParts.draw'); measure(prototype, 'add', 'UnitParts.add');
          } else if (typeof prototype.onUpdateProgram === 'function' && typeof prototype.setObject === 'function') {
            for (const name of ['build', 'setObject', 'beforeDraw', 'bindBlocks', 'bindDraw', 'onUpdateProgram', 'renderStart', 'updateLights']) measure(prototype, name, `Nodes.${name}`);
          } else if (typeof prototype.build === 'function' && typeof prototype.next === 'function') {
            measure(prototype, 'build', 'BuildStages.build');
          }
        }
      } catch (error) { moduleErrors.push({ module: resource.name, error: String(error) }); } })();
    }
  };
  W.addEventListener('ws:ready', prepareWorldCalls);
  // A road entry can load the node backend after the home world's ready event.
  // Observe only relevant module completions, so its first compile/draw is traced.
  if (typeof PerformanceObserver === 'function') {
    const observer = new PerformanceObserver(list => {
      if (list.getEntries().some(resource => /\/(?:assets|b\/[\w.-]+)\/(?:place|weld|plan|audio|hybrid)-[^/]+\.js$/u.test(resource.name))) prepareWorldCalls();
    });
    observer.observe({ entryTypes: ['resource'] });
  }
  const close = (at, end) => {
    if (open === null) return;
    const total = at - open.start;
    if (total >= minMs) {
      if (tasks.length < cap) tasks.push([round(open.start), round(open.sync), round(total), end, open.kind, siteId(open.site)]);
      else dropped++;
    }
    open = null; current = '';
  };
  const echo = new MessageChannel();
  // a late echo must not close the task that started after its own
  echo.port1.onmessage = (event) => { if (open !== null && open.id === event.data) close(now(), 'e'); };
  const enter = (kind, at) => { close(now(), 't'); open = { id: ++serial, start: now(), sync: 0, kind, site: at }; current = at; };
  const leave = () => { if (open === null) return; open.sync = now() - open.start; echo.port2.postMessage(open.id); };
  const wrap = (kind, fn, at) => function wrapped(...args) { enter(kind, at); try { return fn.apply(this, args); } finally { leave(); } };
  const timeout = Reflect.get(W, 'setTimeout');
  W.setTimeout = function setTimeout(fn, ms, ...rest) { return timeout.call(W, typeof fn === 'function' ? wrap('timeout', fn, site()) : fn, ms, ...rest); };
  const raf = Reflect.get(W, 'requestAnimationFrame');
  if (typeof raf === 'function') W.requestAnimationFrame = function requestAnimationFrame(fn) { return raf.call(W, wrap('raf', fn, site())); };
  const listeners = new WeakMap();
  const targetPrototype = EventTarget.prototype;
  const add = Reflect.get(targetPrototype, 'addEventListener'), remove = Reflect.get(targetPrototype, 'removeEventListener');
  const messageTarget = (target) => target instanceof MessagePort || (typeof Worker === 'function' && target instanceof Worker);
  targetPrototype.addEventListener = function addEventListener(type, listener, options) {
    if (type !== 'message' || typeof listener !== 'function' || !messageTarget(this) || this === echo.port1) { add.call(this, type, listener, options); return; }
    let wrapped = listeners.get(listener);
    if (wrapped === undefined) { wrapped = wrap('message', listener, site()); listeners.set(listener, wrapped); }
    add.call(this, type, wrapped, options);
  };
  targetPrototype.removeEventListener = function removeEventListener(type, listener, options) {
    remove.call(this, type, (typeof listener === 'function' ? listeners.get(listener) : undefined) ?? listener, options);
  };
  for (const proto of [MessagePort.prototype, ...(typeof Worker === 'function' ? [Worker.prototype] : [])]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    const read = descriptor === undefined ? undefined : Reflect.get(descriptor, 'get'), write = descriptor === undefined ? undefined : Reflect.get(descriptor, 'set');
    if (descriptor === undefined || typeof read !== 'function' || typeof write !== 'function') continue;
    Object.defineProperty(proto, 'onmessage', { configurable: true, enumerable: descriptor.enumerable,
      get: function get() { return read.call(this); },
      set: function set(fn) { write.call(this, typeof fn === 'function' && this !== echo.port1 ? wrap('message', fn, site()) : fn); } });
  }
  /** The tasks since the last take (the open one closed now) and the site table they index. */
  W.__frameFloorTaskTake = () => {
    prepareWorldCalls();
    close(now(), 'e');
    const out = { minMs, columns: ['startMs', 'syncMs', 'totalMs', 'end', 'kind', 'site'], dropped, tasks, sites,
      callColumns: ['startMs', 'syncMs', 'operation', 'stack', 'compiled'], calls, modules: [...moduleCalls], moduleErrors: [...moduleErrors],
      memoryWarning: { chip: document.querySelector('.ws-memory-warning-chip')?.textContent ?? null,
        reports: [...document.querySelectorAll('.ws-memory-warning-report')].map(element => ({ owner: element.dataset.owner, text: element.textContent })) },
      groupColumns: ['startMs', 'syncMs', 'operation', 'children: [operation, calls, syncMs, maxMs]'], groups };
    tasks = []; sites = []; siteIds = new Map(); calls = []; groups = []; dropped = 0;
    return out;
  };
}

export const TASK_CLOCK_SCRIPT = `(${installTaskClock.toString()})();`;
