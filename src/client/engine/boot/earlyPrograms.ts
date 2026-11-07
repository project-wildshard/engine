import type { Scope } from '../../../shared/engine/app/scope';
import type { Game } from '../core/Game';
import { jsonSlot } from '../saves/slots';

/** DL10 (11-04): Debug ▸ Loading & memory ▸ Early shader compile. 'on' links the level's recorded entry programs from the
 *  renderer step on (issueBakedPrograms) and warms the shader compiler on the title (warmShaderCompiler), so WebKit's GPU
 *  process has them compiled before the Shaders step asks. Default ON since the throttled Simulator pair (11-04, 4a7a88b,
 *  10 Mb/s + 100 ms, off -> on): cold tap -> control Nine 47.3 -> 40.7 s, Driftwood 36.0 -> 27.0 s; the row stays as the
 *  off switch until Jake's iPhone confirms it (a rendering change waits for a physical-device reading).
 *  The pass that issued the spawn view's programs at the end of the world build is gone (sp-o1, 11-04): it compiled
 *  before the level's point lights were placed, so lit programs came out with the wrong light count (Driftwood's
 *  ground: 0 point lights instead of 3, links the level never draws, ~0.55 s each on the Simulator), and the baked list
 *  already warms every program the entry draws. A reload row: the first read of a page is its value. */
export const EARLY_PROGRAMS_SLOT = 'debug.earlyPrograms';
let frozen: boolean | undefined;
export function earlyProgramsOn(): boolean {
  frozen ??= jsonSlot(EARLY_PROGRAMS_SLOT, 'device').read() !== 'off';
  return frozen;
}

let baked: Promise<BakedPrograms | null> | null = null;

/** DL10 (same Debug row): the GLSL pairs a recorded entry of this level linked, as data from the level's files. WebKit's GPU
 *  process keeps what it compiled by source (Playwright WebKit: 70 entry programs link in 225 ms the first time, 128 ms
 *  on any repeat, in the same or a new context or page), so linking the exact sources from the renderer step on lets the
 *  Shaders step's own links find them compiled, while the download and the world build still run. A program the build
 *  no longer makes only costs its link. */
/** Shaders share most of their lines (three's chunks), so each shader is a list of indices into one line table (Nine:
 *  3.9 MB of sources in 1.6 MB); a program is a [vertex, fragment] pair of shader indices. */
export interface BakedPrograms {
  readonly version: 2; readonly lines: readonly string[]; readonly shaders: readonly (readonly number[])[];
  readonly programs: readonly (readonly [number, number])[];
}
interface Held { readonly gl: WebGL2RenderingContext; readonly programs: WebGLProgram[]; readonly shaders: WebGLShader[]; released: boolean }
let held: Held | null = null;
/** The game queues the level's list (fetched in parallel) before the renderer exists; `null` = none for this level. */
export function queueBakedPrograms(list: Promise<BakedPrograms | null>): void {
  // an optional list: a failed read (offline, an HTML fallback page) is no list, settled here at once, so it never reaches
  // the page's unhandled-rejection boot failure before the renderer step would have read it (sp-x8's C25)
  baked = list.catch(() => null);
}
/** After the renderer step: link the queued list on the game's own context. Where links queue in the GPU process ahead
 *  of the page's own GL calls (WebKit), the next program is issued only once the last one reports complete
 *  (KHR_parallel_shader_compile's COMPLETION_STATUS, polled once a painted frame; a 600 ms beat without the extension):
 *  one a painted frame issued faster than the Simulator links (~0.5 s each), and Driftwood's next synchronous GL call in
 *  the Sky step waited 15 s behind the queue (throttled Sim pair, 11-04). Elsewhere all at once. The pass runs to the end
 *  of its list: the Shaders step no longer stops it, because the list's tail is the programs the spawn view's tiles
 *  build after Shaders (Nine's step 27: one parked warm's first program build held the card 0.9 s, `47932d1`), and with
 *  one link in flight it costs the Shaders step at most one link. A paced pass releases itself once its last link has
 *  completed; otherwise the objects are kept until its level goes, so no link is cut short. */
