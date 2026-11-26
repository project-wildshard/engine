import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../../../src/client/engine/net/client';
import { WebSocketTransport } from '../../../src/client/engine/net/webSocketTransport';
import type { SocketCloseInfo } from '../../../src/shared/engine/net/socketClose';
import type { GotoWord } from '../../../src/shared/engine/net/socketFrames';
import { gotoFirst } from '../../../src/client/engine/net/gotoFirst';

/** Where a bot means to go, or swing: what its thumb says each command. */
export type BotThumb = (tick: number) => Omit<NetCommand, 'seq'>;
export const stillThumb: BotThumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });

/** A phone as a real socket client: `hello`, the load, `ready`, then commands at 60 Hz until it is dropped. Node 24's `WebSocket` is the browser's API. */
export class RoomBot {
  readonly transport: WebSocketTransport;
  readonly client: NetClient;
  /** What the gateway said to load, and why the link ended. */
  resume: string | null = null;
  closed: string | null = null;
  /** FM7b1's close facts, when the door sent any (FM7b2: a full world's place in line). */
  closedWith: SocketCloseInfo | null = null;
  thumb: BotThumb = stillThumb;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tick = 0;
  /** `goto`: the cell it asks for before its hello, as a page Shard select sent there does (CHUNK-PARAM CP5, `gotoFirst`). */
  constructor(url: string, build: string, device: string, name = 'Bot', ledger = 0, loadMs = 0, goto?: GotoWord) {
    // The door reads no `chunk` (CP5): a bot that named its cell in the address was seated wherever, and the seating tests
    // went red on main (run 45731753083). Refuse it here, so the cell can only ride the goto word.
    if (new URL(url).searchParams.has('chunk')) throw new Error(`RoomBot: no cell in the socket address (${url}); pass goto { cell, spawn }`);
    this.transport = new WebSocketTransport(url); this.client = new NetClient(this.transport);
    this.transport.onClose((reason, info) => { this.closed = reason; this.closedWith = info ?? null; this.stop(); });
    this.transport.onControl((control, bytes) => {
      if (control !== 'resume') return;
      this.resume = new TextDecoder().decode(bytes);
      setTimeout(() => { this.transport.control('ready'); }, loadMs);
    });
    this.client.sayFirst(gotoFirst(() => goto));
    this.client.hello(build, { player: device, name }, ledger);
    this.timer = setInterval(() => {
      if (this.client.latest === null) return;
      this.client.command(this.thumb(this.tick++)); this.client.flush();
    }, 16);
  }
  /** Wait for a frame, or for the link to end. */
  async arrived(timeoutMs = 30_000): Promise<boolean> {
    const start = performance.now();
    while (this.client.latest === null && this.closed === null && performance.now() - start < timeoutMs) await new Promise(resolve => { setTimeout(resolve, 5); });
    return this.client.latest !== null;
  }
  /** Wait for the link to end, and say why. */
  async ended(timeoutMs = 10_000): Promise<string | null> {
    const start = performance.now();
    while (this.closed === null && performance.now() - start < timeoutMs) await new Promise(resolve => { setTimeout(resolve, 5); });
    return this.closed;
  }
  stop(): void { clearInterval(this.timer); }
  /** The page's clean quit (`ready` with LEAVE_FLAG, shell.ts `leave`): Leave the world, or Title from a full world's line. */
  quit(): void { this.transport.control('ready', new Uint8Array([1]).buffer); }
  drop(): void { this.stop(); this.transport.close(); this.client.dispose(); }
  /** Coins the server says it holds. */
  coins(line: string): number { return this.client.owned.get(line) ?? 0; }
}
