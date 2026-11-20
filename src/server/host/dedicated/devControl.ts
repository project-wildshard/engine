// MEMORY-STRUCTURE STR4 (J414): the dev server's control channel, the Node server's half of what the in-page server's harness
// port carries (`standalone/serverHost.ts`): the harness verbs and the dev hook's colliders and ground, for one seated device in
// the cell it stands in. The door takes them on `POST /__dev/control` (main.ts) and the worker applies them here. All of it is
// DEVSERVER-only: main.ts and cellHost.ts reach it behind the `__DEVSERVER__` define, which `build-server.mjs` sets true only
// with `--dev`, so the box's bundle has none of it (test/dev-control-bundle.test.ts).
// oxlint-disable-next-line import/no-nodejs-modules -- The door's own route.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Scope } from '@wildshard/engine/app/scope';
import { landedBy } from '@wildshard/engine/combat/damageBook';
import { isDevColliders, isDevGround, swapDevBoxes, swapDevGround } from '@wildshard/engine/game/devColliders';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { heldArmsOf } from '@wildshard/engine/game/weapons/nativeHeld';
import { isCredit, questBooks } from '@wildshard/engine/quest/players';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { isHarnessFlag, isHarnessGod, isHarnessHits, isHarnessMove, isHarnessPlace, isHarnessStill } from '../../../shared/host/standalone/harnessPlace';

/** The path the door answers, on its own loopback port. */
export const DEV_CONTROL_PATH = '/__dev/control';

/** What the dev server answers a control. */
export interface DevAnswer { readonly ok: boolean; readonly reason?: string; readonly tick?: number }

/** One cell's dev state: the watched parts' boxes, the dev ground, and whether its creatures are held still. */
export interface DevCellState { readonly boxes: Map<string, Scope>; readonly ground: { scope: Scope | null }; still: boolean }
export const devCellState = (): DevCellState => ({ boxes: new Map(), ground: { scope: null }, still: false });

/** Put a body where a harness says: a mounted one with its mount, as the in-page server does (`gridServer.ts` `place`). */
function placeBody(host: SimHost, body: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }): void {
  const seat = mountedPlayerOf(host, body);
  if (seat?.mounted === true) seat.teleport(at.x, at.z, at.yaw); else host.players.get(body)?.resetPose(at, at.yaw);
}

/**
 * Apply one control to the cell `host`, for the seated body `body` (`bodyOf` names another device's body for a `move`). The verbs
 * are `gridServer.ts`'s: `place`/`move`, `flag` (raise), `hits` (hardHits), `god` (bossGod), `still`, and the dev hook's colliders and
 * ground. A message that is none of them is refused, never thrown.
 */
export function applyDev(host: SimHost, body: string, message: unknown, state: DevCellState, bodyOf: (device: string) => string | undefined): DevAnswer {
  const tick = host.state.tick;
  if (isDevColliders(message)) { swapDevBoxes(host.physics, host.scope, state.boxes, message.wildshardDevColliders, message.boxes); return { ok: true, tick }; }
  if (isDevGround(message)) {
    swapDevGround(host.physics, host.scope, state.ground, message.wildshardDevGround, { heightQuery: heightAt => { host.setHeightQuery(heightAt); }, players: () => host.players.entries(),
      place: (at, player) => { try { placeBody(host, player, at); } catch (cause) { console.warn('[devGround] a player stays where it was', cause); } } });
    return { ok: true, tick };
  }
  if (isHarnessMove(message)) { const other = bodyOf(message.move); if (other === undefined) return { ok: false, reason: `no seat for ${message.move}` }; placeBody(host, other, message); return { ok: true, tick }; }
  if (isHarnessPlace(message)) { placeBody(host, body, message); return { ok: true, tick }; }
  if (isHarnessFlag(message)) {
    questBooks(host).of(body).flags.set(message.flag);
    // A death raised by hand is filed as a kill files it: the player's credit and the world's record of the fall. With only the
    // credit, Driftwood's chapter (it reads the world's `dead:captain`) never started the reward, and the quest stayed on its last
    // step after the card (meta QA-FEEDBACK-2026-11-20-mini row 10)
    if (isCredit(message.flag)) host.flags.set(message.flag);
    return { ok: true, tick };
  }
  if (isHarnessHits(message)) {
    const by = message.hits;
    host.events.answer('damage.modify', req => req === null || landedBy(req, host.players) === null ? req : { ...req, amount: req.amount * by }, host.scope, { order: 90 });
    for (const player of host.players.values()) heldArmsOf(host)?.of(player).refill();
    return { ok: true, tick };
  }
  if (isHarnessGod(message)) { host.combat.playerRules(host.scope, { bossGod: true }); actRoutes(host).god = true; return { ok: true, tick }; }
  if (isHarnessStill(message)) { state.still = true; holdStill(host, state); return { ok: true, tick }; }
  if (typeof message === 'object' && message !== null && 'probe' in message) return { ok: true, tick };
  return { ok: false, reason: 'not a dev control' };
}

