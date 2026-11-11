// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import type { BossPresentation } from '../src/shared/engine/ai/BossBrain';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { PhaseEncounter, silentBossPresentation, type PhaseEncounterSpec } from '../src/server/engine/ai/phases';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { BossRowBar, EliteRowBar, netEncounterFeed, RowReward, type BossBarCard, type EncounterRow } from '../src/client/game/boss/barFeed';
import { NO_MOMENTS, publishEncounter } from '../src/shared/engine/sim/encounterRows';
import type { SkullMark } from '../src/client/engine/ui/EliteBar';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// E6 COMBAT: a bar reads one feed. A fight drawn off a server's rows shows what the brain itself shows a page, in that order.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const BODY = SIM_CREATURE_RECIPE.id;
const LEVEL = { ...SIM_LEVEL, entities: [{ ...SIM_CREATURE_RECIPE, at: { x: 12, y: 0, z: 12 } }] };
const phase = (at: number, caption: string): PhaseEncounterSpec['phases'][number] => ({ at, name: caption, caption, speed: 0, stopDistance: 1.2, turnRate: 6 });
const SPEC: PhaseEncounterSpec = { id: 'room.boss', entity: BODY, kind: 'boss', panel: null, name: 'Boar', title: 'of the room', retry: 'Again',
  arena: { at: [12, 0, 12], radius: 6 }, intro: 0.1, introShort: 0.1, respawn: { at: [-4, 0, -4], yaw: 1 }, phases: [phase(1, 'one'), phase(0.5, 'two')] };
const CARD: BossBarCard = { id: SPEC.id, name: SPEC.name, title: SPEC.title, retryTitle: SPEC.retry, phases: SPEC.phases };

/** The bar moments a presentation is told, a repeated value once. */
function tape(): { readonly bar: BossPresentation; readonly heard: string[] } {
  const heard: string[] = [], silent = silentBossPresentation();
  const hear = (line: string): void => { if (heard.at(-1) !== line) heard.push(line); };
  const bar: BossPresentation = { ...silent, get barShown() { return silent.barShown; }, update: () => undefined, setSkip: () => undefined, hideReward: () => undefined,
    hideBar: () => { if (silent.barShown) hear('hideBar'); silent.hideBar(); }, hideNameCard: () => { hear('hideNameCard'); }, showBar: (name, cuts) => { silent.showBar(name, cuts); hear(`showBar ${name} ${cuts.join(',')}`); },
    showNameCard: (name, title, short) => { hear(`card ${name} ${title} ${String(short)}`); }, showRetry: (title, attempts) => { hear(`retry ${title} ${String(attempts)}`); },
    setHp: hp => { hear(`hp ${hp.toFixed(2)}`); }, setShield: on => { hear(`shield ${String(on)}`); }, setPhase: (index, caption) => { hear(`phase ${String(index)} ${caption}`); } };
  return { bar, heard };
}

