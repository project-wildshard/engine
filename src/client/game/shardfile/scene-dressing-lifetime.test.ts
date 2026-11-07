import { expect, test } from 'vitest';
import { BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { zlibSync } from 'fflate';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the lifetime proof in one real-GC child.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the child configuration in owned repository scratch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed test runner without shell interpolation.
import { resolve as resolvePath } from 'node:path';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { WorldRegistry } from '@wildshard/engine/world/registry';
import { SceneDressing } from './sceneDressing';
import type { ShardContext } from '../plugin/context';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const geometry = { attrs: [['position', 'f32', 3, false], ['normal', 'f32', 3, false]], count: 3, index: null, indexCount: 0, box: true, expand: false };
function isGeometry(value: unknown): value is BufferGeometry { return value instanceof BufferGeometry; }
function shapeBytes(): Uint8Array {
  return new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer);
}
async function installed(): Promise<{ scope: Scope; registry: WorldRegistry; root: Group; refs: Map<string, WeakRef<Uint8Array>> }> {
  const scope = new Scope('dressing-lifetime'), registry = new WorldRegistry(), root = new Group(), refs = new Map<string, WeakRef<Uint8Array>>();
  const product = legacyDouble<ShardContext['product']>({ slug: 'lifetime', shardfile: legacyDouble<ShardContext['product']['shardfile']>({ spawn: { x: 0, y: 0, z: 0, yaw: 0 }, entryways: [], tiles: [], ring: 'cell' }),
    hasFile: () => true, file: name => {
      const bytes = name === 'contacts.bin' ? zlibSync(new Uint8Array(new Float32Array([-1, 0, -1, 1, 0, -1, 0, 1, 1, 0, 0, 0]).buffer))
        : name === 'floor.bin' ? new Uint8Array(new Float32Array([2, 2, 2, 2]).buffer) : shapeBytes();
      refs.set(name, new WeakRef(bytes));return Promise.resolve(bytes);
    } });
  type Runtime = NonNullable<ShardContext['game']['runtime']>;
  type World = NonNullable<Runtime['world']>;
  const sky = legacyDouble<World['sky']>({ sunDir: new Vector3(0, 1, 0), setupMaterial: () => undefined, csm: legacyDouble<World['sky']['csm']>({ lights: [] }) });
  const ctx = legacyDouble<ShardContext>({ scope, root, product, system: () => undefined,
    app: legacyDouble<ShardContext['app']>({ registry }), game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<Runtime>({ world: legacyDouble<World>({ sky }) }) }) });
  await SceneDressing.install(ctx, { name: 'lifetime', packs: {},
    catalogues: [{ rows: [{ key: 'triangle', model: { id: 'fixture/lifetime', name: 'Lifetime', file: 'src/client/game/shardfile/scene-dressing-lifetime.test.ts', category: 'props', pipeline: 'code', defaults: {} },
      source: { kind: 'file', file: 'specimen.bin', geometry, representation: 'parts', material: { id: 'lifetime', family: 'painterly' } } }] }],
    geometry: { shape: { kind: 'file', file: 'scene.bin', row: geometry } }, materials: {}, layers: [], animations: [],
    statics: [{ name: 'floor', tris: 1, geometry: {}, materials: {}, recipe: { version: 1, root: 'root', materials: [], nodes: [{ kind: 'group', id: 'root', children: [] }] },
      members: [{ model: 'fixture/lifetime', draw: 'single', placements: [{ x: 0, y: 0, z: 0 }], boxes: [-1, -1, -1, 1, 1, 1],
        contacts: { kind: 'packed-hulls', file: 'contacts.bin', origins: [[0, 0, 0, 12]], surface: 'rock' }, floors: [{ file: 'floor.bin', res: 2, size: 2, x: 0, z: 0 }] }] }] });
  return { scope, registry, root, refs };
}

test('live floor and specimen rebuilds do not retain consumed dressing source files', async () => {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    const { WS_DRESSING_GC: child } = process.env;
    if (child === '1') throw new Error('Dressing collection fixture requires --expose-gc');
    mkdirSync('tmp', { recursive: true });const directory = mkdtempSync(resolvePath('tmp/dressing-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['src/client/game/shardfile/scene-dressing-lifetime.test.ts'],setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: { ...process.env, WS_DRESSING_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      });expect(output).toContain('1 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const live = await installed();
  try {
    const scene = live.refs.get('scene.bin'), contacts = live.refs.get('contacts.bin');
    if (scene === undefined || contacts === undefined) throw new Error('Missing source identities');
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); });Reflect.apply(gc, globalThis, []);
      if (scene.deref() === undefined && contacts.deref() === undefined) break;
    }
    expect(scene.deref()).toBeUndefined();expect(contacts.deref()).toBeUndefined();
    expect(live.scope.disposed).toBe(false);expect(live.root.children).toHaveLength(1);
    expect(live.registry.pieces[0]?.floor?.(0, 0)).toBe(2);
    const model = live.registry.models()[0];if (model === undefined) throw new Error('Missing rebuildable specimen');
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const object = withOwner(live.scope, () => model.buildAt?.('desktop') ?? model.object());await model.ready?.();
      const shapes: BufferGeometry[] = [];object.traverse(node => { if (node instanceof Mesh) { const shape: unknown = node.geometry;if (isGeometry(shape)) shapes.push(shape); } });
      const shape = shapes[0];if (shape === undefined) throw new Error('Missing rebuilt triangle');
      expect(shape.getAttribute('position').count).toBe(3);expect(shape.getAttribute('position').getX(0)).toBe(0);
      shape.getAttribute('position').setX(0, 9);shape.dispose();model.release?.();
    }
  } finally { live.scope.dispose(); }
  const reentered = await installed();
  try { expect(reentered.registry.pieces[0]?.floor?.(0, 0)).toBe(2);expect(reentered.root.children).toHaveLength(1); }
  finally { reentered.scope.dispose(); }
});
