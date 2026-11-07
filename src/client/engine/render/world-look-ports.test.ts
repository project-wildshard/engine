import { expect, test, vi } from 'vitest';
import { MeshBasicMaterial, WebGLRenderer } from 'three';
import { compileClassicGraph } from './graph/glslMaterial';
import { Scope } from '../../../shared/engine/app/scope';
import { SkyRig } from '../world/skyRig';
import { bindLowPolyMaterial, lowPolyLookMaterial, lowPolyMaterial } from '../world/lowpolyKit';
import { prepareWorldLook, type LookStrategy } from './look';

test('world preparation lends kit materials once, unwinds scopes and preserves the classic fallback', async () => {
  const sky: unknown = Object.create(SkyRig.prototype), renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(sky instanceof SkyRig) || !(renderer instanceof WebGLRenderer)) throw new Error('Missing world ports');
  const setup = vi.fn((): void => undefined); Reflect.set(sky, 'setupMaterial', setup);
  const classic = lowPolyMaterial(sky), owner = new Scope('world-look-test'), newer = owner.child('newer');
  const graph = compileClassicGraph({ version: 1, kind: 'material', model: 'standard', nodes: {}, stages: { surface: { colour: [1, 1, 1] } } }).material, overlay = new MeshBasicMaterial(), disposed = vi.fn((): void => undefined);
  graph.addEventListener('dispose', disposed); overlay.addEventListener('dispose', disposed);
  const init = vi.fn((): void => undefined), events: string[] = [];
  const look: LookStrategy = { compose: () => ({}), prepareWorld: async context => {
    events.push('prepare'); await Promise.resolve();
    bindLowPolyMaterial(context.sky, 'default', graph, context.scope);
  } };
  try {
    const context = { renderer, sky, scope: owner };
    await Promise.all([prepareWorldLook(look, context), prepareWorldLook(look, context)]);
    events.push('terrain');
    expect(events).toEqual(['prepare', 'terrain']);
    expect(lowPolyLookMaterial(sky, 'default', init)).toBe(graph);
    expect(lowPolyMaterial(sky)).toBe(classic); expect(init).not.toHaveBeenCalled(); expect(setup).toHaveBeenCalledTimes(1);
    bindLowPolyMaterial(sky, 'default', overlay, newer);
    expect(lowPolyLookMaterial(sky)).toBe(overlay);
    newer.dispose(); expect(lowPolyLookMaterial(sky)).toBe(graph);
    owner.dispose(); expect(lowPolyMaterial(sky)).toBe(classic);
    expect(disposed).not.toHaveBeenCalled();
    expect(() => bindLowPolyMaterial(sky, 'default', graph, owner)).toThrow('live scope');
    await expect(prepareWorldLook(look, context)).rejects.toThrow('live scope');
    const failed = new Scope('world-look-failed'), refused: LookStrategy = { compose: () => ({}), prepareWorld: () => Promise.reject(new Error('material refused')) };
    try { await expect(prepareWorldLook(refused, { ...context, scope: failed })).rejects.toThrow('material refused'); }
    finally { failed.dispose(); }
  } finally { owner.dispose(); graph.dispose(); overlay.dispose(); classic.dispose(); }
});
