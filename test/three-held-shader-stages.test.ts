// DF8 (meta DRIFTWOOD-FPS, mini-df8): the client build's three transform lets a live custom program hold its shader stages,
// so the same source compiled again while that program lives keys the same program (vite/threeHeldShaderStages.ts).
import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the installed three build the client transform rewrites.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed three build.
import { createRequire } from 'node:module';
import { HELD_STAGE_EDITS, heldShaderStages } from '../vite/threeHeldShaderStages';
import { programReuse as slotValue, PROGRAM_REUSE_DEFAULT } from '../src/client/engine/render/programReuse';

const build = createRequire(import.meta.url).resolve('three').replace(/three\.(?:cjs|module\.js)$/u, 'three.module.js');
const source = readFileSync(build, 'utf8');

interface Stage { readonly id: number; readonly code: string; usedTimes: number }
interface Cache {
  shaderCache: Map<string, Stage>;
  getVertexShaderStage: (material: object) => Stage; getFragmentShaderStage: (material: object) => Stage;
  update: (material: object, vertex: Stage, fragment: Stage) => void; remove: (material: object) => void;
  holdProgram: (program: object, vertexId: number, fragmentId: number) => void; releaseProgram: (program: object) => void;
}

/** three's shader cache classes, from the transformed build's text (its `_id` counter and both classes). */
function shaderCacheClass(code: string): new () => Cache {
  const start = code.indexOf('let _id = 0;'), end = code.indexOf('function isPackedRGFormat', start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the class text under test is three's own, transformed
  return new Function(`${code.slice(start, end)}\nreturn WebGLShaderCache;`)() as new () => Cache;
}

/** A material as three registers one: getParameters reads both stages and updates the cache. */
function register(cache: Cache, material: { vertexShader: string; fragmentShader: string }): [number, number] {
  const vertex = cache.getVertexShaderStage(material), fragment = cache.getFragmentShaderStage(material);
  cache.update(material, vertex, fragment);
  return [vertex.id, fragment.id];
}

test('DF8: a held program keeps its stage ids for the same source; unheld, three mints new ones', () => {
  const patched = heldShaderStages(source, build);
  expect(patched).not.toBeNull();
  const WebGLShaderCache = shaderCacheClass(patched ?? '');
  const code = { vertexShader: 'void main() { gl_Position = vec4(0.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' };

  const held = new WebGLShaderCache(), program = {};
  const first = register(held, { ...code });
  const firstMaterial = [...(Reflect.get(held, 'materialCache') as Map<object, unknown>).keys()][0] ?? {};
  held.holdProgram(program, first[0], first[1]);
  held.remove(firstMaterial);
  expect(held.shaderCache.size).toBe(2);
  const again = register(held, { ...code });
  expect(again).toEqual(first);
  // the program goes, the material goes: nothing holds the source, so the stages go too
  held.releaseProgram(program);
  held.remove([...(Reflect.get(held, 'materialCache') as Map<object, unknown>).keys()][0] ?? {});
  expect(held.shaderCache.size).toBe(0);

  const stock = new WebGLShaderCache();
  const one = { ...code }, ids = register(stock, one);
  stock.remove(one);
  expect(register(stock, { ...code })).not.toEqual(ids);
});

test('DF8: a released program that held nothing changes nothing', () => {
  const WebGLShaderCache = shaderCacheClass(heldShaderStages(source, build) ?? '');
  const cache = new WebGLShaderCache(), material = { vertexShader: 'a', fragmentShader: 'b' };
  register(cache, material);
  cache.releaseProgram({});
  expect([...cache.shaderCache.values()].map(stage => stage.usedTimes)).toEqual([1, 1]);
});

test('DF8: the transform edits each anchor once, only three\'s build, and refuses a moved anchor', () => {
  const patched = heldShaderStages(source, build) ?? '';
  for (const [, replacement] of HELD_STAGE_EDITS) expect(patched).toContain(replacement);
  expect(patched).toContain('renderer.wsHeldShaderStages === true');
  expect(heldShaderStages(source, '/x/node_modules/three/build/three.core.js')).toBeNull();
  const [anchor] = HELD_STAGE_EDITS[0] ?? [''];
  expect(() => heldShaderStages(source.replace(anchor, ''), build)).toThrow(/shader cache changed/u);
});

test('DF8: the device slot is off unless it says on', () => {
  expect(PROGRAM_REUSE_DEFAULT).toBe(false);
  expect(slotValue(undefined)).toBe(false);
  expect(slotValue(null)).toBe(false);
  expect(slotValue(true)).toBe(true);
  expect(slotValue('on')).toBe(true);
  expect(slotValue(false)).toBe(false);
});
