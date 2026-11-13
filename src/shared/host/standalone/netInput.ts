import type { NetCommand } from '@wildshard/wire/netCommand';
import { STORY_ACT, UNSTUCK_ACT, type NetTickAct } from '@wildshard/engine/net/acts';
import type { NetTickInput } from '@wildshard/engine/net/room';
import { actRoutes, lockValue, type ActRoutes } from '@wildshard/engine/sim/actRoutes';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import { netSimCommand } from '@wildshard/engine/sim/netMotion';
import { tickCommands, type HeadlessCommand } from '../tickProtocol';
import type { TrustedHeadlessResident } from '../../../server/host/headlessRuntime';

/** The tick allowance one player's input may use: their command, LOCK, a launcher and a tick's two acts, with room to spare. */
const COMMANDS_PER_TICK = 8;

const has = (command: NetCommand, button: number): boolean => (command.buttons & button) !== 0;
/** Admission allows a hair past straight up; the tick's grammar does not, and an input may not end the server. */
const lookPitch = (command: NetCommand): number => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, command.pitch));

/**
 * P1-E5.2: the lead player's command as an ordinary tick command, so the tick admits it with the same `TickCommandSchema`
 * every other source uses and the weapon systems bound to the lead read its swing, heavy hold and launcher. SimHost takes a
 * NetCommand directly for every other player.
 */
export function netPlayerCommand(command: NetCommand): Extract<HeadlessCommand, { kind: 'player' }> {
  const { attack, heavyTarget } = command, heavy = has(command, NET_BUTTONS.heavy);
  return { kind: 'player', ...netSimCommand(command), seq: command.seq, ...(command.viewTick === 0 ? {} : { viewTick: command.viewTick }), pitch: lookPitch(command), sprint: has(command, NET_BUTTONS.sprint), crouch: has(command, NET_BUTTONS.crouch),
    ...(heavy ? { heavy: heavyTarget === undefined ? {} : { targetId: heavyTarget } } : {}),
    ...(has(command, NET_BUTTONS.secondary) ? { secondary: true as const } : {}),
    // P1-E3.2: a swing that names nothing still swings; the server finds what it strikes (J41).
    ...((attack !== undefined && attack.targetId === undefined) || (heavy && heavyTarget === undefined) ? { swing: true as const } : {}) };
}

/**
 * A player's `interact` acts as the script commands the interaction rows read, naming who acted. They go in the tick's first
 * list, the one the rows watch, whoever sent them. The rows judge reach and state, so a retried act changes nothing; an id
 * no row answers to is dropped, since an input may not end the server.
 */
export function netInteractCommands(routes: ActRoutes, acts: readonly NetTickAct[], player: string): HeadlessCommand[] {
  return acts.flatMap(act => {
    if (act.kind !== 'interact') return [];
    if (act.id.startsWith('seen:') && routes.seen !== null) { routes.seen(player, act.id); return []; }
    if (act.id.startsWith(STORY_ACT)) { routes.story?.(player, act.id.slice(STORY_ACT.length)); return []; }
    if (act.id === UNSTUCK_ACT) { if (routes.unstuck === null) routes.refused++; else routes.unstuck(player); return []; }
    const claim = routes.claims.get(act.id);
    if (claim !== undefined) { claim(player); return []; }
    // A page names the person it talks to; a quest with one person calls that row `talk`.
    const route = routes.interactions.get(act.id) ?? (act.id.endsWith('.talk') ? routes.interactions.get('talk') : undefined);
    if (route === undefined) { routes.refused++; return []; }
    return [{ kind: 'script' as const, ...route, playerId: player }];
  });
}

/** A player's riding: a `ride` act goes to the taming law as it stands, and the lean and look follow its command. */
export function netRide(routes: ActRoutes, player: string, command: NetCommand | undefined, acts: readonly NetTickAct[]): void {
  for (const act of acts) if (act.kind === 'ride') { if (routes.ride === null) routes.refused++; else routes.ride(player, act.action); }
  if (command !== undefined) routes.lean?.(player, command.steer.keyX, lookPitch(command));
}

