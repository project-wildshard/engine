import { expect, vi } from 'vitest';
import type { DedicatedRoom } from '../../../src/server/host/dedicated/dedicatedRoom';
import { roomBench, type RoomBench } from './roomBench';
import { RoomBot } from './roomBot';
import { tcpPuller, type TcpPuller } from '../tcpPuller';

export const HOLD_DEVICE = 'device:a', OTHER_DEVICE = 'device:b', HOLD_HIT = 10;
const SHARD = 'driftwood-isle';
type Body = NonNullable<ReturnType<DedicatedRoom['bodyOf']>>;
interface HoldBench {
  readonly bench: RoomBench;
  readonly puller: TcpPuller;
  readonly through: string;
  readonly a: RoomBot;
  readonly b: RoomBot;
  readonly room: DedicatedRoom;
  readonly body: Body;
  readonly full: number;
  readonly stood: ReturnType<Body['position']['clone']>;
  readonly join: (url: string, device: string, ledger?: number) => Promise<RoomBot>;
  readonly close: () => Promise<void>;
  /** The room's hold and checkpoint clock, in ms. Ticks, sockets and silence detection keep real time. */
  readonly roomNow: () => number;
  /** Move the room's clock to `ms` after `from` on that clock: the outage's idle seconds pass at once. */
  readonly roomAt: (from: number, ms: number) => void;
  /** Resolve once the room has run its hold and checkpoint check twice on the current clock. */
  readonly roomChecked: () => Promise<void>;
}
export const holdSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
export const holdUntil = (done: () => boolean, timeout = 40_000): Promise<void> => vi.waitFor(() => { expect(done()).toBe(true); }, { timeout, interval: 20 });
export function heldBody(room: DedicatedRoom): Body {
  const body = room.bodyOf(HOLD_DEVICE);
  if (body === undefined) throw new Error('No body');
  return body;
}
/** Each real-clock branch owns a fresh room, TCP proxy and two real clients. */
export async function openHoldBench(): Promise<HoldBench> {
  let skew = 0;
  const roomNow = (): number => performance.now() + skew;
  const bench = await roomBench({ roomNow }), bots: RoomBot[] = [];
  const roomAt = (from: number, ms: number): void => { const ahead = from + ms - roomNow(); expect(ahead, 'the room clock only moves forward').toBeGreaterThanOrEqual(0); skew += ahead; };
  let puller: TcpPuller | undefined;
  const close = async (): Promise<void> => {
    for (const bot of bots.splice(0)) bot.drop();
    await puller?.close(); await bench.close();
  };
  const join = async (url: string, device: string, ledger = 0): Promise<RoomBot> => {
    const bot = new RoomBot(url, 'bench', device, device, ledger); bots.push(bot);
    expect(await bot.arrived()).toBe(true); return bot;
  };
  try {
    puller = await tcpPuller(bench.url.replace(/\/$/u, ''));
    const through = `${puller.url}/`, a = await join(through, HOLD_DEVICE), b = await join(bench.url, OTHER_DEVICE);
    const room = bench.room(SHARD);
    if (room === undefined) throw new Error('No room');
    const body = heldBody(room);
    room.cell.owned.of(body.id).file({ grant: 'coins', name: 'coins', amount: 9 });
    room.cell.owned.of(body.id).file({ grant: 'item', name: 'cape', amount: 1 });
    body.resetPose({ x: body.position.x + 2, y: body.position.y + 0.3, z: body.position.z }, 0);
    await holdSleep(300);
    // The room checks holds every CHECK_TICKS (30) ticks: 60 ticks after a clock move, two checks have seen it.
    const roomChecked = async (): Promise<void> => { const from = room.host.state.tick; await holdUntil(() => room.host.state.tick >= from + 60, 10_000); };
    return { bench, puller, through, a, b, room, body, full: body.health.attributes.health,
      stood: body.position.clone(), join, close, roomNow, roomAt, roomChecked };
  } catch (error) { await close(); throw error; }
}
