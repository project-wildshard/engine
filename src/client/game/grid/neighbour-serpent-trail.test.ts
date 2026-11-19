// @vitest-environment node
// ONE-FORMAT CC27: a grid page draws a serpent's trail bones on the path its root drew, from the wire rows it heard, so
// two pages that heard the same rows draw one body (the probe's 0.1 m), and that body is the server's trail.
import { expect, test } from 'vitest';
import { BoxGeometry, Group, MeshLambertMaterial, Vector3, type Bone } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ClientSkin } from '../shardfile/clientSkins';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { TrailCreatureVolumes } from '../../../shared/game/shardfile/trailCreatureVolumes';
import { NeighbourLife, type NeighbourCreature } from './neighbourLife';

const BONES = ['head', 'seg1', 'seg2', 'seg3', 'seg4', 'tail'];
const body = { skeleton: 'serpent' as const, trail: { count: BONES.length, spacing: 1.6 }, size: 'medium' as const, scale: 1, look: 'look.wyrm' };
const skin: ClientSkin = { id: 'look.wyrm', geometry: new BoxGeometry(), material: () => new MeshLambertMaterial(), parts: [], clips: new Map(), skeleton: 'serpent', sockets: [], attackSpan: 0,
  bones: [{ name: 'body', parent: null, pos: [0, 0, 0] }, ...BONES.map((name, i) => ({ name, parent: i === 0 ? 'body' : BONES[i - 1] ?? null, pos: [0, 0, -1.6 * i] }))] as unknown as ClientSkin['bones'] };
const cell: GridCell = { instance: 'brasscap', slug: 'brasscap', cell: [-1, -1], origin: { x: -500, z: -500 } as GridCell['origin'] };
const source = { runtime: null, identity: { slug: 'brasscap', seed: 1 }, state: { shared: [], player: [] }, clientScripts: { divisor: 2, bindings: [] },
  creatures: { spawns: [{ id: 'dust-wyrm', species: 'wyrm', variant: 'dust', at: [0, 0, 0], yaw: 0, scale: 1, seed: 5 }], groups: [], brains: [] },
  rows: { species: [{ id: 'wyrm', kind: 'wyrm', label: 'Wyrm', body, dims: { bodyY: 0.4, headRadius: 0.5, bodyRadius: 0.4 }, variants: [{ id: 'dust', label: 'Dust Wyrm', hp: 440 }] }],
    looks: [{ id: 'look.wyrm', species: 'wyrm' }] } } as unknown as Shardfile;

/** The root's path: east along +x, then a quarter circle round onto +z (so a body laid straight would miss it), then it
 *  holds still from tick 400. */
function path(tick: number): Vector3 {
  const s = Math.min(tick, 400) * 0.05; // 3 m/s
  if (s < 10) return new Vector3(s, 0.5, 0);
  const a = Math.min((s - 10) / 5, Math.PI / 2);
  return new Vector3(10 + 5 * Math.sin(a), 0.5, 5 - 5 * Math.cos(a) + Math.max(0, s - 10 - 5 * Math.PI / 2));
}
const yawAt = (tick: number): number => { const a = path(tick), b = path(tick + 1); return Math.atan2(b.x - a.x, b.z - a.z); };

/** One page: its row at `tick` (drawn there, `rootAt` reading the rows it heard on whole ticks). */
async function page(): Promise<{ life: NeighbourLife; root: Group; scope: Scope; at: { tick: number } }> {
  const at = { tick: 0 }, scope = new Scope('serpent page'), root = new Group();
  const row = (): NeighbourCreature => {
    const p = path(at.tick);
    return { position: p, yaw: yawAt(at.tick), scale: 1, speed: 3, strafe: 0, alive: true, attackPhase: -1, state: 'idle', tick: at.tick, rootAt: tick => path(tick) };
  };
  const life = new NeighbourLife({ scope, simulation: () => ({ host: { entities: { get: row } } }), active: () => true });
  await life.admit(cell, root, source, new Map(), (() => undefined) as never, new Map([['brasscap', Promise.resolve(new Map([['look.wyrm', skin]]))]]));
  return { life, root, scope, at };
}
/** The page's drawn trail bones in the cell's frame. */
function drawn(root: Group): Vector3[] {
  const mesh = root.children[0]; if (mesh === undefined) throw new Error('no serpent drawn');
  root.updateMatrixWorld(true);
  const bones: Bone[] = []; mesh.traverse(o => { if ((o as Bone).isBone && BONES.includes(o.name)) bones.push(o as Bone); });
  return BONES.map(name => { const bone = bones.find(b => b.name === name); if (bone === undefined) throw new Error(`no bone ${name}`); return root.worldToLocal(bone.getWorldPosition(new Vector3())); });
}
/** The farthest any point lies from the polyline. */
function apart(points: readonly Vector3[], line: readonly Vector3[]): number {
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1]; if (a === undefined || b === undefined) continue;
      const d = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(d) / Math.max(d.lengthSq(), 1e-9)));
      best = Math.min(best, p.distanceTo(a.clone().addScaledVector(d, t)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

test('two pages that heard the same rows draw one serpent, on the server\'s trail', async () => {
  const ana = await page(), bo = await page();
  // the server's ring, fed every tick
  const serverRoot = { position: path(0), yaw: yawAt(0), scale: 1 }, server = new TrailCreatureVolumes(body, serverRoot, () => -Infinity);
  try {
    // Ana draws every 60 Hz frame, Bo every other with a 2.5-tick lag: both join at tick 0 and watch the turn, then the
    // Wyrm holds still (the probe reads the trails while it holds)
    const both = (): void => {
      const a = drawn(ana.root), b = drawn(bo.root);
      expect(apart(a.slice(1), b)).toBeLessThan(0.1);
      expect(apart(b.slice(1), a)).toBeLessThan(0.1);
    };
    for (let tick = 0; tick <= 460; tick++) {
      serverRoot.position.copy(path(tick)); serverRoot.yaw = yawAt(tick); server.sample(tick);
      ana.at.tick = tick; ana.life.late(1 / 60);
      if (tick % 2 === 0 && tick >= 3) { bo.at.tick = tick - 2.5; bo.life.late(1 / 30); }
      // mid-turn, a page 2.5 ticks behind lies on the other's path between head and tail (each end leads or trails by
      // the 2.5 ticks, 0.125 m at 3 m/s, past the other's line)
      if (tick === 330) { const a = drawn(ana.root), b = drawn(bo.root); expect(apart(a.slice(1, -1), b)).toBeLessThan(0.1); expect(apart(b.slice(1, -1), a)).toBeLessThan(0.1); }
    }
    both();
    const a = drawn(ana.root);
    // the turn is in the body: the tail lies back round the bend (x near 12), where a body laid straight along the head's
    // heading (+z) would keep the head's x (15)
    expect((a[0]?.x ?? 0) - (a[5]?.x ?? 0)).toBeGreaterThan(2);
    const serverBones = BONES.map((_name, i) => server.bone(i, new Vector3()));
    expect(apart(a.slice(1), serverBones)).toBeLessThan(0.1);
  } finally { ana.scope.dispose(); bo.scope.dispose(); }
});

test('a page that joins late lays a rest trail straight back from the head', async () => {
  const late = await page();
  try {
    late.at.tick = 400; late.life.late(1 / 60);
    const rest = drawn(late.root);
    // straight back along its heading from the head
    expect(rest[5]?.distanceTo(rest[0] ?? new Vector3())).toBeCloseTo(8, 0);
  } finally { late.scope.dispose(); }
});
