// SERVER-PARITY SS5: Pine's hollow-log secret on the server. The page projected `secret` on `pine.life` and raised `secret:log`
// in its own flags only, so in a room "Find the 3 secrets" never finished. A room player who stands inside the hollow log now
// finds it in their own book, and a player elsewhere doesn't.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

const FLAG = 'secret:log';

test('a room player who enters the hollow log finds its secret in their own book', { timeout: 120_000 }, async () => {
  const directory = builtProduct('pine-hollow'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const { secret } = await product.json<{ readonly secret: { readonly mid: readonly [number, number, number]; readonly floorY: number } }>('quests/forest-story.json');
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  try {
    const { host } = live, lead = leadPlayer(host), books = questBooks(host), [x, , z] = secret.mid;
    const away = { x: x + 40, z: z + 40 }, other = host.addPlayer('bot:1', { x: away.x, y: host.groundHeightAt(away.x, away.z) + 0.2, z: away.z });
    const stand = (): void => {
      lead.resetPose({ x, y: secret.floorY + 0.1, z }, 0);
      other.resetPose({ x: away.x, y: host.groundHeightAt(away.x, away.z) + 0.2, z: away.z }, 0);
    };
    expect(books.of(lead.id).flags.has(FLAG)).toBe(false);
    for (let tick = 0; tick < 240 && !books.of(lead.id).flags.has(FLAG); tick++) { stand(); live.step([]); }
    expect(books.of(lead.id).flags.has(FLAG), 'the player inside the log found it').toBe(true);
    expect(books.of(other.id).flags.has(FLAG), 'a player elsewhere did not').toBe(false);
    for (let tick = 0; tick < 240 && !books.of(other.id).flags.has(FLAG); tick++) { other.resetPose({ x, y: secret.floorY + 0.1, z }, 0); live.step([]); }
    expect(books.of(other.id).flags.has(FLAG), 'the second player finds it on their own visit').toBe(true);
  } finally { live.dispose(); }
});
