import { expect, vi } from 'vitest';
import { CHUNK_HALF } from '../../src/shared/engine/core/config';
import { NET_BUTTONS } from '../../src/shared/engine/input/netButtons';
import { GridAssembly } from '../../src/shared/game/grid/assembly';
import { roadName } from '../../src/server/host/dedicated/gridCells';
import { connectOnline, type OnlineShell } from '../../src/client/host/online/shell';
import { roomBench, serverInput, type RoomBench } from './dedicated/roomBench';
import type { RoomBot } from './dedicated/roomBot';

// ZONE-ENTRY ZE10d2 (J352: "same page, same socket"): a world page's gate. At the gate's 0 the page's online shell says `enter`, hears
// `arrive` with the pose past the gate and holds its client (the road's frames name the cell it is leaving); the next session on the
// same page takes the shell over (`rehome`) and says `ready`, and the door seats it past the gate on the socket it already had.
// Staging's 2 workers: Driftwood with Sunscar and Far Reach on one, Nalati alone on the other (dedicated-zone-enter.test.ts).
export const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', WEST, EAST];
export const IDENTITY = { player: 'device:zone', name: 'Zone' }, EDGE = 562.5 - CHUNK_HALF;
export function createEntryFixture() {
  let bench: RoomBench | undefined, shell: OnlineShell | undefined, pump: ReturnType<typeof setInterval> | undefined;
  const observers: RoomBot[] = [];
  async function close(): Promise<void> {
    for (const bot of observers.splice(0)) bot.drop();
    clearInterval(pump);
    shell?.dispose();
    await bench?.close();
    bench = undefined;
    shell = undefined;
  }

  // Each case still boots fresh rooms, native worlds and real sockets. Only the
  // verified immutable product inputs are shared; runtime preparation stays fresh.
  const inputs = new Map<string, ReturnType<typeof serverInput>>();
  async function entryBench(options: Parameters<typeof roomBench>[0]): Promise<RoomBench> {
    bench = await roomBench({ ...options, load: slug => {
      let input = inputs.get(slug);
      if (input === undefined) { input = serverInput(slug); inputs.set(slug, input); }
      return input;
    } });
    return bench;
  }

  /** A seated page at Driftwood, its commands running `yaw` (null stands still), and what the link told it. */
  async function seated(): Promise<{ shell: OnlineShell; steer: (yaw: number | null) => void; regrids: string[]; closes: () => number }> {
    if (bench === undefined) throw new Error('the bench first');
    const regrids: string[] = [], cells = new GridAssembly({ developer: false, devserver: false }).cells.map(cell => cell.instance);
    const page = connectOnline({ socket: bench.url, build: 'bench', loaded: HOME, identity: IDENTITY, gridCell: HOME, gridCells: cells },
      { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined, regrid: cell => { regrids.push(cell); } });
    shell = page;
    let yaw: number | null = null, closes = 0;
    pump = setInterval(() => {
      if (page.client.latest === null) return;
      page.client.command({ viewTick: 0, steer: { keyX: 0, keyY: yaw === null ? 0 : 1, stickX: 0, stickY: 0 }, yaw: yaw ?? 0, pitch: 0, buttons: yaw === null ? 0 : NET_BUTTONS.sprint });
      page.client.flush();
    }, 16);
    await page.booted;
    page.ready();
    await vi.waitFor(() => { expect(bench?.room(HOME)?.holds(IDENTITY.player)).toBe(true); expect(page.client.latest).not.toBeNull(); }, { timeout: 20_000 });
    const transport = (page.client as unknown as { transport: { onClose: (listener: () => void) => void } }).transport;
    transport.onClose(() => { closes++; });
    return { shell: page, steer: next => { yaw = next; }, regrids, closes: () => closes };
  }

  /** Walk across both real boundaries, starting 1 m inside each rather than spending time approaching them. */
  async function toGate(side: -1 | 1, steer: (yaw: number | null) => void): Promise<void> {
    const room = bench, home = room?.room(HOME), road = room?.road(roadName(HOME)), body = home?.bodyOf(IDENTITY.player);
    if (room === undefined || home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
    body.resetPose({ x: side * (CHUNK_HALF - 1), y: 1, z: 0 }, -side * Math.PI / 2);
    steer(-side * Math.PI / 2);
    await vi.waitFor(() => { expect(road.holds(IDENTITY.player), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
    const walker = road.bodyOf(IDENTITY.player);
    if (walker === undefined) throw new Error('the walker stands on the road');
    walker.resetPose({ x: side * (EDGE - 1), y: walker.position.y + 1, z: 0 }, -side * Math.PI / 2);
    await vi.waitFor(() => { expect(side * (road.bodyOf(IDENTITY.player)?.position.x ?? 0), 'into the buffer').toBeGreaterThan(EDGE + 2); }, { timeout: 30_000, interval: 50 });
    steer(null);
  }

  return { entryBench, seated, toGate, observers, close };
}