/** A pose input a client may name, and how many a world keeps: every name is a read of every body near a player. */
const POSE_INPUT = /^[a-zA-Z][a-zA-Z0-9-]{0,31}$/u, MAX_POSE_INPUTS = 96;
/** What a tick's input says to the world itself: a lone player's word on the sky goes straight to the weather (a world with none has nothing to say to it), and anyone may hold a fight's skip. */
export function netWorldInput(routes: ActRoutes, inputs: readonly Pick<NetTickInput, 'acts' | 'command'>[]): void {
  routes.skipHeld = false;
  for (const { acts, command } of inputs) {
    if (command !== null && has(command, NET_BUTTONS.skip)) routes.skipHeld = true;
    for (const act of acts) {
      if (act.kind === 'climate') { if (act.op === 'time') routes.time?.(act.name); else if (act.op === 'day') routes.day?.(act.at); else routes.climate?.(act); }
      else if (act.kind === 'pose') for (const name of act.names.split(',')) if (POSE_INPUT.test(name) && routes.poseInputs.size < MAX_POSE_INPUTS) routes.poseInputs.add(name);
    }
  }
}
/** A player's purchases and hands on a board go to the owners that judge them. */
export function netBuys(routes: ActRoutes, inputs: readonly Pick<NetTickInput, 'acts' | 'player'>[]): void {
  for (const { acts, player } of inputs) for (const act of acts) {
    if (act.kind === 'wear') routes.wear?.(player, act.id);
    if (act.kind === 'board') { if (routes.board === null) routes.refused++; else routes.board(player, act.op, act.slot); }
    if (act.kind !== 'buy') continue;
    if (routes.buy === null) routes.refused++; else routes.buy(player, act.good);
  }
}

/** A client names any slot, and a tick throws on one nothing owns: that input is refused here, and the rest of its command stands. */
function owned(routes: ActRoutes | undefined, slot: number, reload: boolean, fire: boolean): boolean {
  if (routes === undefined) return true;
  if (routes.launcher?.(slot, reload, fire) === true) return true;
  routes.refused++;
  return false;
}

/** Every tick command one player's input becomes: the player command, then its launcher and acts. `interact` is netInteractCommands'. */
export function netTickCommands(command: NetCommand | null, acts: readonly NetTickAct[], routes?: ActRoutes): HeadlessCommand[] {
  const out: HeadlessCommand[] = [];
  if (command !== null) {
    out.push(netPlayerCommand(command));
    if (has(command, NET_BUTTONS.lock) && routes?.lock !== null && routes?.lock !== undefined) out.push({ kind: 'script', actorId: routes.lock, value: lockValue(command.hookTarget) });
    const { launcher } = command;
    if (launcher !== undefined && owned(routes, launcher.slot, false, launcher.fire === true)) out.push({ kind: 'launcher', slot: launcher.slot, ads: launcher.ads, pitch: lookPitch(command), ...(launcher.fire === undefined ? {} : { fire: launcher.fire }) });
  }
  for (const act of acts) {
    if (act.kind === 'reload') { if (owned(routes, act.slot, true, false)) out.push({ kind: 'launcher', slot: act.slot, ads: 0, pitch: command === null ? 0 : lookPitch(command), reload: true }); }
    else if (act.kind === 'equip') {
      if (routes?.equip !== null && routes?.equip !== undefined) out.push({ kind: 'script', actorId: routes.equip, value: act.slot });
      else if (routes !== undefined) routes.refused++;
    }
  }
  return out;
}

/** One room tick on a trusted resident: `lead`'s input as tick commands, which the systems bound to it read, and everyone else's as their own commands. */
export function stepResident(resident: Pick<TrustedHeadlessResident, 'host' | 'step'>, lead: string, inputs: readonly NetTickInput[]): void {
  const own = inputs.find(row => row.player === lead), others = new Map<string, NetCommand>();
  for (const { player, command } of inputs) if (player !== lead && command !== null) others.set(player, command);
  resident.step(tickCommands([{ source: 'net', commands: netTickCommands(own?.command ?? null, own?.acts ?? [], actRoutes(resident.host)) }], COMMANDS_PER_TICK), others, new Map(inputs.map(row => [row.player, row.acts])));
}
