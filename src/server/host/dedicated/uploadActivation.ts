/** SP20c2: a local game acknowledges a verified pack and completed placement opening. */
// oxlint-disable-next-line import/no-nodejs-modules -- Constant-time local receiver credential comparison.
import {createHash, timingSafeEqual} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Compose with the existing internal game HTTP server.
import type {IncomingMessage, ServerResponse} from 'node:http';
import * as v from 'valibot';
import {UploadActivationSchema, type UploadActivation, type UploadActivationAck} from '@wildshard/engine/game/shardfile/uploadActivation';
import type {PlacementFile} from '@wildshard/engine/game/grid/placementRows';
import {refuseProductionDebug} from '@wildshard/engine/game/shardfile/productionDebug';
import type {PlacedCell} from './gridCells';

export interface UploadActivationPorts {
  readonly channel: string;
  readonly build: string;
  readonly read: () => Promise<PlacementFile>;
  /** Must select the cook index for this exact raw hash even if the release book holds an older slug. It hands back the
   * product's `client/plan` section, if it has one, for the production debug refusal (OF18c). */
  readonly preload: (slug: string, hash: string, shardVersion?: string) => Promise<{ readonly clientPlan?: unknown; readonly shardVersion?: string } | undefined>;
  /** `file`: every cell the signed file names, so the row keeps its place in it (MA10k). */
  readonly place: (row: PlacedCell, file: readonly PlacedCell[]) => void;
  readonly open: (instances: readonly string[]) => Promise<readonly string[]>;
  readonly opened: (instance: string) => boolean;
  /** The build's own catalogue cell for an uploaded slug. The signed file names only the cells the baked grid lacks (api-server
   *  `placementCells`), so an upload of a catalogue slug moves this cell's hash instead of waiting for a row that never comes. */
  readonly catalogue?: (slug: string) => PlacedCell | undefined;
}
/** Revalidate signed placement on every retry; a stale KV document cannot earn acknowledgement. */
export function uploadActivator(ports: UploadActivationPorts): (notice: UploadActivation) => Promise<UploadActivationAck> {
  let seen = -1;
  return async notice => {
    if (notice.channel !== ports.channel) throw new Error('Wrong activation channel');
    const placement = await ports.read();
    if (placement.channel !== ports.channel || placement.serial < seen) throw new Error('Stale activation placement');
    seen = placement.serial;
    const listed = placement.cells.filter(row => new Set([notice.slug]).has(row.slug));
    // 2026-11-19: staging withheld every catalogue slug's upload for 14 h; the file never lists them, the baked grid holds them.
    const own = listed.length === 0 && notice.place !== false ? ports.catalogue?.(notice.slug) : undefined;
    const rows: readonly PlacedCell[] = own === undefined ? listed : [{...own, hash: notice.hash}];
    if ((rows.length === 0 && notice.place !== false) || rows.some(row => row.hash !== notice.hash)) throw new Error('Placement does not publish the upload hash');
    const shardVersion = rows[0]?.shardVersion;
    const loaded = shardVersion === undefined ? await ports.preload(notice.slug, notice.hash)
      : await ports.preload(notice.slug, notice.hash, shardVersion);
    if (ports.channel === 'production') refuseProductionDebug(loaded?.clientPlan);
    for (const row of rows) ports.place(loaded?.shardVersion === undefined ? row : {...row, shardVersion: loaded.shardVersion}, placement.cells);
    const instances = rows.map(row => row.instance);
    await ports.open(instances);
    if (instances.some(instance => !ports.opened(instance))) throw new Error('Upload placement has not opened');
    // F48: an open room of this slug starts over on the preloaded product once no live player is in it (`cellHost.ts`).
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
        try {send(200, await activate(notice.output));} catch (error) {send(503, {error: 'activation not ready', reason: error instanceof Error ? error.message : String(error)});}
      } catch {send(400, {error: 'bad activation body'});}
    })();
    return true;
  };
}
