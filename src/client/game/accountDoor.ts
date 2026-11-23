import * as v from 'valibot';
import { doorOf } from '@wildshard/engine/net/playerLogin';

// MMO-PLAN MP2.5c: the door a signed-in player's saves live behind, for the ACCOUNT card's Download my data and Delete account. It
// is the world's own address, read from the signed release file the build names (`__WS_WORLD__`), and believed only once the
// signature holds: the join ticket goes there. A build with no world has no door; one whose release can't be read throws, so the
// card says try again rather than deleting the account with its saves left behind.

interface WorldStamp { readonly release: string; readonly key: string }
/** Only what this reads of the signed file (`shared/host/releaseRows.ts` has the whole shape; the game layer can't import it). */
const Signed = v.object({ body: v.string(), signature: v.pipe(v.string(), v.regex(/^[0-9a-f]{128}$/u)) });
const Body = v.object({ socket: v.optional(v.string()) });
const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => Uint8Array.from(hex.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));

/** The world's socket address for this build, from its signed release file; undefined when the build has none. */
export async function worldSocket(stamp: WorldStamp | undefined = (globalThis as { __WS_WORLD__?: WorldStamp }).__WS_WORLD__, read: typeof fetch = fetch, signal?: AbortSignal): Promise<string | undefined> {
  if (stamp === undefined) return undefined;
  const signed = v.parse(Signed, await (await read(stamp.release, { cache: 'no-store', ...(signal === undefined ? {} : { signal }) })).json());
  const key = await crypto.subtle.importKey('spki', hexBytes(stamp.key), { name: 'Ed25519' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'Ed25519' }, key, hexBytes(signed.signature), new TextEncoder().encode(signed.body))) throw new Error('The release file has a bad signature');
  return v.parse(Body, JSON.parse(signed.body)).socket;
}

/** The door's HTTP origin for this build's world; undefined when the build has none. */
export async function worldDoor(stamp: WorldStamp | undefined = (globalThis as { __WS_WORLD__?: WorldStamp }).__WS_WORLD__, read: typeof fetch = fetch): Promise<string | undefined> {
  if (stamp === undefined) return undefined;
  const socket = await worldSocket(stamp, read);
  const door = socket === undefined ? undefined : doorOf(socket);
  if (door === undefined) throw new Error('The release file names no door');
  return door;
}
