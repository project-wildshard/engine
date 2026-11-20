// oxlint-disable-next-line import/no-nodejs-modules -- Metrics keys never leave the room's data store.
import { createHmac } from 'node:crypto';

/** A room seat is an account when signed in, otherwise an anonymous install. */
export function metricPlayerKey(secret: string, seat: string): string {
  return createHmac('sha256', secret).update('metrics\0').update(seat).digest('hex');
}
