// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { questBooks } from '../src/shared/engine/quest/players';
import { talkChoice, talkFinish, talkLine } from '../src/shared/game/shardfile/talks';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { builtProduct } from './fixtures/builtProduct';

// TE-ENG3: a quest-giver from rows alone (`test/fixtures/declared-talk/rows.json`), on Template's product. Its talk offers a quest;
// the accept starts it, a region lights the lamp, the report finishes it, and it pays its coins and files its fact.
type Quests = Shardfile['quests'];
interface TalkFixture {
  readonly flags: Quests['flags']; readonly quest: Quests['quests'][number]; readonly trigger: Quests['triggers'][number];
  readonly dialogue: Quests['dialogue'][number]; readonly ledger: Shardfile['ledger'][number]; readonly talk: NonNullable<Shardfile['targets']['talks']>[number];
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is the author's rows, typed as the format reads them.
const fixture = JSON.parse(readFileSync('test/fixtures/declared-talk/rows.json', 'utf8')) as TalkFixture;
async function withTalk(): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array>; rapier: Awaited<ReturnType<typeof loadRapier>> }> {
  const directory = builtProduct('_template'), product = await loadHeadlessProduct(directory), base = product.shardfile, descriptor = outputDescriptor(base);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, base.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const shard: Shardfile = { ...base,
    quests: { ...base.quests, flags: [...base.quests.flags, ...fixture.flags], quests: [...base.quests.quests, fixture.quest],
      triggers: [...base.quests.triggers, fixture.trigger], dialogue: [...base.quests.dialogue, fixture.dialogue] },
    ledger: [...base.ledger, fixture.ledger],
    targets: { ...base.targets, talks: [fixture.talk] } };
  return { shard, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
}
const PLAYER = 'actor.player', BOT = 'bot:1', LINE = talkLine(fixture.dialogue.id);
const node = (id: string): number => fixture.dialogue.nodes.findIndex(row => row.id === id) + 1;
/** The press for a choice by its ids: the fixture's one talk, the node's and choice's places in the tree. */
function answer(nodeId: string, choiceId: string): string {
  const at = fixture.dialogue.nodes.findIndex(row => row.id === nodeId), choice = fixture.dialogue.nodes[at]?.choices.findIndex(row => row.id === choiceId) ?? -1;
  if (at < 0 || choice < 0) throw new Error(`No choice ${nodeId}.${choiceId}`);
  return talkChoice(0, at, choice);
}
const FINISH = talkFinish(0);
function lines(sim: ShardfileSimulation, player: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const read of shardRows(sim.host).owned.values()) read(player, out);
  return out;
}
const line = (sim: ShardfileSimulation, player = PLAYER): number => lines(sim, player).get(LINE) ?? 0;
function put(sim: ShardfileSimulation, player: string, x: number, z: number): void {
  const body = sim.host.players.get(player); if (body === undefined) throw new Error(`No ${player}`);
  body.position.set(x, body.position.y, z); body.motor.resetAt(body.position);
}
function press(sim: ShardfileSimulation, id: string, player = PLAYER): void {
  const claim = actRoutes(sim.host).claims.get(id); if (claim === undefined) throw new Error(`No route ${id}`);
  claim(player); sim.host.step();
}
const keeper = (sim: ShardfileSimulation, player = PLAYER) => questBooks(sim.host).of(player).quests.find(quest => quest.def.id === fixture.quest.id);

