import { expect, test, vi } from 'vitest';
import { Effect, EffectMaterial, EffectPass } from 'postprocessing';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, BufferAttribute, BufferGeometry, Texture, Uniform } from 'three';
import { postTriangle, prepareEffectPass } from './postPreparation';
import { readbackPreparation } from './readbackPreparation';
import { Scope } from '../../../shared/engine/app/scope';

const fragment = 'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = inputColor; }';
function revised() {
  const first = new Effect('old', fragment), pass = new EffectPass(new PerspectiveCamera(), first);
  pass.recompile();
  const added = new Effect('new', fragment);
  const effects: unknown = Reflect.get(pass, 'effects');
  const isEffects = (value: unknown): value is Effect[] => Array.isArray(value) && value.every((entry: unknown) => entry instanceof Effect);
  if (!isEffects(effects)) throw new Error('Expected effect list');
  effects.push(added);
  const original = pass.fullscreenMaterial;
  if (!(original instanceof EffectMaterial)) throw new Error('Expected effect material');
  return { pass, added, original };
}

test('post revisions use the real fullscreen layout without a HAS_NORMAL variant', () => {
  const geometry = postTriangle();
  expect(Object.keys(geometry.attributes)).toEqual(['position', 'uv']);
  expect(geometry.getAttribute('position').count).toBe(3);
  geometry.dispose();
});

test('publishes only linked revisions, borrowing textures and the live uniform clock', async () => {
  const { pass, original } = revised();
  const oldShader = original.fragmentShader, clock = original.uniforms['time'], bound = original.uniforms;
  const texture = new Texture(); original.uniforms['heldTexture'] = new Uniform(texture);
  const clone = vi.spyOn(texture, 'clone');
  let finish = (): void => undefined;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  let staged: EffectMaterial | undefined;
  const acquire = vi.fn((material: EffectMaterial) => { expect(material).toBe(original); expect(staged?.fragmentShader).toBe(material.fragmentShader); });
  const work = prepareEffectPass(pass, material => { staged = material; return ready; }, acquire, () => true);
  expect(pass.fullscreenMaterial).toBe(original); expect(original.fragmentShader).toBe(oldShader);
  expect(clone).not.toHaveBeenCalled();
  if (clock === undefined) throw new Error('Expected time uniform');
  clock.value = 42;
  finish(); await work;
  expect(original.fragmentShader).not.toBe(oldShader); expect(acquire).toHaveBeenCalledOnce();
  expect(original.uniforms['time']).toBe(clock); expect(original.uniforms['time']?.value).toBe(42);
  expect(original.uniforms['heldTexture'].value).toBe(texture);
  // three keeps the uniforms object it bound at the first compile of a key: publication replaces entries, not the object
  expect(original.uniforms).toBe(bound); expect(Object.keys(bound).sort()).toEqual(Object.keys(staged?.uniforms ?? {}).sort());
  pass.dispose(); texture.dispose();
});

test.each(['cancel', 'recompile', 'reject'] as const)('does not publish a stale or failed revision: %s', async mode => {
  const { pass, original } = revised(), oldShader = original.fragmentShader;
  const acquire = vi.fn((_material: EffectMaterial): void => undefined); let disposed = 0;
  const work = prepareEffectPass(pass, async material => {
    material.addEventListener('dispose', () => { disposed++; });
    if (mode === 'recompile') pass.recompile();
    if (mode === 'reject') throw new Error('link failed');
    await Promise.resolve();
  }, acquire, () => mode !== 'cancel');
  await (mode === 'reject' ? expect(work).rejects.toThrow('link failed') : work);
  expect(pass.fullscreenMaterial).toBe(original); expect(acquire).not.toHaveBeenCalled(); expect(disposed).toBe(1);
  if (mode !== 'recompile') expect(original.fragmentShader).toBe(oldShader);
  pass.dispose();
});

test('a failed acquisition restores the live shader and releases its temporary holder', async () => {
  const { pass, original } = revised(), shader = original.fragmentShader, bound = original.uniforms, entries = { ...bound };
  let disposed = 0;
  await expect(prepareEffectPass(pass, async material => {
    material.addEventListener('dispose', () => { disposed++; }); await Promise.resolve();
  }, () => { throw new Error('acquire failed'); }, () => true)).rejects.toThrow('acquire failed');
  expect(pass.fullscreenMaterial).toBe(original); expect(original.fragmentShader).toBe(shader); expect(disposed).toBe(1);
  expect(original.uniforms).toBe(bound); expect(bound).toEqual(entries);
  pass.dispose();
});

test('readback shader holders reuse one private texel per owner and release every resource', () => {
  const scope = new Scope('readback'), job = readbackPreparation(scope);
  expect(readbackPreparation(scope)).toBe(job);
  if (!(job.root instanceof Mesh) || !(job.root.material instanceof MeshBasicMaterial)) throw new Error('Expected readback mesh');
  const material = job.root.material, texture = material.map;
  if (texture === null || job.rt === null) throw new Error('Expected private readback target and texel');
  expect(material.depthTest).toBe(false); expect(material.depthWrite).toBe(false);
  expect(texture.colorSpace).toBe('srgb'); expect(job.rt.texture.colorSpace).toBe('srgb');
  const geometry: unknown = job.root.geometry;
  if (!(geometry instanceof BufferGeometry)) throw new Error('Expected readback geometry');
  const position: unknown = geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute)) throw new Error('Expected readback positions');
  expect(position.count).toBe(4);
  const disposers = [geometry, material, texture, job.rt].map(resource => vi.spyOn(resource, 'dispose'));
  scope.dispose(); scope.dispose();
  for (const dispose of disposers) expect(dispose).toHaveBeenCalledOnce();
});