test('a fight off the server\'s rows shows what the brain shows a page, in order', () => {
  const page = tape(), wire = tape();
  const host = createSimHost(LEVEL, { rapier }), [lead] = host.players.values(); if (lead === undefined) throw new Error('No lead');
  const bot = host.addPlayer('bot:1', { x: 15, y: 0, z: 12 });
  const fight = new PhaseEncounter(host, SPEC, { saved: { defeated: false, rewardTaken: false, kills: 0 }, persist: () => undefined, reward: () => undefined, presentation: page.bar });
  const world = new SimNetWorld(host), net = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.step(commands);
  } });
  const said: string[] = [], told: string[] = [];
  const voice = { won: () => { said.push('won'); }, music: (event: string) => { said.push(`music ${event}`); }, feed: (line: string) => { said.push(`feed ${line}`); }, attempt: (outcome: string) => { told.push(outcome); } };
  host.events.on('boss.attempt', ({ outcome }) => { said.push(`brain ${outcome}`); }, host.scope);
  const link = directLoopback(), client = new NetClient(link.client), feed = netEncounterFeed(client), view = new BossRowBar(wire.bar, CARD, null, voice);
  net.join(link.server, world.playerOf(lead.id)); client.hello(); link.pump(); net.open(); link.pump();
  const run = (ticks: number): void => { for (let at = 0; at < ticks; at++) { client.flush(); link.pump(); net.tick(); link.pump(); client.present(); view.draw(feed.rows(), 1 / 60); } };
  try {
    const body = host.entities.get(BODY); if (body === undefined) throw new Error('No body');
    run(20); expect(fight.boss.state).toBe('fight');
    body.hp = body.maxHp * 0.4; run(120); expect(fight.boss.phase).toBe(1);
    fight.boss.onPlayerDeath(); run(5); expect(fight.boss.state).toBe('armed'); bot.position.set(15, 0, 12); run(40); expect(fight.boss.state).toBe('fight');
    body.alive = false; run(120); expect(fight.boss.state).toBe('victory');
    const moments = (lines: readonly string[]): string[] => lines.filter(line => !line.startsWith('hp') && !line.startsWith('shield'));
    expect(moments(wire.heard)).toEqual(moments(page.heard));
    const lastHp = (lines: readonly string[]): string | undefined => [...lines].reverse().find(line => line.startsWith('hp'));
    expect(lastHp(wire.heard)).toBe(lastHp(page.heard));
    expect(said.filter(line => line.startsWith('music')), 'the score the rows drive').toEqual(['music intro', 'music phase', 'music death', 'music intro', 'music victory']);
    expect(said.filter(line => line.startsWith('feed'))).toEqual(['feed Boar · two']);
    expect(said.filter(line => line === 'won')).toHaveLength(1);
    expect(told, 'the page tells analytics what the brain told its own host').toEqual(said.filter(line => line.startsWith('brain')).map(line => line.slice(6)));
    expect(page.heard).toContain('phase 1 two'); expect(page.heard).toContain('retry Again 2'); expect(page.heard.at(-1)).toBe('hideBar');
  } finally { net.dispose(); host.dispose(); }
});

test('an intro on a row turns the view to its body, and a summons is a moment', () => {
  const faced: string[] = [], said: string[] = [], { bar } = tape();
  const view = new BossRowBar(bar, CARD, null, { face: (body, dt) => { faced.push(`${String(body)} ${dt.toFixed(2)}`); }, summoned: () => { said.push('summoned'); } });
  const boss = (state: string, body = 0): EncounterRow => ({ id: SPEC.id, kind: 'boss', state, hp: 1, phase: 0, shield: false, body, skip: 0, banners: 0, signatures: 0, known: false, sleep: 0, reward: null });
  view.draw([boss('armed')], 0.1); expect(said, 'a row first seen armed was armed by a save').toEqual([]);
  const fresh = new BossRowBar(bar, CARD, null, { summoned: () => { said.push('summoned'); } });
  fresh.draw([boss('dormant')], 0.1); fresh.draw([boss('armed')], 0.1); fresh.draw([boss('armed')], 0.1);
  expect(said).toEqual(['summoned']);
  view.draw([boss('intro', 7)], 0.25); view.draw([boss('intro', 7)], 0.5); view.draw([boss('fight', 7)], 0.1);
  expect(faced, 'each frame of the intro, and not past it').toEqual(['7 0.25', '7 0.50']);
});

