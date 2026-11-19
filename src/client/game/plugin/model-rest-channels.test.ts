import { afterEach, expect, it, vi } from 'vitest';
import { BufferAttribute, Group, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
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

it('keeps a private draw packed and returns the exact legacy CPU copy', async () => {
  const load = async (keepGrid: boolean) => {
    const mesh = primitive('a'), scene = new Group();
    mesh.position.set(12, 2, -3); mesh.scale.setScalar(2);
    mesh.geometry.setAttribute('position', new BufferAttribute(new Int16Array([
      -32767, 32767, 0, 16384, 32767, 0, -32767, -32767, 0, 16384, -32767, 0,
    ]), 3, true));
    mesh.geometry.setAttribute('color', new BufferAttribute(new Uint8Array([
      100, 45, 200, 255, 8, 15, 0, 42, 128, 16, 145, 1,
    ]), 3, true));
    mesh.geometry.setAttribute('uv', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array([
      0, 1, 99, 1, 1, 99, 0, 0, 99, 1, 0, 99,
    ]), 3), 2, 0));
    scene.add(mesh);
    const library = createModelLibrary<never, never>({ ...empty, geometryPools: [
      { url: 'pool', parts: ['a'], keepGrid },
    ] }, 'test', {}, () => Promise.resolve({ scene }));
    await library.preload();
    return library;
  };
  const legacy = (await load(false)).geometry('a');
  const library = await load(true), cpu = library.geometry('a'), draw = library.draw?.('a');
  if (legacy === null || cpu === null || draw === undefined) throw new Error('Missing rest pool geometry');
  expect(draw.position.array).toBeInstanceOf(Int16Array);
  expect(draw.geometry.getAttribute('color').array).toBeInstanceOf(Uint8Array);
  expect(draw.geometry.boundingBox).toEqual(legacy.boundingBox);
  expect(draw.geometry.boundingSphere).toEqual(legacy.boundingSphere);
  for (const name of Object.keys(legacy.attributes)) {
    expect(cpu.getAttribute(name).array).toEqual(legacy.getAttribute(name).array);
  }
  expect(cpu.index?.array).toEqual(legacy.index?.array);
  expect(cpu.boundingBox).toEqual(legacy.boundingBox);
  expect(cpu.boundingSphere).toEqual(legacy.boundingSphere);
  expect(library.geometry('a', { borrow: true })).toBe(library.geometry('a', { borrow: true }));
  legacy.dispose(); cpu.dispose(); draw.geometry.dispose();
});
it('takes a packed static vertex (STR16) as plain Float32 rest channels in identity space', async () => {
  const load = async (packed: boolean) => {
    const mesh = primitive('a'), scene = new Group();
    if (packed) {
      // GLTFLoader's view of 4-byte-aligned packed channels: Int8 normals and Uint8 colours padded to 4, Uint16 UVs tight
      mesh.geometry.setAttribute('normal', new InterleavedBufferAttribute(new InterleavedBuffer(new Int8Array([0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0]), 4), 3, 0, true));
      mesh.geometry.setAttribute('color', new InterleavedBufferAttribute(new InterleavedBuffer(new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0]), 4), 3, 0, true));
      mesh.geometry.setAttribute('uv', new BufferAttribute(new Uint16Array([0, 65535, 65535, 65535, 0, 0, 65535, 0]), 2, true));
    } else {
      mesh.geometry.setAttribute('color', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]), 3));
    }
    scene.add(mesh);
    const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a'], keepGrid: true }] }, 'test', {}, () => Promise.resolve({ scene }));
    await library.preload();
    return library.geometry('a');
  };
  const plain = await load(false), packed = await load(true);
  if (plain === null || packed === null) throw new Error('Missing rest pool geometry');
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attribute = packed.getAttribute(name);
    expect(attribute).toBeInstanceOf(BufferAttribute);
    expect(attribute.array).toBeInstanceOf(Float32Array);
    expect(attribute.normalized).toBe(false);
    expect([...attribute.array]).toEqual([...plain.getAttribute(name).array]);
  }
});

it('IP30: keeps the pool failure that left a part missing', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const cause = new RangeError('Out of memory');
  const library = createModelLibrary<never, never>({ ...empty, geometryPools: [{ url: 'pool', parts: ['a'] }] }, 'test', {}, () => Promise.reject(cause));
  await library.preload();
  expect(library.geometry('a')).toBeNull(); expect(library.fault?.('a')).toBe(cause); expect(library.fault?.('b')).toBeUndefined();
});
