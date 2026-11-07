import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three';
import { parse } from 'valibot';
import { SlashTrail } from '@wildshard/engine/combat/view/slashTrail';
import { ClientTrailsSchema } from '@wildshard/format/clientTrails';
import type { ShardContext } from '../plugin/context';
import { clientPopulationActors } from './clientPopulation';
import { sceneModelSource } from './sceneSources';

/** Client-only point trails on the actual population, entered after its
 * bodies exist. The look owns materials; the entered scope owns geometry. */
export function installClientTrails(ctx: ShardContext, input: unknown): void {
  const rows = parse(ClientTrailsSchema, input), eye = new Vector3();
  const world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('Trails require the entered world');
  for (const row of rows.rows) {
    const material = sceneModelSource(ctx.product, row.library).look(row.look);
    if (material === undefined) throw new Error(`Missing trail look: ${row.look}`);
    const trails = clientPopulationActors(ctx, row.group).map(actor => {
      const positions = new Float32Array(row.points * 6), fade = new Float32Array(row.points * 2), sides = new Float32Array(row.points * 2), indices: number[] = [];
      for (let i = 0; i < row.points - 1; i++) { const a = i * 2; indices.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      for (let i = 0; i < row.points; i++) { const f = 1 - i / (row.points - 1); fade[i * 2] = f; fade[i * 2 + 1] = f; sides[i * 2] = 1; sides[i * 2 + 1] = -1; }
      const geometry = new BufferGeometry(), attribute = new BufferAttribute(positions, 3);
      geometry.setAttribute('position', attribute); geometry.setAttribute('aFade', new BufferAttribute(fade, 1)); geometry.setAttribute('aSide', new BufferAttribute(sides, 1)); geometry.setIndex(indices);
      const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.name = row.name; mesh.visible = false;
      ctx.root.add(mesh); ctx.scope.own(geometry); ctx.scope.onDispose(() => { mesh.removeFromParent(); });
      return { actor, mesh, positions, attribute, follow: SlashTrail.follow({ kind: rows.kind, points: row.points, every: row.every, movementSq: row.movementSq }) };
    });
    ctx.system({ id: row.id, phase: 'late', run: dt => {
      for (const trail of trails) {
        trail.mesh.visible = trail.actor.alive;
        if (!trail.follow.follow(trail.actor.position, trail.actor.alive, dt)) continue;
        trail.follow.face(trail.mesh.worldToLocal(world.game.camera.getWorldPosition(eye)), row.width, row.minimum, trail.positions);
        trail.attribute.needsUpdate = true;
      }
    } });
  }
}