const row = (id: string, state: string, body: number, hp = 1, phaseAt = 0, extra: Partial<EncounterRow> = {}): EncounterRow => ({ id, kind: 'elite', state, hp, phase: phaseAt, shield: false, body, skip: 0, banners: 0, signatures: 0, known: false, sleep: 0, reward: null, ...extra });
test('the elite bar follows the nearest lair off its rows, and fades after a fall', () => {
  const shown: string[] = [], heads = new Map([[1, 10], [2, 4]]);
  const bar = { show: (name: string) => { shown.push(`show ${name}`); }, hide: () => { shown.push('hide'); }, caption: (text: string) => { shown.push(`caption ${text}`); }, update: () => undefined, banner: () => undefined, skulls: () => undefined,
    set: (hp: number, mode: 'head' | 'pinned', head: Vector3 | null) => { shown.push(`set ${hp.toFixed(1)} ${mode} ${head === null ? 'none' : head.x.toFixed(0)}`); } };
  const view = new EliteRowBar(bar, [{ id: 'far', name: 'Far', epithet: 'of far', phase2: 'ENRAGED', signature: 'POUNCE', lair: { x: 90, z: 0 } }, { id: 'near', name: 'Near', epithet: 'of near', phase2: 'ENRAGED', signature: 'LUNGE', lair: { x: 10, z: 0 } }], { player: { position: new Vector3() }, camera: new PerspectiveCamera(),
    head: (body, to) => { const x = heads.get(body); if (x === undefined) return false; to.set(x, 0, 0); return true; } });
  view.draw([row('far', 'aware', 1)], 0.1);
  view.draw([row('far', 'aware', 1), row('near', 'engaged', 2, 0.8)], 0.1);
  view.draw([row('far', 'aware', 1), row('near', 'engaged', 2, 0.4, 1)], 0.1);
  view.draw([row('far', 'idle', 1), row('near', 'dead', 0, 0)], 0.1);
  view.draw([row('far', 'idle', 1), row('near', 'dead', 0, 0)], 2);
  expect(shown).toEqual(['show Far', 'set 1.0 head 10', 'show Near', 'set 0.8 pinned 4', 'caption ENRAGED', 'set 0.4 pinned 4', 'set 0.0 pinned none', 'hide']);
});

const cards = [{ id: 'near', name: 'Near', epithet: 'of near', phase2: 'ENRAGED', signature: 'LUNGE', lair: { x: 10, z: 5 } }];
function eliteBar(): { view: EliteRowBar; heard: string[]; marks: SkullMark[][] } {
  const heard: string[] = [], marks: SkullMark[][] = [];
  const bar = { show: () => undefined, hide: () => undefined, caption: (text: string) => { heard.push(`caption ${text}`); }, update: () => undefined, set: () => undefined,
    banner: (name: string, epithet: string) => { heard.push(`banner ${name} ${epithet}`); }, skulls: (list: SkullMark[]) => { marks.push(list.map(mark => ({ ...mark }))); } };
  return { view: new EliteRowBar(bar, cards, { player: { position: new Vector3() }, camera: new PerspectiveCamera(), head: (_body, to) => { to.set(1, 0, 0); return true; } }), heard, marks };
}
test('an elite row says its banner, its signature\'s name and its skull', () => {
  const { view, heard, marks } = eliteBar();
  view.draw([row('near', 'idle', 2, 1, 0, { banners: 3, signatures: 1 })], 0.1);
  expect(heard, 'what a row already held when it arrived is no moment').toEqual([]);
  view.draw([row('near', 'engaged', 2, 1, 0, { banners: 4, signatures: 1 })], 0.1);
  expect(heard).toEqual(['banner Near of near']);
  view.draw([row('near', 'engaged', 2, 1, 0, { banners: 4, signatures: 2, known: true })], 0.1);
  expect(heard.at(-1)).toBe('caption LUNGE');
  expect(marks.at(-1)).toEqual([{ x: 10, z: 5, shown: true, dead: false, engaged: true, countdown: 0 }]);
  view.draw([row('near', 'dead', 0, 0, 0, { banners: 4, signatures: 2, known: true, sleep: 0.5 })], 0.1);
  expect(marks.at(-1)).toEqual([{ x: 10, z: 5, shown: true, dead: true, engaged: false, countdown: 0.5 }]);
});

