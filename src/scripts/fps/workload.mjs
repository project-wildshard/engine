/** Count actual links after control, including an unmeasured approach.
 * Serialized into the page; keep it independent of module scope.
 * @param {Pick<WebGL2RenderingContext,'linkProgram'>} gl */
export function observeProgramLinks(gl) {
  const original = gl.linkProgram;
  let links = 0;
  gl.linkProgram = function linkProgram(program) {
    links++;
    original.call(this, program);
  };
  return {count:() => links, stop:() => { gl.linkProgram = original; }};
}

/** DF5 (J489): count the links after control whose shader sources no link before control used. The iPhone's GPU process
 * keeps what it compiled by source (the baked list warms the level's programs under the loading card), so a relink of a
 * known source is cheap there, and a new source compiles in the frame: 1.1 to 1.4 s frames on the iPhone 13 (DF10's batch
 * programs). Chromium links both fast, so the stand-in counts the new ones. Installed at document start on the WebGL
 * prototypes; serialized into the page, so it keeps to its own scope.
 * @param {{prototype:{linkProgram:(program:WebGLProgram)=>void}}[]} contexts */
export function recordProgramSources(contexts) {
  const seen = new Set();
  let controlled = false, fresh = 0;
  for (const context of contexts) {
    const original = context.prototype.linkProgram;
    /** @this {WebGL2RenderingContext} @param {WebGLProgram} program */
    context.prototype.linkProgram = function linkProgram(program) {
      try {
        const key = (this.getAttachedShaders(program) ?? []).map(shader => this.getShaderSource(shader) ?? '').join('\n---\n');
        if (!seen.has(key)) { seen.add(key); if (controlled) fresh++; }
      } catch { /* a lost context: count nothing */ }
      original.call(this, program);
    };
  }
  return { control: () => { controlled = true; }, fresh: () => fresh };
}

/** @typedef {{triangles?:number,draws?:number,programs?:number|null}} Sample */
/** @typedef {{programLinksAfterControl?:number,samples?:Sample[]}} Leg */
/** @param {(number|null|undefined)[]} values @param {number} percentile */
function quantile(values, percentile) {
  const sorted = /** @type {number[]} */ (values.filter(value =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0)).sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * percentile)] ?? null;
}

/** Worst segment counts over all supplied cold and warm captures.
 * A missing link probe stays unknown instead of becoming zero.
 * @param {({legs?:Leg[]}|null)[]} captures */
export function workloadCounts(captures) {
  const legs = captures.flatMap(capture => capture?.legs ?? []);
  const p95 = (/** @type {'triangles'|'draws'} */ field) => quantile(legs.map(leg =>
    quantile((leg.samples ?? []).map(sample => sample[field]), 0.95)), 1);
  return {trianglesP95:p95('triangles'),drawsP95:p95('draws'),
    programsMax:quantile(legs.flatMap(leg => (leg.samples ?? []).map(sample => sample.programs)), 1),
    linksAfterControl:legs.length > 0 && legs.every(leg => typeof leg.programLinksAfterControl === 'number')
      ? quantile(legs.map(leg => leg.programLinksAfterControl), 1) : null};
}