/** A still cell's creatures hold where they are: each tick, so one that streams in later holds too (`gridServer.ts` `tick`). */
export function holdStill(host: SimHost, state: DevCellState): void {
  if (state.still) for (const actor of host.entities.values()) actor.harnessHold = true;
}

/** The most a control body may be: a dev ground's heightfield is the largest. */
const BODY_LIMIT = 32 * 1024 * 1024;

/** The HTTP JSON heights are an array. The simulation and the worker port use a Float32Array. */
function decodeDevGround(message: Record<string, unknown>): void {
  const ground = message['wildshardDevGround'];
  if (typeof ground !== 'object' || ground === null || !('heights' in ground) || !('resolution' in ground)) return;
  const { heights, resolution } = ground;
  if (typeof resolution !== 'number' || !Number.isInteger(resolution) || resolution < 2 || resolution > 257 ||
      !Array.isArray(heights) || heights.length !== resolution * resolution || !heights.every(height => typeof height === 'number' && Number.isFinite(height))) return;
  message['wildshardDevGround'] = { ...ground, heights: Float32Array.from(heights) };
}

/**
 * `POST /__dev/control` on the door: `{ device, ...control }` from a page on an allowed origin (a dev page's harness and dev hook),
 * or from a loopback tool with no origin; `GET` lists the seated devices. Only a loopback peer is heard, whatever the door is bound to.
 */
export function devRoute(request: IncomingMessage, response: ServerResponse, control: (device: string, message: unknown) => Promise<DevAnswer>, origins: readonly string[] | null, seats: () => readonly string[]): void {
  const origin = request.headers.origin, allowed = typeof origin === 'string' && (origins === null || origins.includes(origin));
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store', ...allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } : {} };
  const peer = request.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || (origin !== undefined && !allowed)) { response.writeHead(403, headers).end(); return; }
  if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return; }
  // a loopback tool's question: which devices are seated now
  if (request.method === 'GET') { response.writeHead(200, headers).end(JSON.stringify({ seats: seats() })); return; }
  if (request.method !== 'POST') { response.writeHead(405, headers).end(); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk: Buffer) => { size += chunk.length; if (size > BODY_LIMIT) { request.destroy(); return; } chunks.push(chunk); });
  request.on('end', () => {
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400, headers).end(); return; }
    if (typeof body !== 'object' || body === null || !('device' in body) || typeof body.device !== 'string') { response.writeHead(400, headers).end(); return; }
    const { device, ...message } = body as { readonly device: string } & Record<string, unknown>;
    decodeDevGround(message);
    void (async (): Promise<void> => { const answer = await control(device, message); response.writeHead(answer.ok ? 200 : 409, headers).end(JSON.stringify(answer)); })();
  });
}
