import * as THREE from 'three';
import type { Game } from '@wildshard/engine/core/Game';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Player } from '@wildshard/engine/player/Player';
import type { HUD } from '@wildshard/engine/ui/HUD';
import { CameraFX } from '@wildshard/engine/player/CameraFX';
import { Impacts } from '@wildshard/engine/fx/Impacts';
import { GroundTell } from '@wildshard/engine/fx/groundTell';
import { rowEliteScript, type Elites } from '../Elite';
import { DomePuffs } from '@wildshard/engine/fx/groundFx';
import { wirePage } from '../shardfile/wirePage';
import { ELITE_TELL } from '../../../shared/game/shardfile/wirePrompts';
import { parseEliteFeature, type EliteFeatureRows } from '@wildshard/format/eliteFeature';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';


/** An elite feature's rows, as a page reads them. The programme catalogue they name is the server's to check. */
export async function readPageEliteRows(product: ShardFolder, name: string): Promise<EliteFeatureRows> {
  return parseEliteFeature(JSON.parse(new TextDecoder().decode(await product.file(name))));
}

/** Client-only presentation over the same v1 owner as native encounters. Every authority is an existing concrete service;
 * content contributes only rows and prepared models, with no shard callback, override or reflected path. */
/** How long a tell the server said stands without being said again. */
const HEARD_FOR = 0.2;
interface TellDraw { readonly tell?: string | undefined; readonly phase: string; readonly time: number; readonly windup: number; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly width: number; readonly radius: number }
type HeardTell = TellDraw & { readonly tell: 'lane' | 'ring'; readonly bodyX: number; readonly bodyZ: number; at: number };
/** A strike's ground tell, as its windup and active time have it. */
function drawTell(tell: GroundTell, strike: TellDraw, t: number, bodyX: number, bodyZ: number): void {
  if (strike.tell === 'lane' && strike.phase === 'windup') {
    const k = Math.min(1, strike.time / Math.max(0.001, strike.windup)); tell.lane(strike.x0, strike.z0, strike.x1, strike.z1, strike.width, 0.35 + 0.55 * k * (0.75 + 0.25 * Math.sin(t * 22)));
  } else if (strike.tell === 'lane' && strike.phase === 'active') tell.lane(strike.x0, strike.z0, strike.x1, strike.z1, strike.width, Math.max(0, 0.6 - strike.time * 1.2));
  else if (strike.tell === 'ring' && strike.phase === 'windup') { const k = Math.min(1, strike.time / Math.max(0.001, strike.windup)); tell.ring(bodyX, bodyZ, strike.radius * (0.7 + 0.3 * k), 0.35 + 0.6 * k * (0.7 + 0.3 * Math.sin(t * 20))); }
  else tell.hide();
}
/** An elite's tell off the wire: `eliteTellArgs`'s numbers back into a strike. */
function heardTell(name: string, args: readonly number[]): HeardTell | null {
  const tell = name === ELITE_TELL.lane ? 'lane' : name === ELITE_TELL.ring ? 'ring' : null, [, phase = 0, time = 0, windup = 0, x0 = 0, z0 = 0, x1 = 0, z1 = 0, width = 0, radius = 0, bodyX = 0, bodyZ = 0] = args;
  return tell === null ? null : { tell, phase: phase === 0 ? 'windup' : phase === 1 ? 'active' : 'done', time, windup, x0, z0, x1, z1, width, radius, bodyX, bodyZ, at: 0 };
}
/** Metres from a blow's victim a page takes it for its own: the row says who by where, and a shake is one body's. */
const WHO_WAS_HIT = 2;
/** The row body that stands at a server's point, whose head a cue's puff leaves from. */
function rowBodyAt(animals: RowBodiesView, x: number, z: number): Animal | null {
  let best: Animal | null = null, nearest = 1;
  for (const body of animals.animals) { const away = Math.hypot(body.position.x - x, body.position.z - z); if (away < nearest) { best = body; nearest = away; } }
  return best;
}
export function installEliteFeaturePage(game: Game, animals: RowBodiesView, player: Player, elites: Elites,
  models: ReadonlyMap<string, THREE.Object3D>, input: unknown, hud: HUD): {
  readonly elites: Elites; readonly update: (dt: number, t: number) => void; readonly isElite: (body: Animal) => boolean;
} {
  const rows = parseEliteFeature(input), view = rows.view;
  if (view === undefined) throw new Error('Elite page needs declared presentation');
  for (const body of animals.animals.filter(candidate => rows.fights.some(row => row.kind === candidate.kind && row.variant === candidate.variant))) {
    const variants = rows.ordinary[body.kind]; if (variants === undefined) throw new Error('Missing ordinary encounter variants');
    const herd = body.herd, { x, z } = body.position, yaw = body.yaw; animals.retire(body);
    const ordinary = animals.spawn(body.kind, x, z, yaw, variants); ordinary.herd = herd;
    const group = herd >= 0 ? animals.herds[herd] : undefined;
    if (group !== undefined) { const index = group.members.indexOf(body); if (index === -1) group.members.push(ordinary); else group.members[index] = ordinary; }
  }
  const puffs = new DomePuffs(game.scene, new THREE.Color(...view.puffColor), view.puffPool.capacity, view.puffPool.segments, view.puffPool.order), color = new THREE.Color(...view.tellColor);
  const point = new THREE.Vector3(), direction = new THREE.Vector3(), tells = new Map<string, GroundTell>(), ids = new Set(rows.fights.map(row => row.def.id));
  const scope = game.app.levelScope;
  for (const { def, program } of rows.fights) {
    for (const slot of program.slots) for (const kind of new Set((program.strikes ?? []).flatMap(row => row.tell === undefined ? [] : [row.tell]))) {
      tells.set(`${def.id}:${slot.handle}:${kind}`, new GroundTell(game.scene, kind, color));
    }
    const script = rowEliteScript(def, () => { hud.killFeed(`${def.drop.trophyName ?? 'Felled'} — ${def.name}`); }, () => {
      const id = def.drop.skin, model = id === null ? undefined : models.get(id);
      if (model === undefined) throw new Error('Missing admitted elite drop model'); const clone = model.clone(true); clone.visible = true; return clone;
    });
    if (scope !== null) game.app.encounters.elite(def.id, script, scope);
    elites.add(script);
  }
  const heard = new Map<string, HeardTell>();
  /** The server's cue, as a page's own would play: `args` are its row, its elite, where it landed, and the body. */
  const heardCue = ([index = -1, elite = -1, atX = 0, atY = 0, atZ = 0, bodyX = 0, bodyY = 0, bodyZ = 0, scale = 1]: readonly number[]): void => {
    const cue = view.cues[index], id = rows.fights[elite]?.def.id;
    if (cue === undefined || id === undefined) return;
    if (cue.signature === true) elites.signature(id);
    if (cue.trauma !== undefined) CameraFX.for(game).addTrauma(cue.trauma);
    if (cue.voice !== undefined) animals.onSound?.(cue.voice, point.set(atX, atY, atZ));
    const fx = cue.effect; if (fx === undefined) return;
    if (fx.kind === 'puff') {
      const body = fx.at === 'head' ? rowBodyAt(animals, bodyX, bodyZ) : null;
      if (body === null) point.set(bodyX, bodyY, bodyZ); else body.headWorld(point);
      point.y += fx.height * scale; puffs.burst(point, fx.speed, fx.size, fx.lifetime, fx.opacity);
    } else { point.set(bodyX, bodyY + fx.height, bodyZ); direction.set(player.position.x - point.x, 0, player.position.z - point.z); Impacts.for(game).burst('dirt', point, direction, fx.count); }
  };
  if (scope !== null) wirePage.whenLive(scope, client => client.onView(({ name, args }) => {
    if (name === ELITE_TELL.cue) { heardCue(args); return; }
    if (name === ELITE_TELL.hit) { const [trauma = 0, x = 0, z = 0] = args; if (Math.hypot(x - player.position.x, z - player.position.z) < WHO_WAS_HIT) CameraFX.for(game).addTrauma(trauma); return; }
    const row = heardTell(name, args);
    if (row !== null) heard.set(`${name}:${String(args[0])}`, row);
  }));
  return {
    elites,
    isElite: body => wirePage.encounters().some(row => ids.has(row.id) && wirePage.rowBody(row.body) === body),
    update: (dt, t) => {
      // the server fights: this page bars its row and draws the tells it hears
        elites.update(dt, t);
        for (const [key, row] of heard) {
          if (row.at === 0) row.at = t; // the clock's the frame's: a slow frame still shows what it heard
          if (t - row.at > HEARD_FOR) { tells.get(key)?.hide(); heard.delete(key); continue; }
          let tell = tells.get(key);
          if (tell === undefined) { tell = new GroundTell(game.scene, row.tell, color); tells.set(key, tell); }
          tell.setTime(t); drawTell(tell, row, t, row.bodyX, row.bodyZ);
        }
        puffs.update(dt, t);

    },
  };
}
