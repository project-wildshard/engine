// @vitest-environment happy-dom
// REMOTE-PLAYERS RP12 (Jake, 2026-11-12: "a blurred name"): another player's Name reads on a phone. Its height on screen falls
// with distance between a minimum and a maximum, it sits clear of the head (higher on a board), and it is gone past 60 m.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { castawayBody } from '../models/castawayBody';
import { DECK_LIFT } from './remoteBoard';
import { NAME_CLEAR, NAME_HIDE, NAME_MAX_PX, NAME_MIN_PX, NameTag, tagSize } from './nameTag';

/** Jake's phone held upright: 402×874 CSS px, the game's 72° made taller for the aspect (combat/view/ranged.ts fovForAspect). */
const WIDE = 402, TALL = 874, FOV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(72) / 2) / Math.sqrt(WIDE / TALL)));

test('the tag is tallest near, shrinks with distance and never past its clamps', () => {
  const focal = 1 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2), px = (metres: number): number => tagSize(metres, metres, focal, TALL).px;
  expect(px(1)).toBe(NAME_MAX_PX);
  expect(px(3)).toBe(NAME_MAX_PX);
  expect(px(10)).toBeLessThan(NAME_MAX_PX);
  expect(px(15)).toBeLessThan(px(10));
  expect(px(15)).toBeGreaterThan(NAME_MIN_PX);
  expect(px(40)).toBe(NAME_MIN_PX);
  expect(px(60)).toBe(NAME_MIN_PX);
  // Its world height is what puts that many px on the screen at that depth.
  const near = tagSize(15, 15, focal, TALL);
  expect((near.height * focal * TALL) / (2 * 15)).toBeCloseTo(near.px, 6);
});

test('past 60 m the tag is hidden', () => {
  expect(NAME_HIDE).toBe(60);
  expect(tagSize(60, 60, 1, TALL).shown).toBe(true);
  expect(tagSize(60.5, 60.5, 1, TALL).shown).toBe(false);
  expect(tagSize(70, 70, 1, TALL).shown).toBe(false);
});

/** A body as otherPlayers.ts builds it: a group with the castaway in it and the Name tag beside it, on a board when `lift`. */
function body(lift: number): { group: THREE.Group; tag: NameTag } {
  const group = new THREE.Group(), model = castawayBody(), tag = new NameTag('Jimmy');
  model.root.position.y = lift; group.add(model.root, tag); group.position.set(4, 2, -7); group.rotation.y = 0.8;
  return { group, tag };
}

/** Jake's eye `metres` away from the body, looking at its head; the tag fitted as a frame draws it. */
function seen(group: THREE.Group, tag: NameTag, metres: number): { camera: THREE.PerspectiveCamera; bottom: number; top: number } {
  const camera = new THREE.PerspectiveCamera(FOV, WIDE / TALL, 0.08, 2600);
  camera.position.set(group.position.x + metres, group.position.y + 1.6, group.position.z); camera.lookAt(group.position.x, group.position.y + 1.8, group.position.z);
  camera.updateMatrixWorld(true); group.updateMatrixWorld(true);
  tag.fit(camera, TALL);
  const bottom = tag.getWorldPosition(new THREE.Vector3()).y;
  return { camera, bottom, top: bottom + tag.scale.y };
}

const onScreenPx = (camera: THREE.PerspectiveCamera, x: number, y: number, z: number, top: number): number => {
  const a = new THREE.Vector3(x, y, z).project(camera), b = new THREE.Vector3(x, top, z).project(camera);
  return ((b.y - a.y) / 2) * TALL;
};

test('the tag stands clear of the castaway\'s head at every distance, and higher on a board', () => {
  for (const lift of [0, DECK_LIFT]) {
    const { group, tag } = body(lift);
    for (const metres of [3, 15, 40]) {
      const { camera, bottom, top } = seen(group, tag, metres), crown = group.position.y + 1.8 + lift;
      expect(tag.report.shown).toBe(true);
      expect(tag.report.crown).toBeCloseTo(crown, 2);
      expect(bottom).toBeGreaterThanOrEqual(crown + NAME_CLEAR - 1e-6);
      // The height drawn on the phone is the tag's own px (a vertical span over the eye, so within 5 %), within the clamps.
      const drawn = onScreenPx(camera, group.position.x, bottom, group.position.z, top);
      expect(drawn).toBeGreaterThanOrEqual(NAME_MIN_PX * 0.95);
      expect(drawn).toBeLessThanOrEqual(NAME_MAX_PX * 1.05);
      expect(Math.abs(drawn - tag.report.px)).toBeLessThan(tag.report.px * 0.05);
    }
  }
});

test('at 70 m the tag reports hidden and draws nothing', () => {
  const { group, tag } = body(0);
  seen(group, tag, 70);
  expect(tag.report.shown).toBe(false);
  expect(tag.scale.x * tag.scale.y).toBe(0);
  seen(group, tag, 20);
  expect(tag.report.shown).toBe(true);
  expect(tag.scale.y).toBeGreaterThan(0);
});
