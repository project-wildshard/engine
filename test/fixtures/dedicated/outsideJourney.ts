// TC45: the same ordinary wire inputs on loopback and outside staging.
import {ANIMAL_CLASS} from '../../../src/shared/engine/net/netSchemas';
import type {NetHit} from '../../../src/shared/engine/net/messages';
import {RoomBot, stillThumb, type BotThumb} from './roomBot';

interface Pose {x: number; y: number; z: number; hp: number}
interface Body extends Pose {player: string; handle: number; cell: number; tick: number}
interface Foe extends Pose {id: string; handle: number}
export interface OutsideJourney {
  version: 1; complete: true; walkedMeters: number;
  fight: {id: string; beforeHp: number; afterHp: number; amount: number; confirmedSeq: number};
  beforeDrop: Body; resumed: Body; left: true;
}

const sleep = async (ms: number): Promise<void> => {await new Promise(resolve => {setTimeout(resolve, ms);});};
function body(bot: RoomBot): Body {
  const frame = bot.client.latest, welcome = bot.client.welcome;
  if (frame === null || welcome === null) throw new Error('No authoritative player frame');
  const row = bot.client.owner(frame);
  const value = {x: Number(row['px']), y: Number(row['py']), z: Number(row['pz']), hp: Number(row['hp'])};
  if (!Object.values(value).every(Number.isFinite) || value.hp <= 0) throw new Error('Player frame is invalid or dead');
  return {...value, player: welcome.player, handle: welcome.handle, cell: frame.cell, tick: frame.tick};
}
function foe(bot: RoomBot, id?: string): Foe | null {
  const frame = bot.client.latest;
  if (frame === null) return null;
  const at = body(bot);
  let best: Foe | null = null, distance = Number.POSITIVE_INFINITY;
  for (const entity of bot.client.entities.values()) {
    if (entity.cls !== ANIMAL_CLASS || (id !== undefined && entity.id !== id)) continue;
    const row = bot.client.fields(frame, entity.handle);
    if (row === null) continue;
    const value = {id: entity.id, handle: entity.handle, x: Number(row['x']), y: Number(row['y']), z: Number(row['z']), hp: Number(row['hp'])};
    if (![value.x, value.y, value.z, value.hp].every(Number.isFinite) || value.hp < (id === undefined ? 40 : 1)) continue;
    const gap = Math.hypot(value.x - at.x, value.z - at.z);
    if (gap < distance) {best = value; distance = gap;}
  }
  return best;
}

/** Factory only dials; this function owns both links and always releases the final seat. */
export async function outsideJourney(connect: () => RoomBot, timeoutMs = 60_000, signal?: AbortSignal): Promise<OutsideJourney> {
  const deadline = performance.now() + timeoutMs;
  let active: RoomBot | null = null, left = false, commandError: unknown = null;
  const wait = async (ready: () => boolean, label: string): Promise<void> => {
    while (!ready()) {
      signal?.throwIfAborted();
      if (commandError !== null) throw commandError;
      if (active?.closed !== null && active?.closed !== undefined) throw new Error(`${label}: socket ${active.closed}`);
      if (performance.now() >= deadline) throw new Error(`${label}: journey deadline`);
      await sleep(10);
    }
  };
  let result: Omit<OutsideJourney, 'left'> | null = null;
  try {
    active = connect();
    const first = active;
    await wait(() => first.client.latest !== null, 'first join');
    const start = body(first);
    await wait(() => foe(first) !== null, 'find a living creature');
    const target = foe(first);
    if (target === null) throw new Error('Creature disappeared');
    const toward = Math.atan2(-(target.x - start.x), -(target.z - start.z));
    const walkingYaw = Math.hypot(target.x - start.x, target.z - start.z) < 3 ? toward + Math.PI / 2 : toward;
    first.thumb = tick => ({...stillThumb(tick), yaw: walkingYaw, steer: {keyX: 0, keyY: 1, stickX: 0, stickY: 0}});
    await wait(() => {const at = body(first); return Math.hypot(at.x - start.x, at.z - start.z) >= 1;}, 'authoritative walk');
    const walked = body(first), walkedMeters = Math.hypot(walked.x - start.x, walked.z - start.z);
    let confirmed: NetHit | null = null;
    const off = first.client.onCombat(event => {
      if (event.kind === 'hit' && event.target === target.handle && event.confirmFor > 0 && event.amount > 0) confirmed = event;
    });
    first.thumb = (tick): ReturnType<BotThumb> => {
      try {
      const at = body(first), current = foe(first, target.id);
      if (current === null) return stillThumb(tick);
      const dx = current.x - at.x, dz = current.z - at.z, dy = current.y + .5 - (at.y + 1.3), distance = Math.hypot(dx, dz);
      const length = Math.hypot(dx, dy, dz) || 1;
      return {viewTick: first.client.latest?.tick ?? 0, yaw: Math.atan2(-dx, -dz), pitch: 0, buttons: 0,
        steer: {keyX: 0, keyY: distance > 1.3 ? 1 : 0, stickX: 0, stickY: 0},
        ...(tick % 24 === 0 && distance < 2.8 ? {attack: {targetId: target.id,
          aim: {origin: {x: at.x, y: at.y + 1.3, z: at.z}, direction: {x: dx / length, y: dy / length, z: dz / length}}}} : {})};
      } catch (error) {commandError = error; return stillThumb(tick);}
    };
    await wait(() => confirmed !== null && (foe(first, target.id)?.hp ?? Number.POSITIVE_INFINITY) < target.hp, 'confirmed hit and lower creature health');
    off(); first.thumb = stillThumb;
    const hit = confirmed as NetHit | null, hurt = foe(first, target.id);
    if (hit === null || hurt === null) throw new Error('Missing authoritative fight witness');
    const stoppedAt = first.client.latest?.tick ?? 0;
    await wait(() => (first.client.latest?.tick ?? 0) >= stoppedAt + 2, 'idle before drop');
    const beforeDrop = body(first);
    first.drop();
    await first.ended(Math.min(1000, Math.max(1, deadline - performance.now())));
    if (first.closed === null) throw new Error('First socket did not close');
    active = connect();
    const second = active;
    await wait(() => second.client.latest !== null, 'redial');
    await wait(() => body(second).tick > beforeDrop.tick, 'resumed world keeps ticking');
    const resumed = body(second), sameFoe = foe(second, target.id);
    if (resumed.player !== beforeDrop.player || resumed.handle !== beforeDrop.handle || resumed.cell !== beforeDrop.cell ||
      Math.hypot(resumed.x - beforeDrop.x, resumed.y - beforeDrop.y, resumed.z - beforeDrop.z) > 1 ||
      sameFoe === null || sameFoe.hp > hurt.hp)
      throw new Error(`Redial did not preserve the fighting body and creature health: ${JSON.stringify({beforeDrop, resumed, hurt, sameFoe})}`);
    result = {version: 1, complete: true, walkedMeters,
      fight: {id: target.id, beforeHp: target.hp, afterHp: hurt.hp, amount: hit.amount, confirmedSeq: hit.confirmFor}, beforeDrop, resumed};
  } finally {
    if (active !== null) {
      active.stop();
      try {
        if (active.closed === null) {
          active.transport.control('ready', new Uint8Array([1]).buffer);
          left = await active.ended(3000) === 'closed';
        } else left = active.closed === 'closed';
      } finally {active.drop();}
    }
  }
  if (result === null || !left) throw new Error('Journey did not finish and release its seat');
  return {...result, left: true};
}