test('a rows-only quest-giver: its talk offers the quest, the steps finish it, it pays, and a save resumes at the node', async () => {
  const input = await withTalk(), facts: { name: string; entity: string }[] = [], coins: { amount: number; entity: string }[] = [];
  const ports = { rapier: input.rapier, quest: { fact: (name: string, entity: string) => { facts.push({ name, entity }); }, coins: (amount: number, entity: string) => { coins.push({ amount, entity }); } } };
  const sim = createShardfileSim(input.shard, input.assets, ports);
  const [tx, , tz] = fixture.talk.at;

  // The talk opens at its start node, and the quest waits for its accept.
  expect(line(sim)).toBe(node('offer'));
  expect(keeper(sim)?.isStarted).toBe(false);
  // Far from the keeper an answer counts for nothing.
  put(sim, PLAYER, 60, 60); const refused = actRoutes(sim.host).refused;
  press(sim, answer('offer', 'accept'));
  expect(line(sim)).toBe(node('offer'));
  expect(actRoutes(sim.host).refused).toBe(refused + 1);
  // At the keeper: the accept sets its flag, the quest starts, and the node moves on.
  put(sim, PLAYER, tx + 1, tz);
  press(sim, answer('offer', 'accept'));
  expect(sim.host.flags.has('fixture.keeper.accepted')).toBe(true);
  expect(line(sim)).toBe(node('waiting'));
  expect(keeper(sim)?.isStarted).toBe(true);
  // A page a frame behind that answers the old node again moves nothing.
  const before = actRoutes(sim.host).refused;
  press(sim, answer('offer', 'accept'));
  expect(line(sim)).toBe(node('waiting'));
  expect(actRoutes(sim.host).refused).toBe(before + 1);
  // The report waits on the lamp: asked early, it is refused and the node stays.
  press(sim, answer('waiting', 'report'));
  expect(line(sim)).toBe(node('waiting'));
  expect(sim.quest.view(fixture.dialogue.id)?.choices).toEqual([]);

  // A save here: a reload resumes at the waiting node, the quest started.
  const saved = serializeSimSnapshot(snapshotSimHostBytes(sim.host)), level = sim.host.level;
  let again: ShardfileSimulation | undefined;
  restoreSimHost(level, { rapier: input.rapier }, decodeSimSnapshot(saved), restored => { again = bindShardfileSim(restored, input.shard, input.assets, { ...ports, restoring: true }); });
  if (again === undefined) throw new Error('Restore did not install');
  const back = again;
  expect(line(back)).toBe(node('waiting'));
  expect(keeper(back)?.isStarted).toBe(true);
  sim.dispose();

  // The lamp, then the report: the quest is done, pays its coins and files its fact, once.
  put(back, PLAYER, -30, 30); back.host.step();
  expect(back.host.flags.has('fixture.keeper.lamp')).toBe(true);
  put(back, PLAYER, tx, tz + 1);
  press(back, answer('waiting', 'report'));
  expect(line(back)).toBe(node('thanks'));
  expect(keeper(back)?.isComplete).toBe(true);
  expect(coins).toEqual([{ amount: 7, entity: PLAYER }]);
  expect(facts).toEqual([{ name: 'fixture.keeper', entity: fixture.quest.id }]);
  // The last node has no choices: closing it ends the talk.
  press(back, FINISH);
  expect(line(back)).toBe(fixture.dialogue.nodes.length + 1);
  press(back, FINISH); // and once over, again is nothing
  expect(coins).toHaveLength(1);
  back.dispose();
});

test('every press a talk takes is a wire-safe act id', () => {
  const ids = [...fixture.dialogue.nodes.flatMap((row, at) => row.choices.map((_choice, choice) => talkChoice(31, at, choice))), talkFinish(31)];
  for (const id of ids) expect(id).toMatch(/^talk:[0-9.]+(?:end)?$/u);
  expect(ids.every(id => id.length <= 128)).toBe(true);
});

test('a second player keeps its own node', async () => {
  const input = await withTalk(), ports = { rapier: input.rapier, quest: { fact: () => undefined, coins: () => undefined } };
  const sim = createShardfileSim(input.shard, input.assets, ports), [tx, , tz] = fixture.talk.at;
  sim.host.addPlayer(BOT, { x: tx, y: 1, z: tz + 1 });
  put(sim, PLAYER, tx + 1, tz);
  press(sim, answer('offer', 'accept'));
  expect(line(sim)).toBe(node('waiting'));
  expect(line(sim, BOT)).toBe(node('offer'));
  expect(keeper(sim, BOT)?.isStarted).toBe(false);
  press(sim, answer('offer', 'accept'), BOT);
  expect(line(sim, BOT)).toBe(node('waiting'));
  expect(questBooks(sim.host).of(BOT).flags.has('fixture.keeper.accepted')).toBe(true);
  sim.dispose();
});