test('a boss row fills the skip ring and lays out the server\'s reward, and takes it away with the row', () => {
  const skips: number[] = [], drops: string[] = [];
  const bar: BossPresentation = { update: () => undefined, barShown: true, hideBar: () => undefined, hideNameCard: () => undefined, hideReward: () => undefined, showRetry: () => undefined, showNameCard: () => undefined,
    setSkip: fraction => { skips.push(fraction); }, showBar: () => undefined, setHp: () => undefined, setShield: () => undefined, setPhase: () => undefined };
  const card = { id: 'boss', name: 'Boss', title: 'The', retryTitle: 'Again', phases: [{ at: 1, caption: 'one' }] };
  const view = new BossRowBar(bar, card, { show: at => { drops.push(`show ${String(at.x)}`); }, hide: taken => { drops.push(`hide ${String(taken)}`); } });
  const boss = (state: string, extra: Partial<EncounterRow> = {}): EncounterRow => row('boss', state, 1, 1, 0, { ...extra, kind: 'boss' });
  view.draw([boss('intro', { skip: 0.5 })], 0.1);
  expect(skips).toEqual([0.5]);
  view.draw([boss('victory', { reward: { x: 4, y: 1, z: 2 } })], 0.1);
  view.draw([boss('victory', { reward: { x: 4, y: 1, z: 2 } })], 0.1);
  expect(drops, 'one reward, once').toEqual(['show 4']);
  view.draw([boss('victory')], 0.1);
  expect(drops).toEqual(['show 4', 'hide false']);
  view.draw([boss('victory', { reward: { x: 5, y: 1, z: 2 } })], 0.1);
  view.pressed();
  view.draw([boss('victory')], 0.1);
  expect(drops.at(-1), 'the row ended on this player\'s press').toBe('hide true');
});

test('a reward press the server refused comes back, and one it took doesn\'t', () => {
  const heard: string[] = [], orb = new RowReward({ show: at => { heard.push(`show ${String(at.x)}`); }, hide: taken => { heard.push(`hide ${String(taken)}`); } }), at = { x: 1, y: 0, z: 0 };
  orb.draw(at, 0.1); orb.pressed();
  orb.draw(at, 1); orb.draw(at, 0.4);
  expect(heard, 'it waits for the row').toEqual(['show 1']);
  orb.draw(at, 0.2);
  expect(heard, 'still there: refused').toEqual(['show 1', 'show 1']);
  orb.draw(null, 0.1);
  expect(heard.at(-1), 'nobody took it from here').toBe('hide false');
});

test('a lair\'s row lays its orb out, and a press takes it', () => {
  const heard: string[] = [], pressed: (() => void)[] = [];
  const bar = { show: () => undefined, hide: () => undefined, caption: () => undefined, update: () => undefined, set: () => undefined, banner: () => undefined, skulls: () => undefined };
  const view = new EliteRowBar(bar, cards, { player: { position: new Vector3() }, camera: new PerspectiveCamera(), head: () => false, drop: (id, done) => { pressed.push(done); return { show: at => { heard.push(`${id} show ${String(at.x)}`); }, hide: taken => { heard.push(`${id} hide ${String(taken)}`); } }; } });
  view.draw([row('near', 'dead', 0, 0, 0, { reward: { x: 3, y: 0, z: 1 } })], 0.1);
  expect(heard).toEqual(['near show 3']);
  pressed[0]?.();
  view.draw([row('near', 'dead', 0, 0)], 0.1);
  expect(heard.at(-1)).toBe('near hide true');
});

test('a fight\'s moments reach a client on the encounter row', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), link = directLoopback(), client = new NetClient(link.client);
  publishEncounter(host, 'lair', () => ({ ...NO_MOMENTS, kind: 'elite', state: 'idle', hp: 1, phase: 0, shield: false, body: null, skip: 0.5, banners: 2, signatures: 257, known: true, sleep: 0.25, reward: { x: 3, y: 4, z: 5 } }));
  const net = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  net.join(link.server); client.hello(); link.pump(); net.open(); link.pump(); net.tick(); net.tick(); link.pump();
  const seen = netEncounterFeed(client).rows()[0];
  expect(seen?.banners).toBe(2); expect(seen?.signatures).toBe(1); expect(seen?.known).toBe(true);
  expect(seen?.skip).toBeCloseTo(0.5, 1); expect(seen?.sleep).toBeCloseTo(0.25, 2);
  expect(seen?.reward?.x).toBeCloseTo(3, 2); expect(seen?.reward?.z).toBeCloseTo(5, 2);
  net.dispose(); host.dispose();
});