export function issueBakedPrograms(game: Pick<Game, 'levelScope'> & { readonly renderer: { readonly getContext: () => unknown } }): void {
  const list = baked; baked = null;
  if (list === null) return;
  const owner = game.levelScope, gl = game.renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) return;
  const mine: Held = { gl, programs: [], shaders: [], released: false };
  held = mine;
  // each pass releases only itself: a road journey's old level must not delete the next level's pass (CI, fa1da6a58c)
  owner.onDispose(() => { release(mine); });
  void (async () => {
    const data = await list;
    if (data === null || data.version !== 2) return;
    const { queuedLinks } = await import('../render/precompile');
    const paced = queuedLinks(), parallel = gl.getExtension('KHR_parallel_shader_compile');
    const frame = (): Promise<void> => new Promise<void>(resolve => { owner.raf(() => { resolve(); }); });
    // a disposed scope cancels its frame or timer: the pass simply stops there
    const settled = async (program: WebGLProgram): Promise<void> => {
      if (parallel === null) { await new Promise<void>(resolve => { owner.timeout(600, resolve); }); return; }
      // a released pass's programs are deleted: never ask about them (a deleted object only warns, and never completes)
      const waiting = (): boolean => !mine.released && !gl.isContextLost() && gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR) !== true;
      while (waiting()) await frame();
    };
    const compiled = new Map<number, WebGLShader>();
    const shader = (at: number, type: number): WebGLShader | null => {
      const known = compiled.get(at); if (known !== undefined) return known;
      const rows = data.shaders[at], source = rows?.map(line => data.lines[line] ?? '').join('\n'), made = source === undefined ? null : gl.createShader(type);
      if (made === null || source === undefined) return null;
      gl.shaderSource(made, source); gl.compileShader(made); compiled.set(at, made); mine.shaders.push(made);
      return made;
    };
    for (const [vertex, fragment] of data.programs) {
      if (mine.released || owner.disposed || owner.disposing || held !== mine || gl.isContextLost()) return;
      const vs = shader(vertex, gl.VERTEX_SHADER), fs = shader(fragment, gl.FRAGMENT_SHADER), program = gl.createProgram();
      if (vs === null || fs === null) continue;
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); mine.programs.push(program);
      if (paced) await settled(program);
    }
    // every link has completed: the GPU process holds the compiled sources, the copies can go
    if (paced) release(mine);
  })();
}
/** DL10 (same Debug row): a cold Safari's first shader link pays a one-time start-up (1.0-1.4 s on the Simulator, whatever
 *  the program; the Sim link probe, 11-04), which the GPU process keeps for later contexts and pages. On the title, after
 *  its first frames are drawn, one trivial program links on a throwaway context, so a cold entry finds the compiler up.
 *  The context is released at once. Off, nothing runs. */
export function warmShaderCompiler(scope: Pick<Scope, 'raf' | 'timeout'>): void {
  if (!earlyProgramsOn()) return;
  // after two painted frames and a beat: the title's own first frame never waits for it
  scope.raf(() => { scope.raf(() => { scope.timeout(250, () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return;
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }'],
      [gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;\nout vec4 colour;\nvoid main() { colour = vec4(1.0); }']] as const) {
      const shader = gl.createShader(type);
      if (shader === null) return;
      gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader);
    }
    gl.linkProgram(program); // not read back: the GPU process links it on its own time
    scope.timeout(2000, () => { gl.getExtension('WEBGL_lose_context')?.loseContext(); });
  }); }); });
}

/** The Shaders step has linked the level's own programs: the baked copies go. */
export function releaseBakedPrograms(): void { if (held !== null) release(held); }
function release(pass: Held): void {
  if (pass.released) return;
  pass.released = true;
  if (held === pass) held = null;
  if (pass.gl.isContextLost()) return;
  for (const program of pass.programs) pass.gl.deleteProgram(program);
  for (const shader of pass.shaders) pass.gl.deleteShader(shader);
}
