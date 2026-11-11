import { afterEach, expect, test, vi } from 'vitest';
import type { NetChat } from '../src/shared/engine/net/chatWire';
import type { ChatReport } from '../src/server/engine/net/chat';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// MMO-PLAN MP4.1 (M5, J202): global chat. A `room` line is said, cleaned and flood-checked in its own cell, and the door relays it to every
// other awake cell, on its own worker or another. Done when a line reaches every cell in about a second. Proximity stays where it was said.
const SHARD = 'driftwood-isle', OTHER = 'nalati-grasslands';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

async function world(workers: number): Promise<{ here: RoomBot; there: RoomBot; heardHere: NetChat[]; heardThere: NetChat[]; reports: ChatReport[] }> {
  const saves = memoryPlayerSaves(), reports: ChatReport[] = [];
  saves.write({ player: 'device:there', name: 'There', shard: OTHER, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: [SHARD, OTHER], workers, saves: { ...saves, report: report => { reports.push(report); return true; } } });
  const join = async (device: string, name: string): Promise<RoomBot> => { const made = new RoomBot(bench?.url ?? '', 'bench', device, name); bots.push(made); expect(await made.arrived()).toBe(true); return made; };
  const here = await join('device:here', 'Ann'), there = await join('device:there', 'Ben'), heardHere: NetChat[] = [], heardThere: NetChat[] = [];
  expect(JSON.parse(there.resume ?? '{}')).toMatchObject({ shard: OTHER });
  here.client.onChat(line => { heardHere.push(line); }); there.client.onChat(line => { heardThere.push(line); });
  return { here, there, heardHere, heardThere, reports };
}

// Two named cells always take two workers (`workerTable`); a worker's own cells take the same loop, minus the one that said it.
test('a room line reaches the other cell within a second, across two workers, and proximity stays home', { timeout: 60_000 }, async () => {
  const { here, there, heardHere, heardThere } = await world(2);
  expect(bench?.world.health()).toMatchObject({ cells: 2, workers: 2, awake: 2 });
  const said = performance.now();
  here.client.say('room', 'hello world');
  await vi.waitFor(() => { expect(heardThere.map(line => [line.name, line.text, line.channel, line.from])).toEqual([['Ann', 'hello world', 'room', 0]]); }, { timeout: 1000, interval: 5 });
  expect(performance.now() - said, 'MP4.1: about a second').toBeLessThan(1000);
  expect(heardHere.map(line => line.text), 'the speaker hears it once, from their own cell').toEqual(['hello world']);
  there.client.say('proximity', 'just us'); there.client.say('room', 'hi back');
  await vi.waitFor(() => { expect(heardHere.map(line => line.text)).toEqual(['hello world', 'hi back']); }, { timeout: 1000, interval: 5 });
  await new Promise(resolve => { setTimeout(resolve, 200); });
  expect(heardHere.map(line => line.text), 'a proximity line never leaves its cell').toEqual(['hello world', 'hi back']);
});

test('a line from another cell can be reported, with what was typed, and the filter ran where it was said', { timeout: 60_000 }, async () => {
  const { here, there, heardThere, reports } = await world(2);
  here.client.say('room', 'you sh1t');
  await vi.waitFor(() => { expect(heardThere).toHaveLength(1); }, { timeout: 1000, interval: 5 });
  expect(heardThere[0]?.text).toBe('you ****');
  there.client.report(heardThere[0]?.line ?? -1);
  await vi.waitFor(() => { expect(reports).toHaveLength(1); }, { timeout: 2000, interval: 5 });
  expect(reports[0]).toMatchObject({ reporter: 'device:there', speaker: 'device:here', name: 'Ann', channel: 'room', typed: 'you sh1t', shown: 'you ****' });
});
