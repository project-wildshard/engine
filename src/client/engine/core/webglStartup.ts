/** Wait for WebKit's graphics context to be usable before Three reads its capabilities. */
import type { Scope } from '../../../shared/engine/app/scope';
import { pageScope } from '../../../shared/engine/app/resources';

export const GAME_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  // E257: on the physical iPhone, even an empty 16px canvas immediately loses a
  // high-performance context after the crash; default and low-power remain usable.
  // Let the browser select its graphics device instead of forcing the failing path.
  alpha: true, antialias: false, powerPreference: 'default', stencil: false,
  depth: true, premultipliedAlpha: true, preserveDrawingBuffer: false,
};

export interface ContextStartupState { attempt: number; elapsedMs: number; contextLost: boolean; precisionReady: boolean; contextCreated: boolean }

export async function readyWebGLContext(
  canvas: HTMLCanvasElement,
  waiting: (state: ContextStartupState) => void = () => undefined,
  owner: Scope = pageScope,
): Promise<WebGL2RenderingContext> {
  if (owner.disposed || owner.disposing) throw new Error('Graphics startup owner left');
  // This must precede getContext(): loss can happen during context creation itself.
  // Without preventDefault the browser is not permitted to restore that context.
  const allowRestore = (event: Event): void => { event.preventDefault(); };
  const scope = owner.child('webgl-startup');
  scope.listen(canvas, 'webglcontextlost', allowRestore);
  const start = performance.now();
  let attempt = 0;
  try {
    for (;;) {
      if (scope.disposed || scope.disposing) throw new Error('Graphics startup owner left');
      const gl = canvas.getContext('webgl2', GAME_CONTEXT_ATTRIBUTES);
      const contextLost = gl?.isContextLost() ?? false;
      // A non-null getContext result is insufficient: lost contexts return null for precision.
      // Three dereferences these objects in its constructor before installing game recovery.
      const precisionReady = gl !== null && !contextLost &&
        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].every((shader) =>
          [gl.HIGH_FLOAT, gl.MEDIUM_FLOAT, gl.LOW_FLOAT].every((precision) =>
            gl.getShaderPrecisionFormat(shader, precision) !== null));
      if (gl !== null && precisionReady && !gl.isContextLost()) return gl;
      const state = { attempt: ++attempt, elapsedMs: Math.round(performance.now() - start), contextLost, precisionReady, contextCreated: gl !== null };
      waiting(state);
      // Yield for GPU-process restart / webglcontextrestored instead of reloading the document.
      // This interval paces capability queries; it never grants or refuses readiness.
      await new Promise<void>((resolve, reject) => {
        const forget = scope.capture('disposers', () => { reject(new Error('Graphics startup owner left')); });
        scope.timeout(250, () => { forget(); resolve(); });
      });
    }
  } finally { scope.dispose(); }
}
