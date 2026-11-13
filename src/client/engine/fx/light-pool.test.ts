import { expect, test } from 'vitest';
import * as THREE from 'three';
import { LightPool } from './LightPool';
import { Scope } from '../../../shared/engine/app/scope';

/** the scene's render-start hook, as WebGLRenderer.render calls it (the pool reads none of its arguments) */
const render = (scene: THREE.Scene): void => { const hook: unknown = Reflect.get(scene, 'onBeforeRender'); if (typeof hook === 'function') Reflect.apply(hook, scene, []); };

test('an owned light keeps the count but lights nothing while its owner is hidden or gone', () => {
  const scene = new THREE.Scene(), region = new THREE.Group(), owner = new THREE.Group();
  region.add(owner); scene.add(region);
  const pool = LightPool.for(scene), light = pool.acquire(0xffffff, 4, 7, 2, owner);
  expect(light.parent).toBe(pool.group);
  render(scene); expect(light.intensity).toBe(4);
  region.visible = false; render(scene); expect(light.intensity).toBe(0);
  region.visible = true; light.intensity = 3; owner.removeFromParent(); render(scene); expect(light.intensity).toBe(0);
  pool.release(light); expect(pool.size).toBe(1); expect(pool.free).toBe(1);
  // sealed by the first render: the freed light is lent again, the count never grows
  const again = pool.acquire(0xff0000, 2, 5, 2, owner);
  expect(again).toBe(light); expect(pool.size).toBe(1);
});

