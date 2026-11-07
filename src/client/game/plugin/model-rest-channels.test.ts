import { afterEach, expect, it, vi } from 'vitest';
import { BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createModelLibrary, type ModelGeometryPool } from './geometry';

afterEach(() => { vi.restoreAllMocks(); });
const empty = {meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 1};
function primitive(name: string): Mesh {
  const geometry = new PlaneGeometry(1, 2); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, new MeshStandardMaterial()); mesh.name = name;
  mesh.userData['restGroups'] = []; mesh.userData['restBox'] = [-0.5,-1,0,0.5,1,0]; mesh.userData['restSphere'] = [0,0,0,Math.sqrt(1.25)];
  return mesh;
}
it('borrows exact declared channels with a strict per-part subset and no vertex copy', async () => {
  const a = primitive('a'), b = primitive('b'), scene = new Group(); scene.add(a,b);
  const wind = new BufferAttribute(new Float32Array([0,-0,0.5,1]),1), bark = new BufferAttribute(new Float32Array([0,1,2,3]),1);
  a.geometry.setAttribute('_wind',wind); b.geometry.setAttribute('_wind',wind); a.geometry.setAttribute('_bark',bark);
  const library = createModelLibrary<never,never>({...empty,geometryPools:[{url:'pool',parts:['a','b'],channels:[
    {name:'aWind',source:'_wind',width:1},{name:'aBark',source:'_bark',width:1,parts:['a']},
  ]}]},'test',{},()=>Promise.resolve({scene}));
  await library.preload();
  expect(library.geometry('a',{borrow:true})?.getAttribute('aWind')).toBe(wind);
  expect(library.geometry('a',{borrow:true})?.getAttribute('aBark')).toBe(bark);
  expect(library.geometry('b',{borrow:true})?.hasAttribute('aBark')).toBe(false);
  expect(library.geometry('a',{borrow:true})?.hasAttribute('_wind')).toBe(false);
  expect(Object.is(wind.getX(1),-0)).toBe(true);
});
it('refuses malformed declarations, missing channels and undeclared extra attributes', async () => {
  const pool:ModelGeometryPool={url:'pool',parts:['a'],channels:[{name:'aWind',source:'_wind',width:1}]};
  for(const channels of [[{name:'aWind',source:'_wind',width:5}],[{name:'position',source:'_wind',width:1}],[{name:'aWind',source:'_wind',width:1,parts:['missing']}],[{name:'aWind',source:'__proto__',width:1}]]) {
    expect(()=>createModelLibrary<never,never>({...empty,geometryPools:[{...pool,channels}]},'test')).toThrow();
  }
  const error=vi.spyOn(console,'error').mockImplementation(()=>undefined);
  for(const extra of [false,true]){
    const mesh=primitive('a'),scene=new Group();scene.add(mesh);
    if(extra){mesh.geometry.setAttribute('_wind',new BufferAttribute(new Float32Array(4),1));mesh.geometry.setAttribute('_unlisted',new BufferAttribute(new Float32Array(4),1));}
    const library=createModelLibrary<never,never>({...empty,geometryPools:[pool]},'test',{},()=>Promise.resolve({scene}));
    await library.preload();expect(library.geometry('a')).toBeNull();
  }
  expect(error).toHaveBeenCalledTimes(2);
});

it.each(['position', 'normal', 'uv', '_wind'])('refuses nonfinite %s values before publishing any part', async channel => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const value of [Number.NaN, Infinity, -Infinity]) for (const end of [false, true]) {
    const first = primitive('a'), second = primitive('b'), scene = new Group(); scene.add(first, second);
    if (channel === '_wind') second.geometry.setAttribute(channel, new BufferAttribute(new Float32Array(4), 1));
    const attribute = second.geometry.getAttribute(channel);
    attribute.array[end ? attribute.array.length - 1 : 0] = value;
    const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a', 'b'],
      ...(channel === '_wind' ? { channels: [{ name: 'wind', source: '_wind', width: 1, parts: ['b'] }] } : {}),
    }] }, 'test', {}, () => Promise.resolve({ scene }));
    await library.preload();
    expect(library.geometry('a')).toBeNull(); expect(library.geometry('b')).toBeNull();
    first.geometry.dispose(); second.geometry.dispose();
  }
  expect(error).toHaveBeenCalledTimes(6);
});

