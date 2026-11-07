import { expect, test, vi } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, SkinnedMesh, Sphere, Vector3 } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { FrameDrawRanges } from '../render/frameDrawRange';

function fixture() {
  const scope = new Scope('draw-range'), masks = new FrameDrawRanges(), root = new Scene(), camera = new PerspectiveCamera();
  const geometry = new BoxGeometry(); geometry.computeBoundingSphere();
  const material = new MeshBasicMaterial();
  const mesh = (x: number) => { const value = new Mesh(geometry, material); value.position.x = x; root.add(value); return value; };
  return { scope, masks, root, camera, geometry, material, mesh, dispose: () => { scope.dispose(); geometry.dispose(); material.dispose(); } };
}

test('ordinary frame ranges preserve nearby road, screen/sky and originally hidden nodes', () => {
  const f = fixture(), near = f.mesh(0), far = f.mesh(500), sky = f.mesh(500), hidden = f.mesh(500);
  sky.frustumCulled = false; hidden.visible = false;
  const range = f.masks.bind(f.scope, 125); range.enabled = true;
  try {
    f.masks.draw(f.root, f.camera, { render: dt => {
      expect(dt).toBe(.03); expect(near.visible).toBe(true); expect(sky.visible).toBe(true);
      expect(far.visible).toBe(false); expect(hidden.visible).toBe(false);
    } }, .03);
    expect(far.visible).toBe(true); expect(hidden.visible).toBe(false);
  } finally { f.dispose(); }
});

test('transformed bounds and instance aggregate bounds keep an overlapping neighbourhood', () => {
  const f = fixture(), overlap = f.mesh(140), nearInstances = new InstancedMesh(f.geometry, f.material, 1), farInstances = new InstancedMesh(f.geometry, f.material, 1);
  const larger = f.geometry.clone(); larger.boundingSphere = new Sphere(new Vector3(), 50); overlap.geometry = larger;
  nearInstances.position.x = 500; nearInstances.boundingSphere = new Sphere(new Vector3(-500, 0, 0), 1);
  farInstances.boundingSphere = new Sphere(new Vector3(500, 0, 0), 1);
  f.root.add(nearInstances, farInstances); f.masks.bind(f.scope, 125).enabled = true;
  try { f.masks.draw(f.root, f.camera, { render: () => {
    expect(overlap.visible).toBe(true); expect(nearInstances.visible).toBe(true); expect(farInstances.visible).toBe(false);
  } }, .03); } finally { larger.dispose(); f.dispose(); }
});

test('unknown bounds, skinned/custom objects and meshes containing children keep their normal draw', () => {
  const f = fixture(), unknown = f.mesh(500), custom = f.mesh(500), shadow = f.mesh(500), parent = f.mesh(500);
  const missing = new BoxGeometry(); unknown.geometry = missing;
  custom.onBeforeRender = () => undefined; shadow.onBeforeShadow = () => undefined; parent.add(new Group());
  const skin = new SkinnedMesh(f.geometry, f.material); skin.position.x = 500; f.root.add(skin);
  f.masks.bind(f.scope, 125).enabled = true;
  try { f.masks.draw(f.root, f.camera, { render: () => {
    expect([unknown.visible, custom.visible, shadow.visible, parent.visible, skin.visible]).toEqual([true, true, true, true, true]);
  } }, .03); } finally { missing.dispose(); f.dispose(); }
});

test('failed draw restores flags before another preparation or ordinary draw', () => {
  const f = fixture(), far = f.mesh(500), failure = new Error('draw failed'), range = f.masks.bind(f.scope, 125); range.enabled = true;
  try {
    // the masked render skips the root's second matrix walk (its matrices were just updated); the flag always comes back
    expect(() => f.masks.draw(f.root, f.camera, { render: () => { expect(far.visible).toBe(false); expect(f.root.matrixWorldAutoUpdate).toBe(false); throw failure; } }, .03)).toThrow(failure);
    expect(far.visible).toBe(true); expect(f.root.matrixWorldAutoUpdate).toBe(true);
    range.enabled = false;
    f.masks.draw(f.root, f.camera, { render: () => { expect(far.visible).toBe(true); expect(f.root.matrixWorldAutoUpdate).toBe(true); } }, .03);
  } finally { f.dispose(); }
});

test('retired ranges release their masks even if their old signal remains enabled', () => {
  const f = fixture(), far = f.mesh(500), owner = f.scope.child('range'), range = f.masks.bind(owner, 125); range.enabled = true;
  owner.dispose();
  try { f.masks.draw(f.root, f.camera, { render: () => { expect(far.visible).toBe(true); } }, .03);
    expect(() => f.masks.bind(owner, 125)).toThrow('live owner');
    expect(() => f.masks.bind(f.scope, Infinity)).toThrow('positive distance');
  } finally { f.dispose(); }
});

test('sliced retirement stops masking before its disposal handlers finish', () => {
  const f = fixture(), far = f.mesh(500), owner = f.scope.child('retiring-range');
  f.masks.bind(owner, 125).enabled = true; owner.onDispose(() => undefined);
  const steps = owner.disposeSteps(); steps.next(); expect(owner.disposing).toBe(true);
  try { f.masks.draw(f.root, f.camera, { render: () => { expect(far.visible).toBe(true); } }, .03); }
  finally { for (const _step of steps) { /* drain */ } f.dispose(); }
});

