import * as v from 'valibot';
import { installedIdentity } from '../app/identity';
import type { SaveStorage } from '../saves/store';

// P1-E5.2c (J111): who a client says it is, for the first playtest: a device id and a typed Name, no accounts. `player` is
// what the wire keeps, so a real login can claim it later without the wire changing. Nothing proves it yet: the server trusts
// it as far as a device id can be trusted, and never sends one player's id to another.

/** The longest typed Name, in UTF-16 units. */
export const MAX_NAME_LENGTH = 24;
/** What a client says it is at `hello`. */
export interface NetIdentity { readonly player: string; readonly name: string }
/** A client that names nobody: a test, or a page before its Name is typed. */
export const GUEST: NetIdentity = { player: 'guest', name: 'Guest' };
/** An identity fit for the room; the Name is cleaned there, server-side, with chat. */
export const NetIdentitySchema: v.GenericSchema<NetIdentity> = v.strictObject({
  player: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9._:-]{1,128}$/u)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAME_LENGTH)),
});

const Stored = v.strictObject({ player: v.string(), name: v.string() });
/** Outside the save prefix on purpose: SaveStore reads every key under it as a document, and a device id is no save. */
const deviceKey = (prefix: string): string => `device:${prefix}identity`;
function stored(raw: string | null): NetIdentity | null {
  if (raw === null) return null;
  try { return v.parse(NetIdentitySchema, v.parse(Stored, JSON.parse(raw))); } catch { return null; }
}
/** This device's identity, minted once and kept in the page's storage. A Name typed later replaces the Name, never the id. */
export function deviceIdentity(storage: SaveStorage, prefix: string, name?: string): NetIdentity {
  const app = installedIdentity(), stable = app?.savePrefix === prefix ? app.identityPrefix ?? prefix : prefix;
  const key = deviceKey(stable), held = stored(storage.getItem(key)), typed = name?.slice(0, MAX_NAME_LENGTH) ?? '';
  const identity: NetIdentity = { player: held?.player ?? `device:${crypto.randomUUID()}`, name: typed === '' ? held?.name ?? GUEST.name : typed };
  if (held?.player !== identity.player || held.name !== identity.name) storage.setItem(key, JSON.stringify(identity));
  return identity;
}
