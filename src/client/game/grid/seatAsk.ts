// QA 11-23-b row 19 (Jake, ~11:30 Cancún, staging: "Enter MMO should, ask the server where the fuck I am, and then like load the
// correct zone, and like not spawn me in Driftwood, and then not teleport me"). Enter MMO on a world build asks the world's door which
// cell its next join would seat this player in, and the entry boots that cell, so there is one loading screen. The ask is a socket of
// its own with no hello (the door's `where` word, `socketFrames.ts`): no seat is taken, and a clean close counts on the door's word
// budget, as the title's world word does. The title asks once it paints, so a tap usually has the answer already; a tap that
// comes first waits for it behind the loading screen, at most `SEAT_WAIT_MS`. No answer (an older door, no player kept on this
// device, a stall, a refusal) leaves the device's hint (GO5), and the door still moves a wrong guess (GO4).
import { appIdentity } from '@wildshard/engine/app/identity';
import { heldPlayer } from '@wildshard/engine/net/identity';
import { pageLogin, ticketBeforeJoin } from '@wildshard/engine/net/playerLogin';
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import { Scope } from '@wildshard/engine/app/scope';
import { decodeWhereAnswer, encodeWhere, framed, SOCKET_WHERE, SOCKET_WORLD } from '@wildshard/engine/net/socketFrames';

/** The whole ask, release file and socket included: past this the entry goes on without it. */
export const SEAT_ASK_MS = 4000;
/** How long a tap's loading screen waits for an answer still on its way. */
export const SEAT_WAIT_MS = 2500;
/** An answer older than this is asked again (the title stood a while; another device may have played). */
export const SEAT_KEEP_MS = 30_000;

/** The socket surface this needs; a browser `WebSocket`, or a test's. */
export interface SeatSocket {
  binaryType: string;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send: (data: Uint8Array<ArrayBuffer>) => void;
  close: () => void;
}
export interface SeatPorts {
  /** The world's socket address (its signed release file), or undefined for a build with none. */
  readonly socket: (signal: AbortSignal) => Promise<string | undefined>;
  /** What this device's hello would carry (a join ticket while signed in), or null when the device keeps no player yet. */
  readonly player: () => Promise<string | null>;
  readonly open: (url: string) => SeatSocket;
  readonly askMs?: number;
}

/** The door's answer: the cell (a grid instance) it would seat this player in, or null when it said nothing usable. */
export async function askSeat(ports: SeatPorts): Promise<string | null> {
  const abort = new AbortController(), scope = new Scope('grid.seat-ask');
  let socket: SeatSocket | null = null;
  const late = new Promise<null>(resolve => { scope.timeout(ports.askMs ?? SEAT_ASK_MS, () => { abort.abort(); resolve(null); }); });
  const asked = (async (): Promise<string | null> => {
    const player = await ports.player();
    if (player === null || abort.signal.aborted) return null; // a device with no player is new: the home is its place
    const url = await ports.socket(abort.signal);
    if (url === undefined || abort.signal.aborted) return null;
    const open = ports.open(url);
    socket = open;
    open.binaryType = 'arraybuffer';
    return new Promise<string | null>(resolve => {
      open.onclose = () => { resolve(null); };
      open.onerror = () => { resolve(null); };
      open.onmessage = ({ data }) => {
        if (!(data instanceof ArrayBuffer) || data.byteLength < 1) return;
        const prefix = new Uint8Array(data, 0, 1)[0], body = data.slice(1);
        if (prefix === SOCKET_WORLD) {
          let where = false;
          try { const word: unknown = JSON.parse(new TextDecoder().decode(body)); where = typeof word === 'object' && word !== null && (word as { where?: unknown }).where === 1; } catch { /* no word */ }
          // an older door never says `where`, and would close `refused` on a prefix it does not know
          if (!where) { resolve(null); return; }
          open.send(framed(SOCKET_WHERE, encodeWhere({ player })));
        } else if (prefix === SOCKET_WHERE) resolve(decodeWhereAnswer(body)?.cell ?? null);
      };
    });
  })().catch(() => null);
  try { return await Promise.race([asked, late]); }
  finally {
    scope.dispose(); abort.abort();
    const open = socket as SeatSocket | null;
    if (open !== null) { open.onmessage = null; open.onclose = null; open.onerror = null; try { open.close(); } catch { /* already gone */ } }
  }
}

/** This page's ports: the build's world, this device's kept player (its ticket while signed in), the browser's socket. */
export function pageSeatPorts(): SeatPorts {
  return {
    socket: async signal => (await import('../accountDoor')).worldSocket(undefined, fetch, signal),
    player: async () => {
      const storage = saveEnvironment().storage('shard');
      if (storage === null) return null;
      const device = heldPlayer(storage, appIdentity().savePrefix);
      if (device === null) return null;
      return await ticketBeforeJoin(pageLogin(storage), device) ?? device;
    },
    open: url => new WebSocket(url) as unknown as SeatSocket,
  };
}

let kept: { readonly answer: Promise<string | null>; readonly at: number; settled: boolean; cell: string | null } | null = null;
/** Ask now (the title, once it paints), unless an answer younger than `SEAT_KEEP_MS` is kept or on its way. */
export function prefetchSeat(ports: () => SeatPorts = pageSeatPorts, now: () => number = Date.now): void {
  if ((globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ === undefined) return;
  if (kept !== null && now() - kept.at < SEAT_KEEP_MS) return;
  const row: NonNullable<typeof kept> = { answer: askSeat(ports()), at: now(), settled: false, cell: null };
  kept = row;
  void row.answer.then(cell => { row.settled = true; row.cell = cell; return undefined; });
}
/** The answer for a tap: the kept one if settled, else the one on its way for at most `waitMs`; null with none. It is taken: the
 *  next entry asks again. */
export async function seatForEntry(waitMs: number = SEAT_WAIT_MS, ports: () => SeatPorts = pageSeatPorts, now: () => number = Date.now): Promise<string | null> {
  prefetchSeat(ports, now);
  const row = kept;
  kept = null;
  if (row === null) return null;
  if (row.settled) return row.cell;
  const scope = new Scope('grid.seat-wait');
  try { return await Promise.race([row.answer, new Promise<null>(resolve => { scope.timeout(waitMs, () => { resolve(null); }); })]); }
  finally { scope.dispose(); }
}
/** The kept answer if it has come and is fresh, without taking it (the tap's first guess, so its read starts on the right zone). */
export function settledSeat(now: () => number = Date.now): string | null {
  return kept !== null && kept.settled && now() - kept.at < SEAT_KEEP_MS ? kept.cell : null;
}
/** Tests: forget the kept answer. */
export function forgetSeat(): void { kept = null; }
