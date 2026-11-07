import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify weak entry ownership in a separate real-GC child.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only this test's temporary runner configuration.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the exact runner without a shell.
import {resolve as resolvePath} from 'node:path';
import {MeshStandardMaterial} from 'three';
import {WeakShaderMap} from './weakShaderMap';

function retainedMap(): {map: WeakShaderMap<{material: MeshStandardMaterial}>; weak: WeakRef<MeshStandardMaterial>} {
  const map = new WeakShaderMap<{material: MeshStandardMaterial}>(), material = new MeshStandardMaterial();
  map.set(material, {material});
  return {map, weak: new WeakRef(material)};
}
function clearedMap(): {material: MeshStandardMaterial; weak: WeakRef<WeakShaderMap<object>>} {
  const map = new WeakShaderMap<object>(), material = new MeshStandardMaterial();
  map.set(material, {}); map.clear();
  return {material, weak: new WeakRef(map)};
}

test('weak shader entries collect their material and cleared listeners release their map', async () => {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    if (process.env['WS_SHADER_MAP_GC'] === '1') throw new Error('Shader map proof requires --expose-gc');
    mkdirSync('tmp', {recursive: true}); const directory = mkdtempSync(resolvePath('tmp/shader-map-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['src/client/engine/world/weak-shader-map-lifetime.test.ts'],setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: {...process.env, WS_SHADER_MAP_GC: '1', NO_COLOR: '1'}, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      }); expect(output).toContain('1 passed');
    } finally { rmSync(directory, {recursive: true, force: true}); }
    return;
  }
  const retained = retainedMap(), cleared = clearedMap();
  try {
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
      if (retained.weak.deref() === undefined && cleared.weak.deref() === undefined) break;
    }
    expect(retained.weak.deref()).toBeUndefined(); expect(cleared.weak.deref()).toBeUndefined();
    retained.map.forEach(() => { throw new Error('Collected material remains in the walk'); });
    expect(retained.map.size).toBe(0); expect(cleared.material.type).toBe('MeshStandardMaterial');
  } finally { retained.map.clear(); cleared.material.dispose(); }
});
