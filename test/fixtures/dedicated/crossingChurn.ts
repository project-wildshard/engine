import { vi } from 'vitest';
import { CHUNK_HALF } from '../../../src/shared/engine/core/config';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { decodeArrive, decodeEnter, encodeEnter, type ArriveWord, type EnterWord } from '../../../src/shared/engine/net/socketFrames';
import { OWNED_ROW } from '../../../src/shared/game/loot/ownedRows';
import { BUFFER_DEPTH } from '../../../src/shared/game/grid/zoneWalls';
import { cellFrame, roadName } from '../../../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../../../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './roomBench';
import { RoomBot, stillThumb, type BotThumb } from './roomBot';

// MMO-PLAN MP1.6: crossings under bots, inside a worker and between workers, lose or double no player, item or grant. Staging's table
// with 2 workers puts Nalati alone on worker 0 and Driftwood with Sunscar on worker 1, so on one east-west line Sunscar (-1, 0) ↔
// Driftwood (0, 0) is a move inside a worker and Driftwood ↔ Nalati (1, 0) one between workers. Every leg is a real crossing on the
// player's one socket: run out of the cell's entryway onto its worker's road (the cell hands the seat to the road), stand in the next
// cell's buffer, say `enter`, hear `arrive`, say `ready`, and the door moves the seat in (`handOver` on one worker, `handOut` and
// `arrive` onto another). Each visit pays one coin into that shard's bag before leaving, and each arrival checks the bag it loaded.
export const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', WEST, EAST] as const;
/** Cell centres on one line at staging's pitch, in the world's (and every road's) frame. */
const PITCH = 562.5, CENTRE: Readonly<Record<string, number>> = { [WEST]: -PITCH, [HOME]: 0, [EAST]: PITCH };
/** Running: east is yaw -π/2 (the motor faces atan2(own - target)), west π/2. */
const run = (side: -1 | 1): BotThumb => () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -side * Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

export interface ChurnOptions {
  /** How many crossings in all (each leg out onto a road and each gate entry counts one). */
  readonly crossings: number;
  /** How many bots cross at once; two more stand still, one in Driftwood and one in Nalati, for the whole run. */
  readonly bots: number;
  /** Each walker's command `seq` once seated, as if it had played this long (a u16: past 0x8000 a fresh queue's 0 reads as ahead of it). */
  readonly startSeq?: number;
  readonly log?: (line: string) => void;
}
export interface ChurnReport {
  readonly crossings: number; readonly inside: number; readonly between: number; readonly roadExits: number;
  readonly retries: number; readonly ms: number; readonly bots: number;
  /** The fewest and most seats the door counted while sampling: both must stay the bot count. */
  readonly seatsMin: number; readonly seatsMax: number;
  /** Times a device was held by no room or by two at once, sampled between legs. */
  readonly lost: number; readonly doubled: number;
  /** Bag reads on arrival that disagreed with the coins paid in that shard. */
  readonly bagMismatches: readonly string[];
  readonly socketCloses: number; readonly refused: readonly EnterWord[]; readonly crashes: number;
  readonly movedLines: number; readonly unmovedLines: number; readonly crossRefusals: number;
}

interface Walker { readonly device: string; readonly bot: RoomBot; readonly arrivals: ArriveWord[]; readonly answers: EnterWord[]; closes: number; cell: string; fromDriftwood: number }