test.each([false, true])('hidden owned roots skip only ordinary matrix walks (range %s)', ranged => {
  const f = fixture(), parked = new Group(), child = f.mesh(3);
  parked.position.x = 20; parked.visible = false; parked.add(child); f.root.add(parked);
  f.root.updateMatrixWorld(true);
  const update = vi.spyOn(child, 'updateMatrixWorld');
  const inherited: unknown = Reflect.get(parked, 'updateMatrixWorld');
  f.masks.trackHiddenRoot(f.scope, parked);
  if (ranged) f.masks.bind(f.scope, 125).enabled = true;
  const renderer = { render: (): void => {
    expect(Reflect.get(parked, 'updateMatrixWorld')).toBe(inherited);
    // Match the ordinary renderer's scene update, if the wrapper did not do it.
    if (f.root.matrixWorldAutoUpdate) f.root.updateMatrixWorld();
  } };
  try {
    child.position.x = 9;
    f.masks.draw(f.root, f.camera, renderer, .03);
    expect(update).not.toHaveBeenCalled(); expect(child.matrixWorld.elements[12]).toBe(23);
    expect(Object.hasOwn(parked, 'updateMatrixWorld')).toBe(false);
    parked.updateMatrixWorld(true); // Explicit preparation still updates hidden content.
    expect(child.matrixWorld.elements[12]).toBe(29); update.mockClear();
    child.position.x = 13; parked.visible = true;
    f.masks.draw(f.root, f.camera, renderer, .03);
    expect(update).toHaveBeenCalled(); expect(child.matrixWorld.elements[12]).toBe(33);
  } finally { update.mockRestore(); f.dispose(); }
});

test('renderer callbacks see the original method and may replace it without being overwritten', () => {
  const f = fixture(), parked = new Group(); parked.visible = false; f.root.add(parked);
  const method: unknown = Reflect.get(parked, 'updateMatrixWorld');
  if (typeof method !== 'function') throw new Error('Missing matrix method');
  const original = vi.fn((force?: boolean): void => { Reflect.apply(method, parked, [force]); });
  const replacement = vi.fn((): void => undefined); parked.updateMatrixWorld = original;
  const descriptor = Object.getOwnPropertyDescriptor(parked, 'updateMatrixWorld');
  f.masks.trackHiddenRoot(f.scope, parked);
  try {
    f.masks.draw(f.root, f.camera, { render: () => {
      expect(Object.getOwnPropertyDescriptor(parked, 'updateMatrixWorld')).toEqual(descriptor);
      parked.updateMatrixWorld = replacement;
    } }, .03);
    expect(original).not.toHaveBeenCalled(); expect(Reflect.get(parked, 'updateMatrixWorld')).toBe(replacement);
  } finally { f.dispose(); }
});

test('a failed matrix walk restores hidden methods before propagating the failure', () => {
  const f = fixture(), parked = new Group(), bad = new Group(), failure = new Error('matrix failed');
  parked.visible = false; f.root.add(parked, bad); f.masks.trackHiddenRoot(f.scope, parked);
  const original: unknown = Reflect.get(parked, 'updateMatrixWorld'), render = vi.fn((): void => undefined);
  bad.updateMatrixWorld = (): never => { throw failure; };
  try {
    expect(() => f.masks.draw(f.root, f.camera, { render }, .03)).toThrow(failure);
    expect(Reflect.get(parked, 'updateMatrixWorld')).toBe(original); expect(Object.hasOwn(parked, 'updateMatrixWorld')).toBe(false);
    expect(f.root.matrixWorldAutoUpdate).toBe(true); expect(render).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});

test('retiring owners and roots on another scene retain ordinary matrix updates', () => {
  const f = fixture(), owner = f.scope.child('hidden-owner'), parked = new Group(), otherScene = new Scene();
  parked.visible = false; f.root.add(parked); f.masks.trackHiddenRoot(owner, parked);
  const update = vi.spyOn(parked, 'updateMatrixWorld');
  owner.onDispose(() => undefined); const retirement = owner.disposeSteps(); retirement.next();
  try {
    f.masks.draw(f.root, f.camera, { render: () => { if (f.root.matrixWorldAutoUpdate) f.root.updateMatrixWorld(); } }, .03);
    expect(update).toHaveBeenCalled();
    for (const _step of retirement) { /* Complete retirement before another registration. */ }
    f.masks.trackHiddenRoot(f.scope, parked); otherScene.add(parked); update.mockClear();
    f.masks.draw(f.root, f.camera, { render: () => { otherScene.updateMatrixWorld(); } }, .03);
    expect(update).toHaveBeenCalled();
  } finally { for (const _step of retirement) { /* Finish if an assertion failed. */ } update.mockRestore(); f.dispose(); }
});

test('a frame holds only while a live owner has its range enabled (D178 pauses post for it)', () => {
  const f = fixture(), child = f.scope.child('held'), range = f.masks.bind(child, 125);
  try {
    expect(f.masks.holding()).toBe(false);
    range.enabled = true; expect(f.masks.holding()).toBe(true);
    range.enabled = false; expect(f.masks.holding()).toBe(false);
    range.enabled = true; child.dispose(); expect(f.masks.holding()).toBe(false);
  } finally { f.dispose(); }
});

test('a frame gate keeps its objects out of the live draw only, until released or its owner leaves (D188)', () => {
  const f = fixture(), child = f.scope.child('arrival'), near = f.mesh(0), far = f.mesh(400), other = f.mesh(600);
  try {
    const gate = f.masks.gate(child, [far, other]);
    f.masks.draw(f.root, f.camera, { render: () => { expect([near.visible, far.visible, other.visible]).toEqual([true, false, false]); } }, .03);
    expect([far.visible, other.visible]).toEqual([true, true]);
    gate.release([far]); expect(gate.size()).toBe(1);
    f.masks.draw(f.root, f.camera, { render: () => { expect([far.visible, other.visible]).toEqual([true, false]); } }, .03);
    child.dispose();
    f.masks.draw(f.root, f.camera, { render: () => { expect(other.visible).toBe(true); } }, .03);
  } finally { f.dispose(); }
});
