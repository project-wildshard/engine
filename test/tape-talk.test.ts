// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { questBooks } from '../src/shared/engine/quest/players';
import { talkLine } from '../src/shared/game/shardfile/talks';
import { createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';

// TE-ENG3's fixture: a quest-giver from rows alone (`test/fixtures/declared-talk/rows.json`), on Template's product. Its talk offers a quest;
// the accept starts it, a region lights the lamp, the report finishes it, and it pays its coins and files its fact.
type Quests = Shardfile['quests'];
interface TalkFixture {
  readonly flags: Quests['flags']; readonly quest: Quests['quests'][number]; readonly trigger: Quests['triggers'][number];
  readonly dialogue: Quests['dialogue'][number]; readonly ledger: Shardfile['ledger'][number]; readonly talk: NonNullable<Shardfile['targets']['talks']>[number];
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is the author's rows, typed as the format reads them.
const fixture = JSON.parse(readFileSync('test/fixtures/declared-talk/rows.json', 'utf8')) as TalkFixture;
async function withTalk(): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array>; rapier: Awaited<ReturnType<typeof loadRapier>> }> {
  const directory = GAMEPLAY_SLICE, product = await loadHeadlessFolder(directory), base = product.shardfile, descriptor = outputDescriptor(base);
  if (descriptor === undefined) throw new Error('Missing gameplay slice output');
  const server = serverInputFiles(descriptor.index.files, base);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const shard: Shardfile = { ...base,
    quests: { ...base.quests, flags: [...base.quests.flags, ...fixture.flags], quests: [...base.quests.quests, fixture.quest],
      triggers: [...base.quests.triggers, fixture.trigger], dialogue: [...base.quests.dialogue, fixture.dialogue] },
    ledger: [...base.ledger, fixture.ledger],
    targets: { ...base.targets, talks: [fixture.talk] } };
  return { shard, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
}
const PLAYER = 'actor.player', LINE = talkLine(fixture.dialogue.id);
const node = (id: string): number => fixture.dialogue.nodes.findIndex(row => row.id === id) + 1;
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
const keeper = (sim: ShardfileSimulation, player = PLAYER) => questBooks(sim.host).of(player).quests.find(quest => quest.def.id === fixture.quest.id);

// meta NEW-SHARD-E2E F27 (MINI-UNBLOCK MU6): a proof tape names the talk (`<talk>`, E) and its answers (`<talk>:<choice>`); each lands
// on the claim the page's own press does, so a tape walks the real quest path, and an id that names nothing says what does.
test('a tape talks to the quest-giver and answers it by name, through the same claims a page presses', async () => {
  const input = await withTalk(), facts: { name: string; entity: string }[] = [];
  const ports = { rapier: input.rapier, quest: { fact: (name: string, entity: string) => { facts.push({ name, entity }); }, coins: () => undefined } };
  const sim = createShardfileSim(input.shard, input.assets, ports), talk = fixture.talk.id;
  const [tx, , tz] = fixture.talk.at;
  // Far away, an answer is refused as a page's is; E on a node with choices opens it and changes nothing
  put(sim, PLAYER, 60, 60);
  expect(sim.interact(`${talk}:accept`)).toBe(false);
  put(sim, PLAYER, tx + 1, tz);
  expect(sim.interact(talk)).toBe(true);
  expect(line(sim)).toBe(node('offer'));
  expect(sim.interact(`${talk}:accept`)).toBe(true); sim.host.step();
  expect(keeper(sim)?.isStarted).toBe(true);
  expect(line(sim)).toBe(node('waiting'));
  // A choice the node doesn't offer now names the ones it does; an id that names nothing lists the targets
  expect(() => sim.interact(`${talk}:accept`)).toThrow(/has no choice accept now; it offers: none/u);
  expect(() => sim.interact('wren')).toThrow(/Unknown authored interaction wren; this shard's targets: .*fixture\.keeper\.talk/u);
  put(sim, PLAYER, -30, 30); sim.host.step();
  put(sim, PLAYER, tx, tz + 1);
  expect(sim.interact(`${talk}:report`)).toBe(true); sim.host.step();
  expect(keeper(sim)?.isComplete).toBe(true);
  expect(facts).toEqual([{ name: 'fixture.keeper', entity: fixture.quest.id }]);
  // The last node has no choices: E closes this conversation; a new E starts another.
  expect(sim.interact(talk)).toBe(true); sim.host.step();
  expect(line(sim)).toBe(fixture.dialogue.nodes.length + 1);
  expect(sim.interact(talk)).toBe(true); sim.host.step();
  expect(line(sim)).toBe(node('offer'));
  expect(facts).toHaveLength(1);
  sim.dispose();
});
