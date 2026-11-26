import {expect, test, vi} from 'vitest';
import {observeProgramLinks,recordProgramSources,workloadCounts} from '../scripts/fps/workload.mjs';

test('count real links even when program totals stay level, preserving the GL call and restoring it', () => {
  const original = vi.fn(), gl = {linkProgram:original}, probe = observeProgramLinks(gl);
  const program = {};
  gl.linkProgram(program); gl.linkProgram(program);
  expect(probe.count()).toBe(2);
  expect(original.mock.contexts).toEqual([gl,gl]);
  expect(original.mock.calls).toEqual([[program],[program]]);
  probe.stop();
  expect(gl.linkProgram).toBe(original);
  gl.linkProgram(program);
  expect(probe.count()).toBe(2);
});

test('the worst segment survives a long quiet leg and a warm capture', () => {
  const leg = (draws, links) => ({programLinksAfterControl:links,
    samples:draws.map(n => ({draws:n,triangles:n*1000,programs:100}))});
  const quiet = leg(Array.from({length:1000}, () => 10),0);
  const busy = leg([80,80,80,80,100],7);
  const warm = leg([90,90,90,90,110],2);
  expect(workloadCounts([{legs:[quiet,busy]},{legs:[warm]}])).toEqual({
    trianglesP95:90000,drawsP95:90,programsMax:100,linksAfterControl:7,
  });
});

test('an older capture without a link probe stays unknown', () => {
  expect(workloadCounts([null,{legs:[{samples:[{triangles:42,draws:2,programs:null}]}]}]))
    .toEqual({trianglesP95:42,drawsP95:2,programsMax:null,linksAfterControl:null});
  expect(workloadCounts([]).linksAfterControl).toBeNull();
});

test('DF5: after control only links of shader sources never linked before count as new', () => {
  const linked = [];
  class Context {
    getAttachedShaders(program) { return program.shaders; }
    getShaderSource(shader) { return shader; }
    linkProgram(program) { linked.push(program); }
  }
  const sources = recordProgramSources([Context]), gl = new Context();
  const lit = { shaders: ['vs-lit', 'fs-lit'] }, batch = { shaders: ['vs-batch', 'fs-lit'] };
  gl.linkProgram(lit);
  sources.control();
  gl.linkProgram({ shaders: ['vs-lit', 'fs-lit'] });
  gl.linkProgram(batch); gl.linkProgram(batch);
  expect(sources.fresh()).toBe(1);
  expect(linked).toHaveLength(4);
});