// a grid region's own scene pool shows through the page's reserved lights: the page's light count never moves as the
// region shows, hides or leaves (Pine Hollow's cabin lights rebuilt every lit program 1 → 6 point lights)
test('a nested pool shows through the page pool reserved lights and leaves three light count', () => {
  const page = new THREE.Scene(), root = new THREE.Group(), region = new THREE.Scene(), scope = new Scope('mirror');
  root.add(region); page.add(root);
  const pagePool = LightPool.for(page), regionPool = LightPool.for(region);
  pagePool.reserve(2);
  const counted = (): number => { let n = 0; page.traverse((o) => { if (o instanceof THREE.PointLight && o.layers.mask !== 0) n++; }); return n; };
  regionPool.mirrorInto(pagePool, scope);
  const near = regionPool.acquire(0xff8800, 3, 11, 2), off = regionPool.acquire(0xffffff, 0, 8, 2), late = regionPool.acquire(0x00ff00, 5, 4, 1);
  near.position.set(1, 2, 3); root.position.set(100, 0, 0); page.updateMatrixWorld(true);
  expect(counted()).toBe(2);
  render(page);
  const [a, b] = pagePool.group.children.filter((o): o is THREE.PointLight => o instanceof THREE.PointLight);
  expect(a?.intensity).toBe(3); expect(a?.distance).toBe(11); expect(a?.color.getHex()).toBe(0xff8800);
  expect(a?.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([101, 2, 3]);
  expect(b?.intensity).toBe(5); expect(b?.decay).toBe(1);
  expect(off.layers.mask).toBe(0);
  root.visible = false; render(page);
  expect(a?.intensity).toBe(0); expect(b?.intensity).toBe(0); expect(counted()).toBe(2);
  root.visible = true; scope.dispose(); render(page);
  expect(a?.intensity).toBe(0); expect(late.layers.mask).toBe(1);
});

// G808: content that keeps its light for the session grows a sealed pool once instead of adding a light of its own, so
// the light stays counted (and dims) while its content hides: a home's creature light left the count when Pine showed
test('a growing acquire adds to a sealed, full pool; an ordinary one is handed a detached light', () => {
  const scene = new THREE.Scene(), home = new THREE.Group(); scene.add(home);
  const pool = LightPool.for(scene); render(scene);
  const loose = pool.acquire(0xffffff, 1, 7, 2, home);
  expect(loose.parent).toBeNull(); expect(pool.size).toBe(0);
  const kept = pool.acquire(0x7fe8ff, 4, 7, 2, home, true);
  expect(kept.parent).toBe(pool.group); expect(pool.size).toBe(1);
  home.visible = false; render(scene); expect(kept.intensity).toBe(0); expect(kept.parent).toBe(pool.group);
});

// T7 / T10: a spare made before the first render is the light a late, growing acquire takes, so the count a boot built its
// lit programs for never moves (a home's creature light grew the pool 5 -> 6 after the first render)
test('a spare made before the first render is taken by a later growing acquire without moving the count', () => {
  const scene = new THREE.Scene(), home = new THREE.Group(); scene.add(home);
  const pool = LightPool.for(scene); pool.spare(1);
  expect(pool.size).toBe(1); expect(pool.free).toBe(1); render(scene);
  const kept = pool.acquire(0x7fe8ff, 4, 7, 2, home, true);
  expect(kept.parent).toBe(pool.group); expect(pool.size).toBe(1); expect(pool.free).toBe(0);
});

test('a borrow stands in for a yielding light, the count stands, and release puts it back', () => {
  const scene = new THREE.Scene(), pool = LightPool.for(scene), shared = pool.acquire(0xffffff, 1, 8), held = pool.acquire(0xffffff, 1, 8);
  pool.yields(shared); pool.seal();
  const lights = (): THREE.Object3D[] => pool.group.children.filter(child => child instanceof THREE.PointLight);
  const fight = pool.borrow(0xff8800, 4, 16, 1.6);
  expect(lights()).toHaveLength(2);
  expect(fight.parent).toBe(pool.group);
  expect(shared.parent).toBeNull();
  expect(held.parent).toBe(pool.group);
  shared.intensity = 9; // its owner writes on, and nothing shows
  pool.release(fight);
  expect(lights()).toHaveLength(2);
  expect(shared.parent).toBe(pool.group);
  expect(fight.parent).toBeNull();
});

test('a borrow takes a free light first, and with none yielding is a detached one', () => {
  const scene = new THREE.Scene(), pool = LightPool.for(scene), first = pool.acquire(0xffffff, 1, 8);
  pool.seal(); pool.release(first);
  const free = pool.borrow(0xff8800, 4, 16);
  expect(free).toBe(first);
  expect(pool.borrow(0xff8800, 4, 16).parent).toBeNull();
  expect(pool.group.children.filter(child => child instanceof THREE.PointLight)).toHaveLength(1);
});

// RP4: a region's own scene lights (Sunscar's brazier site light and its signal light, `new PointLight` in its content)
// counted in three's light hash whenever the region showed, so arriving moved the page 6 -> 7 -> 8 point lights and every
// lit program in view linked again (Chromium: 117 to 216 ms a link at Sunscar's edge). Adopted, they show through the
// reserved lights as pooled ones do, up to the reserve; a shadow caster or one past the reserve stays counted as before.
test('a mirrored pool adopts its region scene lights up to the reserve, and gives them back', () => {
  const page = new THREE.Scene(), root = new THREE.Group(), region = new THREE.Scene(), scope = new Scope('adopt');
  root.add(region); page.add(root);
  const pagePool = LightPool.for(page), regionPool = LightPool.for(region);
  pagePool.reserve(3);
  const counted = (): number => { let n = 0; page.traverse((o) => { if (o instanceof THREE.PointLight && o.layers.mask !== 0) n++; }); return n; };
  regionPool.mirrorInto(pagePool, scope);
  const pooled = regionPool.acquire(0xff8800, 3, 11, 2), site = new THREE.PointLight(0xff7a30, 9, 10, 2), signal = new THREE.PointLight(0xff8a3a, 14, 40, 1.6);
  const caster = new THREE.PointLight(0xffffff, 1, 5, 2), spare = new THREE.PointLight(0xffffff, 2, 5, 2), hidden = new THREE.Group();
  caster.castShadow = true; hidden.visible = false; hidden.add(signal);
  site.position.set(4, 1, 0); root.position.set(100, 0, 0);
  region.add(site, hidden, caster, spare); page.updateMatrixWorld(true);
  expect(regionPool.adopt(region)).toBe(2);
  expect(regionPool.adopt(region)).toBe(0);
  expect(counted()).toBe(3 + 2); // the reserve, the caster, and the one past the reserve
  expect(site.layers.mask).toBe(0); expect(signal.layers.mask).toBe(0); expect(caster.layers.mask).toBe(1); expect(spare.layers.mask).toBe(1);
  render(page);
  const [a, b, c] = pagePool.group.children.filter((o): o is THREE.PointLight => o instanceof THREE.PointLight);
  expect(a?.intensity).toBe(3);
  expect(b?.intensity).toBe(9); expect(b?.color.getHex()).toBe(0xff7a30); expect(b?.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([104, 1, 0]);
  expect(c?.intensity).toBe(0); // the signal's group is hidden: its slot stays dark
  hidden.visible = true; render(page); expect(c?.intensity).toBe(14);
  expect(counted()).toBe(5);
  scope.dispose(); render(page);
  expect(site.layers.mask).toBe(1); expect(signal.layers.mask).toBe(1); expect(pooled.layers.mask).toBe(1);
});

// review of RP4: the reserve is shared by every shown region; an adopted light that finds it full lights as before
test('an adopted light that finds the shared reserve full is counted again, not left dark', () => {
  const page = new THREE.Scene(), scope = new Scope('full'), pagePool = LightPool.for(page);
  const regions = [new THREE.Scene(), new THREE.Scene()]; for (const region of regions) page.add(region);
  pagePool.reserve(1);
  const [first, second] = regions.map(region => { const pool = LightPool.for(region); pool.mirrorInto(pagePool, scope); return pool; });
  const lit = new THREE.PointLight(0xffffff, 2, 5, 2), late = new THREE.PointLight(0xffffff, 3, 5, 2);
  regions[0]?.add(lit); regions[1]?.add(late); page.updateMatrixWorld(true);
  expect(first?.adopt(regions[0] ?? page)).toBe(1); expect(second?.adopt(regions[1] ?? page)).toBe(1);
  render(page);
  expect(lit.layers.mask).toBe(0); expect(late.layers.mask).toBe(1);
  late.removeFromParent(); expect(second?.adopt(regions[1] ?? page)).toBe(0);
  scope.dispose();
});
