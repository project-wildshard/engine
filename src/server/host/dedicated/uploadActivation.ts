/** SP20c2: a local game acknowledges a verified pack and completed placement opening. */
// oxlint-disable-next-line import/no-nodejs-modules -- Constant-time local receiver credential comparison.
import {createHash, timingSafeEqual} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Compose with the existing internal game HTTP server.
import type {IncomingMessage, ServerResponse} from 'node:http';
import * as v from 'valibot';
import {UploadActivationSchema, type UploadActivation, type UploadActivationAck} from '@wildshard/engine/game/shardfile/uploadActivation';
import type {PlacementFile} from '@wildshard/engine/game/grid/placementRows';
import type {PlacedCell} from './gridCells';

export interface UploadActivationPorts {
  readonly channel: string;
  readonly build: string;
  readonly read: () => Promise<PlacementFile>;
  /** Must select the cook index for this exact raw hash even if the release book holds an older slug. */
  readonly preload: (slug: string, hash: string) => Promise<void>;
  readonly place: (row: PlacedCell) => void;
  readonly open: (instances: readonly string[]) => Promise<readonly string[]>;
  readonly opened: (instance: string) => boolean;
}
/** Revalidate signed placement on every retry; a stale KV document cannot earn acknowledgement. */
export function uploadActivator(ports: UploadActivationPorts): (notice: UploadActivation) => Promise<UploadActivationAck> {
  let seen = -1;
  return async notice => {
    if (notice.channel !== ports.channel) throw new Error('Wrong activation channel');
    const placement = await ports.read();
    if (placement.channel !== ports.channel || placement.serial < seen) throw new Error('Stale activation placement');
    seen = placement.serial;
    const rows = placement.cells.filter(row => new Set([notice.slug]).has(row.slug));
    if (rows.length === 0 || rows.some(row => row.hash !== notice.hash)) throw new Error('Placement does not publish the upload hash');
    await ports.preload(notice.slug, notice.hash);
    for (const row of rows) ports.place(row);
    const instances = rows.map(row => row.instance);
    await ports.open(instances);
    if (instances.some(instance => !ports.opened(instance))) throw new Error('Upload placement has not opened');
    // Existing occupied rooms keep their normal lifetime; new rooms can use the verified preloaded product.
    return {...notice, build: ports.build, preloaded: true, instances};
  };
}

const same = (given: string, expected: string): boolean => timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
/** Handles only this internal route. No new port or public reverse-proxy route is needed. */
export function uploadActivationReceiver(token: string, activate: (notice: UploadActivation) => Promise<UploadActivationAck>): (request: IncomingMessage, response: ServerResponse) => boolean {
  if (token.length < 32) throw new Error('The game activation token is too short');
  return (request, response) => {
    if (request.url !== '/internal/upload-activation' || request.method !== 'POST') return false;
    const send = (status: number, value: unknown): void => {response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(value));};
    if (!new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']).has(request.socket.remoteAddress ?? '')) {send(403, {error: 'local receiver only'}); return true;}
    if (!same(request.headers.authorization ?? '', `Bearer ${token}`)) {send(401, {error: 'bad activation token'}); return true;}
    void (async (): Promise<void> => {
      let text = '';
      try {
        request.setEncoding('utf8');
        for await (const chunk of request as AsyncIterable<string>) {
          text += chunk; if (Buffer.byteLength(text) > 4096) {send(413, {error: 'activation too large'}); return;}
        }
        const notice = v.safeParse(UploadActivationSchema, JSON.parse(text));
        if (!notice.success) {send(400, {error: 'bad activation notice'}); return;}
        try {send(200, await activate(notice.output));} catch {send(503, {error: 'activation not ready'});}
      } catch {send(400, {error: 'bad activation body'});}
    })();
    return true;
  };
}
