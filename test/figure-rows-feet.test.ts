// SERVER-PARITY SS10b (engine 3cf3bfda): a figure on a borrowed root is built at the origin and placed at its feet only
// afterwards (questFigure), so its body box must follow the root on `syncAnchors`, or the page's body (and the registry piece
// that follows it) stays at the world origin while the figure stands by the hut. Driftwood's Wendell was exactly this.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { FigureRows } from '../src/client/game/systems/npc/figureRows';
import type { SceneHandles } from '../src/client/game/shardfile/sceneHandles';

/** The handles a rootless-draw figure reads: its borrowed root group, publication and release. */
function handles(root: THREE.Group): SceneHandles {
  const published = new Map<string, unknown>();
  return {
    has: (id: string) => published.has(id),
    group: (id: string) => { if (id !== 'wendell-root') throw new Error(`no group ${id}`); return root; },
    object: (id: string) => { throw new Error(`no object ${id}`); },
    publish: (id: string, object: unknown) => { published.set(id, object); },
    release: (id: string) => { published.delete(id); },
  } as unknown as SceneHandles;
}

const row = {
  id: 'wendell', name: 'Wendell', root: { part: 'wendell-root' }, feet: [0, 0, 0], yaw: 0, talkHeight: 1.6,
  collider: { kind: 'box', half: 0.3, top: 1.7, bottom: 0 },
  rig: { skeleton: 'kit', clips: [], sockets: [] }, joints: [], sockets: [], visible: [], drawDistance: 60, pointAt: [0, 1.6, 0], points: false,
};

test('a borrowed-root figure placed after it is built keeps its body box at its feet', () => {
  const scope = new Scope('figure-feet'), root = new THREE.Group();
  try {
    const figure = new FigureRows(handles(root), row, scope);
    // built at the origin, as questFigure's KitFigure is
    expect([figure.collider.x, figure.collider.z, figure.collider.yBottom, figure.collider.yTop]).toEqual([0, 0, 0, 1.7]);
    // questFigure places the group at the figure's feet, then refreshes it
    root.position.set(-19.6, 2.5, -72.2);
    figure.syncAnchors();
    expect(figure.collider.x).toBeCloseTo(-19.6, 5);
    expect(figure.collider.z).toBeCloseTo(-72.2, 5);
    expect(figure.collider.yBottom).toBeCloseTo(2.5, 5);
    expect(figure.collider.yTop).toBeCloseTo(4.2, 5);
    expect(figure.talkPoint.toArray().map(value => Math.round(value * 10) / 10)).toEqual([-19.6, 4.1, -72.2]);
  } finally { scope.dispose(); }
});
