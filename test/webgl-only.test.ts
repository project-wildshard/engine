// J322 (Jake, 2026-11-13): "Let's only do WebGL renderer. Let's not do any WebGPU renderer." The lint rule refuses every
// way back to WebGPU, and the client constructs no renderer but three's WebGLRenderer, on a WebGL2 context.
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real linter on isolated fixture files.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and clean only the tiny lint fixture; census the source tree.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed CLI and fixture paths explicitly.
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';

const REFUSED: Readonly<Record<string, string>> = {
  'webgpu-import.ts': 'import { WebGPURenderer } from "three/webgpu"; export const r = new WebGPURenderer();',
  'tsl-import.ts': 'import { color } from "three/tsl"; export const c = color;',
  'webgpu-dynamic.ts': 'export const load = (): Promise<unknown> => import("three/webgpu");',
  'webgpu-addon.ts': 'export * from "three/examples/jsm/renderers/webgpu/WebGPURenderer.js";',
  'navigator-gpu.ts': 'export const gpu = (navigator as { gpu?: unknown }).gpu;',
  'navigator-gpu-window.ts': 'export const gpu = window.navigator["gpu"];',
  'navigator-gpu-in.ts': 'export const has = "gpu" in navigator;',
  'navigator-gpu-destructure.ts': 'const { gpu } = navigator as { gpu?: unknown }; export { gpu };',
  'webgpu-capability.ts': 'import WebGPU from "three/addons/capabilities/WebGPU.js"; export const w = WebGPU;',
  'request-adapter.ts': 'declare const adapterSource: { requestAdapter: () => Promise<unknown> }; export const a = adapterSource.requestAdapter();',
};
const ALLOWED = 'import * as THREE from "three"; export const make = (canvas: HTMLCanvasElement): THREE.WebGLRenderer => new THREE.WebGLRenderer({ canvas }); export const gl = document.createElement("canvas").getContext("webgl2");';

test('no-webgpu refuses every way back to a WebGPU renderer and passes the WebGL one', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/webgl-only-'));
  const put = (path: string, source: string): string => { const file = resolve(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source); return file; };
  const config = put('config.json', JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')], categories: { correctness: 'off' }, rules: { 'wildshard/no-webgpu': 'error' } }));
  const run = (files: readonly string[]): ReturnType<typeof spawnSync> => spawnSync(resolve('node_modules/.bin/oxlint'),
    ['--threads=1', '--no-ignore', '-c', config, '-f', 'json', ...files], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  try {
    const allowed = run([put('src/allowed.ts', ALLOWED)]);
    expect(allowed.status, String(allowed.stdout) + String(allowed.stderr)).toBe(0);
    for (const [name, source] of Object.entries(REFUSED)) {
      const refused = run([put(`src/${name}`, source)]);
      expect(refused.status, name).not.toBe(0);
      expect(String(refused.stdout), name).toContain('no-webgpu');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the only renderer the client constructs is three\'s WebGLRenderer, on a WebGL2 context', () => {
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx|mjs|js)$/u.test(entry.name) && !entry.name.endsWith('.test.ts')) sources.push(path);
    }
  };
  walk('src/client'); walk('src/shared');
  const renderers = new Set<string>(), contexts = new Set<string>();
  for (const path of sources) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/new\s+(?:THREE\.)?(\w*Renderer)\s*\(/gu)) renderers.add(match[1] ?? '');
    for (const match of text.matchAll(/getContext\(\s*['"]([\w-]+)['"]/gu)) contexts.add(match[1] ?? '');
  }
  expect([...renderers]).toEqual(['WebGLRenderer']);
  // 2d canvases draw UI and textures; the one 3D context kind is webgl2 (never 'webgl', 'webgpu' or 'experimental-webgl')
  expect([...contexts].filter(kind => kind !== '2d')).toEqual(['webgl2']);
});
