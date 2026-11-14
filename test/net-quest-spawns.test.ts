// A quest's declared spawns on the server: what `installDeclaredQuestSpawns` ran on a page and the flip deletes. Pine's millrace wakes, ends
// on its last thrall, and raises its flag in the player's book, once, and it says its cues for a page to play. `quest-spawn-capability` holds
// the page's half: the cues, and the toast and sting on the flag's rise.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { spawnCueWord } from '../src/shared/game/shardfile/wirePrompts';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

const RACE = { x: -181, z: -144 }, WAKE = 2;

test('the millrace runs on the server: its thralls wake, its last fall raises the flag in the book, once, and a done errand never races again', { timeout: 120_000 }, async () => {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  try {
    const { host } = live, lead = leadPlayer(host), { flags } = questBooks(host).of(lead.id), raised: string[] = [], said: number[] = [];
    const heard = shardRows(host).calls, push = heard.push.bind(heard); // a room empties these each tick
    heard.push = (...calls) => { for (const call of calls) if (call.name === spawnCueWord('pine.night')) said.push(call.args[0] ?? 0); return push(...calls); };
    flags.onChange((flag, on) => { if (flag === 'errand:done') raised.push(String(on)); });
    host.events.answer('damage.modify', request => request?.target === lead.health ? null : request, host.scope);
    await host.dayClock?.set(0.9);
    const stand = (): void => { lead.resetPose({ x: RACE.x, y: host.groundHeightAt(RACE.x, RACE.z) + 0.2, z: RACE.z }, 0); };
    const thralls = () => [...host.entities.values()].filter(body => body.variant === 'thrall' && body.alive && Math.hypot(body.position.x - RACE.x, body.position.z - RACE.z) < 40);
    flags.set('errand:asked');
    for (let tick = 0; tick < 600 && thralls().length < 3; tick++) { stand(); live.step([]); }
    expect(thralls().length, 'the race woke').toBeGreaterThanOrEqual(3);
    expect(flags.has('errand:done')).toBe(false);
    const near = thralls()[0]; if (near === undefined) throw new Error('No thrall');
    for (let tick = 0; tick < 240 && !said.includes(WAKE); tick++) { lead.resetPose({ x: near.position.x + 4, y: near.position.y + 0.2, z: near.position.z }, 0); live.step([]); }
    expect(said, 'a thrall that wakes says so, for a page to play').toContain(WAKE);
    for (let tick = 0; tick < 1800 && !flags.has('errand:done'); tick++) {
      stand();
      for (const body of thralls()) host.combat.hit({ source: lead.health, sourceTags: ['actor.player'], target: body.combatActor(), amount: 9000, point: body.position.clone(), dir: new Vector3(0, 0, 1), throughWalls: true });
      live.step([]);
    }
    expect(flags.has('errand:done')).toBe(true);
    for (let tick = 0; tick < 300; tick++) { stand(); live.step([]); }
    expect(raised, 'it ends once').toEqual(['true']);
    expect(thralls(), 'a done errand never races again').toEqual([]);
  } finally { live.dispose(); }
});