it('retains one custom scan lookup, its receiver and first-invalid short circuit', async () => {
  const mesh = primitive('a'), scene = new Group(); scene.add(mesh);
  const values = new Float32Array([1, -0, Number.NaN, Infinity]);
  mesh.geometry.setAttribute('_wind', new BufferAttribute(values, 1));
  const seen: number[] = [], events: string[] = [];
  function scan(this: Float32Array, predicate: (value: number, index: number, array: Float32Array) => unknown): boolean {
    expect(this).toBe(values); events.push('call');
    return Float32Array.prototype.some.call(this, (value, index, array) => { seen.push(index); return predicate(value, index, array); });
  }
  Object.defineProperty(scan, 'call', { value: () => { throw new Error('Custom call must not run'); } });
  Object.defineProperty(values, 'some', { get: () => { events.push('get'); return scan; } });
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a'],
    channels: [{ name: 'wind', source: '_wind', width: 1 }],
  }] }, 'test', {}, () => Promise.resolve({ scene }));
  await library.preload();
  expect(events).toEqual(['get', 'call']); expect(seen).toEqual([0, 1, 2]);
  expect(error).toHaveBeenCalledTimes(1); expect(library.geometry('a')).toBeNull();
  mesh.geometry.dispose();
});

it('does not trust a shadowed typed-array length during validation', async () => {
  const mesh = primitive('a'), scene = new Group(); scene.add(mesh);
  const values = new Float32Array([0, 0, 0, Number.NaN]);
  mesh.geometry.setAttribute('_wind', new BufferAttribute(values, 1));
  Object.defineProperty(values, 'length', { value: 0 });
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a'],
    channels: [{ name: 'wind', source: '_wind', width: 1 }],
  }] }, 'test', {}, () => Promise.resolve({ scene }));
  await library.preload();
  expect(error).toHaveBeenCalledTimes(1); expect(library.geometry('a')).toBeNull();
  mesh.geometry.dispose();
});

it('retains the native internal length for an array with a custom prototype', async () => {
  const mesh = primitive('a'), scene = new Group(); scene.add(mesh);
  const values = new Float32Array([0, 0, 0, Number.NaN]);
  mesh.geometry.setAttribute('_wind', new BufferAttribute(values, 1));
  const length = vi.fn(() => 0);
  const prototype = {}; Object.setPrototypeOf(prototype, Float32Array.prototype);
  Object.defineProperty(prototype, 'length', { get: length }); Object.setPrototypeOf(values, prototype);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a'],
    channels: [{ name: 'wind', source: '_wind', width: 1 }],
  }] }, 'test', {}, () => Promise.resolve({ scene }));
  await library.preload();
  expect(error).toHaveBeenCalledTimes(1); expect(library.geometry('a')).toBeNull();
  expect(length).not.toHaveBeenCalled(); mesh.geometry.dispose();
});

it.each(['detached', 'out-of-bounds'])('refuses a %s channel whose attribute count is still nonzero', async mode => {
  const mesh = primitive('a'), scene = new Group(); scene.add(mesh);
  const storage: unknown = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 16 }]);
  if (!(storage instanceof ArrayBuffer)) throw new Error('Expected native fixture storage');
  const buffer = storage, values = new Float32Array(buffer, 0, 4);
  mesh.geometry.setAttribute('_wind', new BufferAttribute(values, 1));
  if (mode === 'detached') structuredClone(buffer, { transfer: [buffer] });
  else {
    const resize: unknown = Reflect.get(buffer, 'resize');
    if (typeof resize !== 'function') throw new Error('Expected native resizable fixture storage');
    Reflect.apply(resize, buffer, [0]);
  }
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a'],
    channels: [{ name: 'wind', source: '_wind', width: 1 }],
  }] }, 'test', {}, () => Promise.resolve({ scene }));
  await library.preload();
  expect(error).toHaveBeenCalledTimes(1); expect(library.geometry('a')).toBeNull();
  mesh.geometry.dispose();
});
