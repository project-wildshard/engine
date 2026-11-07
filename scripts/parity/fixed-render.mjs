/** A fixed M3 world render, with no composer or camera-child viewmodel.
 * Keep the native posed camera: its view already selected the live instances.
 * Runs in the native page; every temporary clock/visibility change is restored.
 * Opting into includeViewmodel retains and verifies actual camera-child draws.
 * @param {{yaw:number,pitch:number,includeViewmodel?:boolean}} pose */
export function fixedWorldFrame(pose) {
  const w = window.__wildshard.requireWorld(), g = w.game, r = g.renderer;
  const gl = r.getContext(), scene = g.rootScene, cam = g.camera;
  if (!w.hud.entered || w.hud.paused || document.querySelector('.ws-load')) throw new Error('World capture requires native control');
  const cameraState = {position:cam.position.clone(),quaternion:cam.quaternion.clone(),up:cam.up.clone()};
  const at = w.player.position;
  cam.updateMatrixWorld(true);
  const elapsed = g.clock.elapsedTime, target = r.getRenderTarget(), scissor = r.getScissorTest();
  const hidden = pose.includeViewmodel === true ? [] : cam.children.filter(child => child.visible);
  let viewmodelDraws = 0;
  const dither = gl.isEnabled(gl.DITHER);
  /** @type {(()=>void)[]} */
  const restore = [];
  /** @type {string[]} */
  const pinned = [];
  const seen = new Set();
  // Capture command submission is serial; this is an image proof, never a frame-cost reading.
  // oxlint-disable-next-line typescript/unbound-method -- Preserve and restore the exact renderer method identity.
  const direct = r.renderBufferDirect;
  r.renderBufferDirect = (...args) => {
    Reflect.apply(direct, r, args); gl.finish();
    if (pose.includeViewmodel === true) {
      /** @type {import('three').Object3D|null} */
      let node = args[4];
      while (node !== null) { if (node === cam) { viewmodelDraws++; break; } node = node.parent; }
    }
  };
  try {
    gl.disable(gl.DITHER);
    g.clock.elapsedTime = 10; g.shardFrame();
    for (const child of hidden) child.visible = false;
    scene.traverse(object => {
      const material = Reflect.get(object, 'material');
      for (const item of Array.isArray(material) ? material : [material]) {
        if (typeof item !== 'object' || item === null) continue;
        const properties = r.properties.get(item);
        const cached = typeof properties === 'object' && properties !== null ? Reflect.get(properties, 'uniforms') : undefined;
        for (const uniforms of [Reflect.get(item, 'uniforms'), cached]) {
          if (typeof uniforms !== 'object' || uniforms === null) continue;
          for (const [key, uniform] of Object.entries(uniforms)) {
            if (!/(?:time|clock)$|^uPulse$/i.test(key) || typeof uniform !== 'object' || uniform === null || seen.has(uniform)) continue;
            const value = Reflect.get(uniform, 'value');
            if (typeof value !== 'number') continue;
            const descriptor = Object.getOwnPropertyDescriptor(uniform, 'value');
            if (descriptor?.configurable === false) throw new Error(`Unpinnable render clock ${key}`);
            seen.add(uniform); pinned.push(key);
            Object.defineProperty(uniform, 'value', { configurable: true, enumerable: descriptor?.enumerable ?? true, get: () => key === 'uPulse' ? 1 : 10, set: () => { /* Hold the render clock through onBeforeRender. */ } });
            restore.push(() => { if (descriptor === undefined) Reflect.deleteProperty(uniform, 'value'); else Object.defineProperty(uniform, 'value', descriptor); });
          }
        }
      }
    });
    r.setRenderTarget(null); r.setScissorTest(false);
    const ratio = r.getPixelRatio(); r.setViewport(0, 0, gl.drawingBufferWidth / ratio, gl.drawingBufferHeight / ratio);
    r.clear(true, true, true); r.render(scene, cam);
    r.info.reset(); viewmodelDraws = 0; r.clear(true, true, true); r.render(scene, cam);
    const calls = r.info.render.calls, triangles = r.info.render.triangles;
    const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.getError() !== gl.NO_ERROR || calls <= 0 || triangles <= 0 || gl.isContextLost()) throw new Error('Invalid native world readback');
    if (pose.includeViewmodel === true && viewmodelDraws === 0) throw new Error('Missing native viewmodel draws');
    return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, data, calls, triangles, pinned: pinned.sort(), at: at.toArray(), frame: g.frameCount, clock: g.app.clock.snapshot(),
      requested: {yaw:pose.yaw,pitch:pose.pitch}, viewmodel: {included:pose.includeViewmodel === true,draws:viewmodelDraws},
      camera: {world:cam.matrixWorld.toArray(),projection:cam.projectionMatrix.toArray()} };
  } finally {
    r.renderBufferDirect = direct;
    if (dither) gl.enable(gl.DITHER); else gl.disable(gl.DITHER);
    for (const undo of restore.reverse()) undo();
    for (const child of hidden) child.visible = true;
    g.clock.elapsedTime = elapsed;
    cam.position.copy(cameraState.position); cam.quaternion.copy(cameraState.quaternion); cam.up.copy(cameraState.up);
    g.shardFrame(); r.setRenderTarget(target); r.setScissorTest(scissor);
  }
}
