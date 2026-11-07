// oxlint-disable-next-line import/no-nodejs-modules -- A body id is a keyed hash of a device id, and only a server holds the key.
import { createHmac } from 'node:crypto';

/** Bytes of the HMAC a body id keeps: 80 bits, far past a room's eight seats. */
const BODY_ID_BYTES = 10;
/**
 * C4: a body's id. `spawn` sends it to everyone in the room and J111's device id is the only credential, so a body id must never be a
 * device id. It is stable across rejoins and says nothing without the server's secret.
 */
export function bodyId(secret: string, device: string): string {
  return `p.${createHmac('sha256', secret).update(device).digest('hex').slice(0, BODY_ID_BYTES * 2)}`;
}
