import { expect,test } from 'vitest';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { Physics } from '../../../shared/engine/physics/Physics';
import { HeightPatch } from '../../../shared/engine/physics/heightPatch';
import { tagOf } from '../../../shared/engine/physics/surface';
import { Scope } from '../../../shared/engine/app/scope';
import { onGpuRestored,rebakeGpuContent } from '../core/gpuOnly';

async function physics(): Promise<Physics> {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../public/assets/physics/rapier.wasm',import.meta.url))));
  return new Physics(R);
}
function heightAt(host: Physics,x: number,z: number): number | null {
  const hit = host.world.castRay(new host.R.Ray({ x,y: 20,z },{ x: 0,y: -1,z: 0 }),40,true);
  return hit === null ? null : 20-hit.timeOfImpact;
}

test('native patch keeps row-major slopes, translation and original surface owner', async () => {
  const host = await physics(),owner = { id: 'floor' },patch = new HeightPatch(host,{ x: 7,y: 3,z: -4,size: 4,res: 3,material: 'sand',owner });
  try {
    patch.set(new Float32Array([0,1,2,0,1,2,0,1,2]));host.step();
    expect(patch.active).toBe(true);expect(host.world.colliders.len()).toBe(1);
    expect(heightAt(host,8,-5)).toBeCloseTo(4.5,5);
    expect(heightAt(host,6,-3)).toBeCloseTo(3.5,5);
    expect(heightAt(host,10,-4)).toBeNull();
    host.world.forEachCollider(collider => { expect(tagOf(collider)).toEqual({ material: 'sand',owner });expect(tagOf(collider)?.owner).toBe(owner); });
  } finally { patch.clear();host.dispose(); }
});

test('replacement and flat removal touch only the patch in its original native world', async () => {
  const a = await physics(),b = await physics();
  const first = new HeightPatch(a,{ x: 0,y: 0,z: 0,size: 4,res: 3,material: 'sand' });
  const other = new HeightPatch(b,{ x: 0,y: 10,z: 0,size: 4,res: 3,material: 'earth',flat: .5 });
  try {
    first.set(new Float32Array(9).fill(1));other.set(new Float32Array(9).fill(2));a.step();b.step();
    expect(heightAt(a,0,0)).toBeCloseTo(1);expect(heightAt(b,0,0)).toBeCloseTo(12);
    const previous = [...a.world.colliders.getAll()];
    first.set(new Float32Array(9).fill(3));a.step();
    expect(a.world.colliders.len()).toBe(1);expect(heightAt(a,0,0)).toBeCloseTo(3);
    for (const collider of previous) expect(tagOf(collider)).toBeUndefined();
    first.set(new Float32Array(9).fill(.005));a.step();
    expect(first.active).toBe(false);expect(a.world.colliders.len()).toBe(0);expect(heightAt(a,0,0)).toBeNull();
    expect(other.active).toBe(true);expect(b.world.colliders.len()).toBe(1);
    other.set(new Float32Array(9).fill(.5));expect(other.active).toBe(false);
    first.clear();other.clear();expect(a.world.colliders.len()).toBe(0);expect(b.world.colliders.len()).toBe(0);
  } finally { first.clear();other.clear();a.dispose();b.dispose(); }
});

test('restore callbacks keep registration order and retire with their actual independent scopes', () => {
  const parent = new Scope('restore-parent'),child = new Scope('restore-child',parent),other = new Scope('restore-other'),calls: string[] = [];
  try {
    onGpuRestored(() => { calls.push('child'); },child);
    onGpuRestored(() => { calls.push('other'); },other);
    rebakeGpuContent();expect(calls).toEqual(['child','other']);
    parent.dispose();rebakeGpuContent();expect(calls).toEqual(['child','other','other']);
    onGpuRestored(() => { calls.push('retired'); },child);
    other.dispose();rebakeGpuContent();expect(calls).toEqual(['child','other','other']);
  } finally { parent.dispose();other.dispose(); }
});
