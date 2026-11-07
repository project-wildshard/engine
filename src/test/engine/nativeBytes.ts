// oxlint-disable-next-line import/no-nodejs-modules -- Only the Node test project reads immutable native fixture payloads.
import { readFileSync } from 'node:fs';

/** Read an immutable author payload for native byte-comparison fixtures. */
export function fixtureBytes(file: URL): Uint8Array { return new Uint8Array(readFileSync(file)); }
