// E7.2d: a page's read of the signed release file (J171): the build the world runs and the address to dial. WebCrypto's Ed25519, so no
// signature code ships in the client. A page believes nothing in the file before its signature holds.
import * as v from 'valibot';
import { ReleaseSchema, SignedSchema, type ReleaseFile } from '../../../shared/host/releaseRows';

const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => Uint8Array.from(hex.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));

/** A browser with no Ed25519 can't read the file, so a player is told what to do. Chrome 133 and 134 on Android stop here (E7.9). */
const importKey = async (publicKey: string): Promise<CryptoKey> => {
  try { return await crypto.subtle.importKey('spki', hexBytes(publicKey), { name: 'Ed25519' }, false, ['verify']); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotSupportedError') throw new Error('This browser is too old for the online world. Update it to Chrome 137 or Safari 17, or newer.', { cause: error });
    throw error;
  }
};

/** The file's text as what it says. It throws on a bad signature, and where a browser has no Ed25519. `publicKey` is SPKI DER in hex. */
export async function readSignedRelease(text: string, publicKey: string): Promise<ReleaseFile> {
  const signed = v.parse(SignedSchema, JSON.parse(text)), key = await importKey(publicKey);
  if (!await crypto.subtle.verify({ name: 'Ed25519' }, key, hexBytes(signed.signature), new TextEncoder().encode(signed.body))) throw new Error('A release file has a bad signature');
  return v.parse(ReleaseSchema, JSON.parse(signed.body));
}
/** The release file at `url`, never from a cache: a stale one would dial an old address. */
export async function fetchSignedRelease(url: string, publicKey: string): Promise<ReleaseFile> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`No release file at ${url}: ${String(response.status)}`);
  return readSignedRelease(await response.text(), publicKey);
}
