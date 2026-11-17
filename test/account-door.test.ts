import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import { worldDoor } from '../src/client/game/accountDoor';

// MMO-PLAN MP2.5c: the ACCOUNT card asks the world's own door for the player's saves, and sends it a join ticket, so the door is read
// from the signed release file and believed only when the signature holds.
const { privateKey, publicKey } = generateKeyPairSync('ed25519'), key = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const file = (body: object, signer = privateKey): string => { const text = JSON.stringify(body); return JSON.stringify({ body: text, signature: sign(null, Buffer.from(text), signer).toString('hex') }); };
const serve = (text: string): typeof fetch => () => Promise.resolve(new Response(text));
const stamp = { release: 'https://packs.test/releases/staging.json', key };

test('the door is the signed release\'s rooms host over https; a build with no world has none', async () => {
  expect(await worldDoor(stamp, serve(file({ socket: 'wss://rooms-staging.wildshard.io/' })))).toBe('https://rooms-staging.wildshard.io');
  expect(await worldDoor(undefined, serve('{}'))).toBeUndefined();
});

test('a file another key signed, or one naming no socket, is never believed', async () => {
  await expect(worldDoor(stamp, serve(file({ socket: 'wss://evil.test/' }, generateKeyPairSync('ed25519').privateKey)))).rejects.toThrow(/signature/u);
  await expect(worldDoor(stamp, serve(file({})))).rejects.toThrow(/door/u);
});
