import { expect, test, vi } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Scene, type Object3D } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { sceneJobs } from '@wildshard/engine/render/precompile';
import { prelinkGridViews } from './prelinkViews';

function fixture() {
  const scope = new Scope('view-page'), scene = new Scene(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const roots = [new Group(), new Group(), new Group()];
  for (const root of roots) { scene.add(root); root.add(new Mesh(geometry, material)); }
  roots[2]?.add(new InstancedMesh(geometry, material, 1));
  return { scope, scene, geometry, material, roots, dispose: () => { scope.dispose(); geometry.dispose(); material.dispose(); } };
}

test('settled page lighting uses one complete inventory and preserves every object variant', () => {
  const f = fixture(), single = vi.fn((): Promise<void> => Promise.resolve()), jobs: number[] = [];
  const many = vi.fn((roots: readonly Object3D[], current: () => boolean): Promise<void> => {
    expect(roots).toEqual(f.roots); expect(current()).toBe(true);
    jobs.push(sceneJobs(f.scene, null, 1, roots).jobs.length); return Promise.resolve();
  });
  try {
    const separate = f.roots.reduce((n, root) => n + sceneJobs(f.scene, null, 1, [root]).jobs.length, 0);
    prelinkGridViews(f.scope, f.roots, single, many);
    expect(many).toHaveBeenCalledTimes(1); expect(single).not.toHaveBeenCalled();
    expect(separate).toBe(4); expect(jobs).toEqual([2]);
    expect(f.scene.children).toEqual(f.roots);
  } finally { f.dispose(); }
});

test('batch cancellation observes detached roots and page retirement', () => {
  const f = fixture(); let current = (): boolean => false;
  try {
    prelinkGridViews(f.scope, f.roots, undefined, (_roots, live) => { current = live; return Promise.resolve(); });
    expect(current()).toBe(true);
    const root = f.roots[0]; if (root === undefined) throw new Error('Missing root');
    root.removeFromParent(); expect(current()).toBe(false);
    f.scene.add(root); expect(current()).toBe(true);
    f.scope.dispose(); expect(current()).toBe(false);
  } finally { f.dispose(); }
});

test('single-view fallback preserves independent fences and errors', async () => {
  const f = fixture(), first = new Error('first view refused'), second = new Error('second view refused');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined), fences: (() => boolean)[] = [];
  try {
    const prepare = vi.fn((root: Object3D, current: () => boolean): Promise<void> => {
      fences.push(current); return root === f.roots[0] ? Promise.reject(first) : root === f.roots[1] ? Promise.reject(second) : Promise.resolve();
    });
    prelinkGridViews(f.scope, f.roots, prepare); await Promise.resolve(); await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(3); expect(warning).toHaveBeenCalledWith('[grid] neighbour view prelink stopped', first);
    expect(warning).toHaveBeenCalledWith('[grid] neighbour view prelink stopped', second);
    f.roots[0]?.removeFromParent(); expect(fences.map(current => current())).toEqual([false, true, true]);
  } finally { warning.mockRestore(); f.dispose(); }
});

test('an empty or retired page never starts another batch', () => {
  const f = fixture(), many = vi.fn((): Promise<void> => Promise.resolve());
  try {
    prelinkGridViews(f.scope, [], undefined, many); f.scope.dispose(); prelinkGridViews(f.scope, f.roots, undefined, many);
    expect(many).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});
