import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from './glslMaterial';
import { modelContext } from '../../models/model';
import { rebindGeometry } from '../../app/cachedAssets';
import type { GraphIr } from '@wildshard/format/materialGraph';

function renderer(): THREE.WebGLRenderer {
  const r: unknown = Object.create(THREE.WebGLRenderer.prototype);
  if (!(r instanceof THREE.WebGLRenderer)) throw new Error('Missing renderer');
  const fields: Record<string, unknown> = {
    extensions: { has: () => false, get: () => null }, getContext: () => ({}), getRenderTarget: () => null,
    toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
    coordinateSystem: THREE.WebGLCoordinateSystem, info: { render: { frame: 0 } },
    debug: { checkShaderErrors: true, diagnostics: { keywords: false } }, properties: { get: () => ({}), has: () => false },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(r, key, value);
  return r;
}

test('a GPU rebind reaches the renderer but keeps a memo; a real dispose still retires it', () => {
  const ctx = modelContext(null), geometry = new THREE.BoxGeometry();
  let makes = 0, events = 0;
  geometry.addEventListener('dispose', () => { events++; });
  const make = (): { geometry: THREE.BufferGeometry } => { makes++; return { geometry }; };
  const first = ctx.once('views', make);
  rebindGeometry(geometry);
  expect(events).toBe(1);
  expect(ctx.once('views', make)).toBe(first);
  expect(makes).toBe(1);
  geometry.dispose();
  expect(events).toBe(2);
  expect(ctx.once('views', make)).not.toBe(first);
  expect(makes).toBe(2);
});

test('a graph draw with unchanged bindings keeps the drawn geometry and its memo (Pine ground cover)', async () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'standard', nodes: {
    origin: { op: 'objectOrigin' }, carried: { op: 'varying', in: ['origin'] },
  }, stages: { surface: { colour: 'carried' } } };
  const compiled = compileClassicGraph(ir), geometry = new THREE.BoxGeometry(), mesh = new THREE.Mesh(geometry, compiled.material);
  const ctx = modelContext(null), field = ctx.once('field', () => ({ geometry, material: compiled.material }));
  let rebinds = 0;
  geometry.addEventListener('dispose', () => { rebinds++; });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), sun = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(mesh, sun);
  try {
    // the classic material's per-draw hook (cascades, grid decode, instance colours, environment) twice, as two frames
    compiled.material.onBeforeRender(renderer(), scene, camera, geometry, mesh);
    compiled.material.onBeforeRender(renderer(), scene, camera, geometry, mesh);
    await Promise.resolve();
    expect(rebinds).toBe(0);
    expect(ctx.once('field', () => { throw new Error('[field] not built'); })).toBe(field);
  } finally { compiled.material.dispose(); }
});
