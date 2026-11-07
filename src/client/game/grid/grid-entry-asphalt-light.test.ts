import { expect, test } from 'vitest';
import { CanvasTexture, MeshLambertMaterial } from 'three';
import { ROAD_SKY } from './frameModel';
import { ROAD_OVERLAY_LIGHT, RoadOverlayLight } from './roadLook';

// W1 grid-ready check (2026-10-14): Signal's dusk light and grade turned the 15 m of road asphalt forced into each entry
// (G103) into a black quad. The overlay keeps the road's light where a cell's own light owns the frame.

test('the road overlay light is the road key and hemisphere on flat asphalt, over pi', () => {
  const up = Math.sin(ROAD_SKY.sun.elevation * Math.PI / 180);
  ROAD_OVERLAY_LIGHT.forEach((value, k) => {
    const key = ROAD_SKY.sun.colour[k] ?? 0, sky = ROAD_SKY.hemi.sky[k] ?? 0;
    expect(value).toBeCloseTo((key * ROAD_SKY.sun.intensity * up + sky * ROAD_SKY.hemi.intensity) / Math.PI, 6);
  });
});

test('on the road the overlay is lit as before; inside a cell it shows the road light through its own map', () => {
  const map = new CanvasTexture({ width: 1, height: 1 }), material = new MeshLambertMaterial({ map, emissiveMap: map, emissive: 0 });
  const disposers: (() => void)[] = [], light = new RoadOverlayLight();
  light.add(material, { onDispose: (fn) => { disposers.push(fn); } });
  expect(material.color.r).toBe(1);
  expect(material.emissive.getHex()).toBe(0);
  light.weight(0);
  expect(material.color.r).toBe(0);
  expect(material.emissive.r).toBeCloseTo(ROAD_OVERLAY_LIGHT[0], 6);
  expect(material.emissive.b).toBeCloseTo(ROAD_OVERLAY_LIGHT[2], 6);
  light.weight(0.25); // across the 16 m edge band the two shares blend
  expect(material.color.g).toBeCloseTo(0.25, 6);
  expect(material.emissive.g).toBeCloseTo(ROAD_OVERLAY_LIGHT[1] * 0.75, 6);
  for (const dispose of disposers) dispose();
  light.weight(1);
  expect(material.color.g).toBeCloseTo(0.25, 6); // a disposed material is no longer driven
  expect(light.applied()).toBe(1);
});
