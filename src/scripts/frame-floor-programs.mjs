/** Opt-in floor diagnostic: name a program from the shader sources already submitted by the game.
 * No GL queries, retained shader text or additional compile/link calls. Weak identities leave with their GL objects. */
function installProgramNames() {
  if (typeof Reflect.get(window, '__frameFloorProgramName') === 'function') return;
  const shaders = new WeakMap(), programs = new WeakMap();
  const name = source => {
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ (source.codePointAt(i) ?? 0), 16777619);
    const title = /^[\t ]*#define SHADER_NAME[\t ]+([^\r\n]+)/mu.exec(source)?.[1]?.trim() ?? '';
    const type = /^[\t ]*#define SHADER_TYPE[\t ]+([^\r\n]+)/mu.exec(source)?.[1]?.trim() ?? 'unnamed';
    // D12: the source length too, so a slow link wait reads against its program's size
    return `${title.length > 0 ? title : type}/${(hash >>> 0).toString(16)}#${source.length}`;
  };
  window.__frameFloorProgramName = program => programs.get(program)?.join('+') ?? 'unobserved';
  for (const Context of [Reflect.get(window, 'WebGLRenderingContext'), Reflect.get(window, 'WebGL2RenderingContext')]) {
    if (typeof Context !== 'function') continue;
    const prototype = Context.prototype;
    for (const method of ['shaderSource', 'attachShader']) {
      const original = prototype[method];
      if (typeof original !== 'function' || original.__floorProgramNames === true) continue;
      const wrapped = function wrapped(...args) {
        const result = original.apply(this, args);
        const object = args[0] !== null && typeof args[0] === 'object';
        if (method === 'shaderSource' && object && typeof args[1] === 'string') shaders.set(args[0], name(args[1]));
        else if (method === 'attachShader' && object) {
          let sources = programs.get(args[0]);
          if (sources === undefined) { sources = []; programs.set(args[0], sources); }
          sources.push(shaders.get(args[1]) ?? 'unobserved');
        }
        return result;
      };
      wrapped.__floorProgramNames = true;
      prototype[method] = wrapped;
    }
  }
}

/** Browser initializer used only with --gl-time; source fingerprints distinguish material variants with the same name. */
export const PROGRAM_NAMES_SCRIPT = `(${installProgramNames.toString()})();`;
