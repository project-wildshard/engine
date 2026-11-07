// J141: Nalati's chapters on the server, per player (J106). The flip deletes the page that ran them; a browser proves the page shows them.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { questBooks } from '../src/shared/engine/quest/players';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { installServerChapters } from '../src/server/game/quest/serverChapters';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

async function nalati() {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  expect(await installServerChapters(live.host, product, product.shardfile, live.fact)).toBe(true);
  return live;
}
const lines = (host: Parameters<typeof shardRows>[0], player: string): ReadonlyMap<string, number> => { const out = new Map<string, number>(); for (const read of shardRows(host).owned.values()) read(player, out); return out; };

test('the server runs a chapter, and judges the talk that starts it', { timeout: 90_000 }, async () => {
  const live = await nalati();
  try {
    const { host } = live, lead = leadPlayer(host), routes = actRoutes(host), book = questBooks(host).of(lead.id);
    const stand = (x: number, z: number): void => { lead.position.set(x, host.groundHeightAt(x, z) + 0.1, z); lead.motor.resetAt(lead.position); };
    stand(0, 0);
    routes.story?.(lead.id, 'talked:elder');
    expect(book.flags.has('talked:elder'), 'not from across the map').toBe(false);
    stand(86.6, 219.5);
    routes.story?.(lead.id, 'tamed:horse');
    expect(book.flags.has('tamed:horse'), 'only what this talk offers').toBe(false);
    routes.story?.(lead.id, 'talked:elder');
    expect(book.flags.has('talked:elder')).toBe(true);
    for (let i = 0; i < 2; i++) host.step();
    routes.bonded?.(lead.id, '1');
    expect(book.flags.has('tamed:horse')).toBe(true);
    for (let i = 0; i < 90; i++) host.step();
    expect(book.flags.all).toContain('feat:tame:1');
    book.flags.set('won:kokpar'); book.flags.set('told:tulpar');
    expect(book.flags.has('quest:tulpar'), 'a chapter ends on the server').toBe(true);
  } finally { live.dispose(); }
});

test('a toppled balbal reads as a clue, for this player and on the wire', { timeout: 90_000 }, async () => {
  const live = await nalati();
  try {
    const { host } = live, lead = leadPlayer(host), book = questBooks(host).of(lead.id);
    host.step();
    for (const flag of ['talked:elder', 'tamed:horse', 'won:kokpar', 'told:tulpar', 'talked:elder:2']) book.flags.set(flag);
    for (let i = 0; i < 60; i++) host.step();
    const balbal = [...host.entities.values()][0]; // balbals rise at night: any body, named one, dies as one does
    if (balbal === undefined) throw new Error('Missing body');
    Object.defineProperty(balbal, 'kind', { value: 'balbal' });
    host.events.emit('actor.died', { actor: balbal.combatActor() } as never);
    host.step();
    expect(book.flags.has('clue:1')).toBe(true);
    expect(lines(host, lead.id).get('said.qClue0')).toBe(1);
  } finally { live.dispose(); }
});

test('a fight\'s row is what a chapter reads: a fallen lair is a felled flag and a feather', { timeout: 90_000 }, async () => {
  const live = await nalati();
  try {
    const { host } = live, book = questBooks(host).of(leadPlayer(host).id);
    actRoutes(host).climate?.({ op: 'force', name: 'storm', at: 0.1 });
    let qyran = null; for (let i = 0; i < 2400 && qyran === null; i++) { host.step(); qyran = [...host.entities.values()].find(body => body.kind === 'eagle') ?? null; }
    if (qyran === null) throw new Error('No storm brought Qyran');
    qyran.hp = 0; qyran.alive = false; // a real row: his own core sees the fall, the world's rules read his record
    for (let i = 0; i < 200; i++) host.step();
    expect(book.flags.has('felled:qyran')).toBe(true);
    expect(book.flags.has('feather:1')).toBe(true);
  } finally { live.dispose(); }
});

test('a chapter is each player\'s own, and a seat costs a projection, not a script', { timeout: 90_000 }, async () => {
  const live = await nalati();
  try {
    const { host } = live, lead = leadPlayer(host), books = questBooks(host), routes = actRoutes(host);
    const other = host.addPlayer('other').id;
    const place = (id: string): void => { const body = host.players.get(id); if (body === undefined) throw new Error('Missing player'); body.position.set(86.6, host.groundHeightAt(86.6, 219.5) + 0.1, 219.5); body.motor.resetAt(body.position); };
    place(lead.id); place(other);
    routes.story?.(other, 'talked:elder');
    for (let i = 0; i < 40; i++) host.step();
    expect(books.of(other).flags.has('talked:elder')).toBe(true);
    expect(books.of(lead.id).flags.has('talked:elder'), 'J106: nobody else\'s talk').toBe(false);
    routes.bonded?.(other, '1');
    for (let i = 0; i < 40; i++) host.step();
    expect(books.of(other).flags.has('tamed:horse')).toBe(true);
    expect(books.of(lead.id).flags.has('tamed:horse')).toBe(false);
    expect(lines(host, other).has('story.prop')).toBe(true);
    const at = performance.now();
    for (let i = 0; i < 600; i++) host.step();
    const withTwo = (performance.now() - at) / 600;
    console.info(`[chapters] 2 seats: host tick ${withTwo.toFixed(2)} ms`);
  } finally { live.dispose(); }
});

test('a chapter is asked on the page\'s beat: its quest signal each half second and its pulse each two', { timeout: 90_000 }, async () => {
  const dt = 1 / 60, project = vi.spyOn(ReturnProgram.prototype, 'project'); // before the install: an owner keeps the method it was given
  const live = await nalati();
  try {
    const { host } = live;
    for (let i = 0; i < 600; i++) host.step();
    const beats = (name: string): number[] => project.mock.calls.flatMap(([signal, values]) => signal === name && values['now'] !== undefined ? [Math.round(values['now'] / dt)] : []);
    const quest = beats('quest'), pulse = beats('feathers');
    expect(Math.abs(quest.length - 600 * dt / 0.5), 'twice a second').toBeLessThanOrEqual(1);
    expect(Math.abs(pulse.length - 600 * dt / 2.5), 'each pulse falls on a beat past its two seconds').toBeLessThanOrEqual(1);
    expect(pulse.every(tick => quest.includes(tick)), 'a pulse goes with its beat').toBe(true);
    for (let i = 1; i < quest.length; i++) expect(((quest[i] ?? 0) - (quest[i - 1] ?? 0)) * dt).toBeGreaterThanOrEqual(0.5);
  } finally { project.mockRestore(); live.dispose(); }
});