export async function crossingChurn(options: ChurnOptions): Promise<ChurnReport> {
  const saves = memoryPlayerSaves(), started = performance.now();
  const bench: RoomBench = await roomBench({ cells: [...CELLS], workers: 2, crossing: true, saves, holdMs: 50,
    // Every bot dials from this one address: the door's per-address caps would stop the fifth.
    socketsPerIp: 64, connectsPerMinute: 600 });
  const bots: RoomBot[] = [], log = options.log ?? ((): void => undefined);
  const counts = { crossings: 0, inside: 0, between: 0, roadExits: 0, retries: 0, lost: 0, doubled: 0, seatsMin: Infinity, seatsMax: -Infinity };
  const paid = new Map<string, number>(), bagMismatches: string[] = [], refused: EnterWord[] = [];
  const rooms = (): { readonly name: string; readonly holds: (device: string) => boolean }[] => [
    ...CELLS.flatMap(cell => { const room = bench.room(cell); return room === undefined ? [] : [{ name: cell, holds: (device: string) => room.holds(device) }]; }),
    ...[HOME, EAST].flatMap(cell => { const road = bench.road(roadName(cell)); return road === undefined ? [] : [{ name: road.name, holds: (device: string) => road.holds(device) }]; }),
  ];
  const holders = (device: string): string[] => rooms().filter(room => room.holds(device)).map(room => room.name);
  let sampler: ReturnType<typeof setInterval> | undefined;
  try {
    const join = async (device: string): Promise<Walker> => {
      const bot = new RoomBot(bench.url, 'bench', device, device); bots.push(bot);
      if (!await bot.arrived(60_000)) throw new Error(`${device} never arrived`);
      if (options.startSeq !== undefined) Reflect.set(bot.client, 'seq', options.startSeq);
      const walker: Walker = { device, bot, arrivals: [], answers: [], closes: 0, cell: HOME, fromDriftwood: 0 };
      bot.transport.onControl((control, bytes) => {
        if (control === 'enter') { const word = decodeEnter(bytes); if (word !== null) walker.answers.push(word); }
        if (control === 'arrive') { const word = decodeArrive(bytes); if (word !== null) walker.arrivals.push(word); }
      });
      bot.transport.onClose(() => { walker.closes++; });
      return walker;
    };
    // Bystanders: one stands in Driftwood the whole run, and one in Nalati (a fresh device lands in the first cell, Driftwood).
    const still = [await join('device:still-home')];
    const walkers: Walker[] = [];
    for (let index = 0; index < options.bots; index++) walkers.push(await join(`device:walker-${String(index)}`));
    const parked = await join('device:still-east');
    const seats = (): number => bench.world.health().players;
    sampler = setInterval(() => { const n = seats(); counts.seatsMin = Math.min(counts.seatsMin, n); counts.seatsMax = Math.max(counts.seatsMax, n); }, 25);
    /** One whole leg: out of `walker.cell` on `side` onto its worker's road, into `to`'s buffer, `enter`, `ready`, seated in `to`. */
    const leg = async (walker: Walker, to: string, side: -1 | 1): Promise<void> => {
      const from = walker.cell, room = bench.room(from), body = room?.bodyOf(walker.device), road = bench.road(roadName(from === EAST ? EAST : HOME));
      if (room === undefined || body === undefined || road === undefined) throw new Error(`${walker.device} has no body in ${from}`);
      // Pay into this shard's bag, then leave at once: a grant the crossing races must still land in the save.
      room.cell.owned.of(body.id).file({ grant: 'coins', name: 'coins', amount: 1 });
      paid.set(`${walker.device}\0${from}`, (paid.get(`${walker.device}\0${from}`) ?? 0) + 1);
      // Each leg starts whole: Nalati's herd may have been at the walker while it stood; a fight is not what this run measures.
      body.health.attributes.health = body.health.attributes.maxHealth;
      // From the entryway 5 m inside the edge (an arrival stands 14 m in on the side it came from), running out.
      body.resetPose({ x: side * (CHUNK_HALF - 5), y: Math.max(body.position.y, 1) + 0.5, z: 0 }, -side * Math.PI / 2);
      walker.bot.thumb = run(side);
      await vi.waitFor(() => { if (!road.holds(walker.device)) throw new Error('not yet'); }, { timeout: 30_000, interval: 10 }).catch(() => {
        const stuck = room.bodyOf(walker.device), feet = stuck?.position;
        // what holds a body still: its own flat state, its seat (a linked transport?) and the bot's input
        const flat = stuck === undefined ? {} : Object.fromEntries(Object.entries(stuck).filter(([, value]) => ['number', 'boolean', 'string'].includes(typeof value)));
        const seat = (room as unknown as { seats: Map<string, { transport: unknown; asked?: string; askedAt?: number; holdEnds: number | null }> }).seats.get(walker.device);
        const state = { flat, seat: seat === undefined ? null : { linked: seat.transport !== null, asked: seat.asked, askedAt: seat.askedAt, holdEnds: seat.holdEnds }, tick: room.host.state.tick,
          clients: (room.net as unknown as { clients: { id: number; state: string; ack: number; player: { id?: unknown }; queue: Record<string, unknown> }[] }).clients.map(row => ({ id: row.id, state: row.state, ack: row.ack, player: row.player.id,
            queue: Object.fromEntries(Object.entries(row.queue).filter(([, value]) => typeof value !== 'object' || value === null).concat([['length', (row.queue as { queue?: unknown[] }).queue?.length]])) })),
          botSeq: (walker.bot.client as unknown as { seq: number }).seq, unacked: (walker.bot.client as unknown as { unacked: unknown[] }).unacked.length };
        throw new Error(`${walker.device} onto ${road.name} from ${from}, feet ${feet === undefined ? 'gone' : `${feet.x.toFixed(2)},${feet.y.toFixed(2)},${feet.z.toFixed(2)}`}, alive ${String(stuck?.health.alive)}, hp ${String(stuck?.health.attributes.health)}, ${JSON.stringify(state)}: ${why(walker)}`);
      });
      walker.bot.thumb = stillThumb;
      counts.crossings++; counts.roadExits++;
      check(walker.device, road.name);
      // Into `to`'s buffer, halfway between its edge and its gate, facing in.
      const edge = CENTRE[to] ?? 0, near = -side * CHUNK_HALF + edge, walker2 = road.bodyOf(walker.device);
      if (walker2 === undefined) throw new Error(`${walker.device} stands on no road`);
      const arrivals = walker.arrivals.length;
      for (let attempt = 0; ; attempt++) {
        walker2.resetPose({ x: near + side * BUFFER_DEPTH / 2, y: walker2.position.y + 0.5, z: 0 }, -side * Math.PI / 2);
        await sleep(50);
        const answered = walker.answers.length;
        walker.bot.transport.control('enter', encodeEnter({ cell: to }));
        try {
          await vi.waitFor(() => { if (walker.arrivals.length === arrivals && walker.answers.length === answered) throw new Error('no answer'); }, { timeout: 10_000, interval: 10 });
        } catch { throw new Error(`${walker.device}: no answer to enter ${to}`); }
        if (walker.arrivals.length > arrivals) break;
        const no = walker.answers.at(-1);
        if (no !== undefined) refused.push(no);
        counts.retries++;
        if (attempt >= 3) throw new Error(`${walker.device}: enter ${to} refused ${JSON.stringify(walker.answers.slice(answered))}`);
      }
      walker.bot.transport.control('ready');
      const target = bench.room(to);
      if (target === undefined) throw new Error(`${to} boots`);
      await vi.waitFor(() => { if (!target.holds(walker.device) || road.holds(walker.device)) throw new Error('not yet'); }, { timeout: 30_000, interval: 10 })
        .catch(() => { throw new Error(`${walker.device} into ${to}: ${why(walker)}`); });
      counts.crossings++;
      if ((from === EAST) !== (to === EAST)) counts.between++; else counts.inside++;
      walker.cell = to;
      check(walker.device, to);
      // The bag it loaded in `to` holds every coin paid there before, no more and no fewer.
      const arrived = target.bodyOf(walker.device), want = paid.get(`${walker.device}\0${to}`) ?? 0;
      const have = arrived === undefined ? -1 : target.cell.owned.of(arrived.id).purse.coins;
      if (have !== want) bagMismatches.push(`${walker.device} in ${to}: ${String(have)} coins, paid ${String(want)}`);
      await vi.waitFor(() => { if (walker.bot.client.latest?.cell !== cellFrame(to)) throw new Error(`${walker.device} hears ${to}'s frames`); }, { timeout: 10_000, interval: 10 });
      if (walker.bot.coins(OWNED_ROW.coins) !== want) await vi.waitFor(() => { if (walker.bot.coins(OWNED_ROW.coins) !== want) throw new Error('coins'); }, { timeout: 5000, interval: 10 }).catch(() => { bagMismatches.push(`${walker.device} in ${to}: the page reads ${String(walker.bot.coins(OWNED_ROW.coins))} coins, paid ${String(want)}`); });
    };
    /** What the door, the rooms and the page said about a walker, for a leg that stalls. */
    const why = (walker: Walker): string => JSON.stringify({ holders: holders(walker.device), entering: [HOME, EAST].map(cell => bench.road(roadName(cell))?.entering(walker.device) ?? null),
      answers: walker.answers.slice(-3), arrivals: walker.arrivals.slice(-2), frame: walker.bot.client.latest?.cell, closed: walker.bot.closed,
      lines: bench.lines.filter(line => line['device'] === walker.device).slice(-6) });
    const check = (device: string, at: string): void => {
      const held = holders(device);
      if (held.length === 0) counts.lost++;
      if (held.length > 1) counts.doubled++;
      if (held.length !== 1 || held[0] !== at) log(`${device} held by [${held.join(', ')}], expected ${at}`);
    };
    // The parked walker goes to Nalati and stays there.
    await leg(parked, EAST, 1);
    let next = 0;
    const share = async (walker: Walker): Promise<void> => {
      while (counts.crossings < options.crossings) {
        // Driftwood alternates east (Nalati, another worker) and west (Sunscar, its own worker); each comes back the way it went.
        if (walker.cell === HOME) { const east = walker.fromDriftwood++ % 2 === 0; await leg(walker, east ? EAST : WEST, east ? 1 : -1); }
        else await leg(walker, HOME, walker.cell === EAST ? -1 : 1);
        if (++next % 200 === 0) log(`${String(counts.crossings)} crossings, ${String(Math.round((performance.now() - started) / 1000))} s`);
      }
    };
    await Promise.all(walkers.map(walker => share(walker)));
    clearInterval(sampler); sampler = undefined;
    // The bystanders never moved and never lost their link.
    for (const [walker, at] of [[still[0], HOME], [parked, EAST]] as const) if (walker !== undefined) check(walker.device, at);
    const lines = bench.lines;
    return {
      ...counts, ms: Math.round(performance.now() - started), bots: bots.length, bagMismatches, refused,
      socketCloses: [...walkers, parked].reduce((sum, walker) => sum + walker.closes, 0) + still.reduce((sum, walker) => sum + walker.closes, 0),
      crashes: bench.crashes.length,
      movedLines: lines.filter(line => line['at'] === 'cell.crossed' && line['moved'] === true).length,
      unmovedLines: lines.filter(line => line['at'] === 'cell.crossed' && line['moved'] !== true).length,
      crossRefusals: lines.filter(line => line['at'] === 'cell.cross-refused').length,
    };
  } finally {
    if (sampler !== undefined) clearInterval(sampler);
    for (const bot of bots) bot.drop();
    await bench.close();
  }
}
