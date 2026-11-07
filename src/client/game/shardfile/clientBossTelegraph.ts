import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import { parse } from 'valibot';
import { ClientBossTelegraphSchema } from '@wildshard/format/clientNative';
import type { ShardContext } from '../plugin/context';
import { clientNativeBook } from './clientNativeBook';
import { BOSS_STRIKE } from '../../../shared/game/shardfile/wirePrompts';
import { wirePage } from './wirePage';

/** How long a strike the server said stands without being said again: a frame covers two ticks, and a page can lag. */
const HEARD_FOR = 0.25;
/** Client-only telegraphs on the original encounter. Marked views are consumed
 * when the spawned fight binds; lane sheets read its real strike controller. */
export function installClientBossTelegraph(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientBossTelegraphSchema, input), fight = clientNativeBook(ctx).fight, view = row.view;
  const world = ctx.game.runtime?.world;
  if (fight === null || world === undefined || world === null || row.actor !== ctx.product.section('sim/runtime-plan').recipe.population.owner.actor)
    throw new Error('Boss telegraph requires its actual encounter owner');
  if (view.kind === 'marked') return; // a row names no strike
  const strike = ctx.product.section('actors/strikes').find(entry => entry.id === view.strike);
  if (strike?.shape.kind !== 'lane') throw new Error('Lane sheet requires its admitted lane strike and held controller');
  const width = strike.shape.width, reach = strike.shape.length;
  const wall = new Mesh(new BoxGeometry(width, view.height, view.thickness),
    new MeshBasicMaterial({ color: view.color, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false }));
  wall.name = view.system; wall.visible = false; ctx.root.add(wall); ctx.scope.own(wall.geometry); ctx.scope.own(wall.material); ctx.scope.onDispose(() => { wall.removeFromParent(); });
  /** A page on a server holds no body to read a strike off: the server says it, until it stops saying so. */
  const heard = { through: 0, aim: 0, x: 0, z: 0, fresh: false, at: Number.NEGATIVE_INFINITY }, name = `${BOSS_STRIKE}${strike.id}`;
  wirePage.whenLive(ctx.scope, client => client.onView(call => {
    if (call.name !== name) return;
    const [through = 0, aim = 0, x = 0, z = 0] = call.args;
    Object.assign(heard, { through, aim, x, z, fresh: true });
  }));
  ctx.system({ id: view.system, phase: 'update', run: (_dt, t) => {
    if (heard.fresh) { heard.fresh = false; heard.at = t; } // the clock's the frame's: a slow frame still shows what it heard
    const live = t - heard.at < HEARD_FOR;
    wall.visible = live;
    if (!live) return;
    const through = heard.through, aim = heard.aim, x = heard.x, z = heard.z;
    const fraction = Math.min(1, through / strike.windup), sweep = Math.max(0, through - strike.windup) / strike.active;
    const distance = view.ahead + reach * Math.min(1, sweep);
    wall.position.set(x + Math.sin(aim) * distance, world.player.position.y + view.y, z + Math.cos(aim) * distance);
    wall.rotation.y = aim; wall.material.opacity = view.opacity[0] + (view.opacity[1] - view.opacity[0]) * fraction;
  } });
}
