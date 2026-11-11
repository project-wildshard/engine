import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../../src/client/engine/net/client';
import { Rng } from '../../src/shared/engine/core/rng';
import type { NetRoomAct } from '../../src/shared/engine/net/acts';
import { BitWriter } from '../../src/shared/engine/net/bits';
import { encodeCommands, MAX_BUNDLE } from '../../src/shared/engine/net/command';
import { encodeAct, encodeHello } from '../../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../../src/shared/engine/net/netSchemas';

// The bytes a hostile client sends: all from a seed, so a failure replays. Each comes from the real encoders where they will
// write it, because a message that nearly parses reaches further in than noise does.

/** Finite-looking floats a client can put in an aim, and the ones it should not be able to. */
const FLOATS = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e38, -1e38, 1e-45, 3.4e38];
/** Text that is empty once cleaned, grows under NFKC, carries a filtered word, or fills the byte cap. */
const TEXTS = ['hello', 'shit', '\u0000\u0007', '‮​', 'ﷺﷺﷺﷺ', '😀'.repeat(60), 'a'.repeat(255), ' ', '\ud800', 'é'.repeat(120)];
const RIDES = ['offer', 'mount', 'dismount'] as const, CHANNELS = ['room', 'proximity'] as const;

/** A seeded source of hostile values. */
export class Fuzz {
  private readonly rng: Rng;
  constructor(seed: number) { this.rng = new Rng(seed); }
  int(top: number): number { return Math.floor(this.rng.next() * top); }
  chance(odds: number): boolean { return this.rng.next() < odds; }
  pick<T>(rows: readonly T[]): T { const row = rows[this.int(rows.length)]; if (row === undefined) throw new Error('Empty pick'); return row; }
  /** How often a float is a nasty one. A stretch of sound ones lets commands past admission to the weapons behind it. */
  nasty = 0.3;
  float(): number { return this.chance(this.nasty) ? this.pick(FLOATS) : (this.rng.next() - 0.5) * 1000; }
  text(): string { return this.pick(TEXTS); }
}

/** One hostile client's end of a link: a real NetClient to read the room with, and raw messages to send it. */
export class Hostile {
  readonly net: NetClient;
  private readonly writer = new BitWriter();
  private seq = 1;
  constructor(net: NetClient) { this.net = net; }
  private handle(fuzz: Fuzz): number {
    const known = [...this.net.entities.keys()];
    return known.length === 0 || fuzz.chance(0.1) ? fuzz.int(0x10000) : fuzz.pick(known);
  }
  private nextSeq(fuzz: Fuzz): number {
    if (fuzz.chance(0.02)) return (this.seq - fuzz.int(0x4000)) & 0xffff; // far behind
    if (fuzz.chance(0.1)) return (this.seq - fuzz.int(8)) & 0xffff; // a replay
    this.seq = (this.seq + (fuzz.chance(0.02) ? fuzz.int(0x100) : 1)) & 0xffff; // a skip, which loses nothing it had
    return this.seq;
  }
  private command(fuzz: Fuzz, tick: number): NetCommand {
    const aim = { origin: { x: fuzz.float(), y: fuzz.float(), z: fuzz.float() }, direction: { x: fuzz.float(), y: fuzz.float(), z: fuzz.float() } };
    return { seq: this.nextSeq(fuzz), viewTick: fuzz.pick([0, tick & 0xffff, (tick - fuzz.int(30)) & 0xffff, 0xffff, fuzz.int(0x10000)]),
      steer: { keyX: fuzz.chance(0.05) ? -1.01 : fuzz.int(3) - 1, keyY: fuzz.int(3) - 1, stickX: (fuzz.int(255) - 127) / 127, stickY: (fuzz.int(255) - 127) / 127 },
      yaw: fuzz.float() || 0, pitch: (fuzz.int(100) / 100 - 0.5) * Math.PI, buttons: fuzz.chance(0.5) ? fuzz.int(0x10000) : 0,
      ...(fuzz.chance(0.3) ? { attack: { aim, ...(fuzz.chance(0.5) ? { targetId: String(this.handle(fuzz)) } : {}) } } : {}),
      ...(fuzz.chance(0.2) ? { heavyTarget: String(this.handle(fuzz)) } : {}), ...(fuzz.chance(0.2) ? { lockTarget: String(this.handle(fuzz)) } : {}),
      ...(fuzz.chance(0.2) ? { hookTarget: fuzz.chance(0.5) ? fuzz.int(8) : fuzz.int(0x10000) } : {}),
      ...(fuzz.chance(0.3) ? { launcher: { slot: fuzz.int(32), ads: fuzz.int(256) / 255, ...(fuzz.chance(0.5) ? { fire: true as const } : {}) } } : {}) };
  }
  /** A `cmds` message of hostile commands. Target ids are handles here: a handle is all the wire carries. */
  commands(fuzz: Fuzz, tick: number): ArrayBuffer {
    const commands = Array.from({ length: fuzz.int(MAX_BUNDLE + 1) }, () => this.command(fuzz, tick));
    return encodeCommands(this.writer, { ackFrame: fuzz.pick([0, tick, tick - 2, tick - 40, tick + 1000, 0xffffffff]), commands }, id => Number(id));
  }
  /** An `act` message: real interaction ids, slots in and out of range, rides in any state, chat, reports of anything. */
  act(fuzz: Fuzz, interactions: readonly string[]): ArrayBuffer {
    const seq = fuzz.int(0x10000), acts: readonly NetRoomAct[] = [
      { kind: 'interact', seq, id: interactions.length > 0 && fuzz.chance(0.8) ? fuzz.pick(interactions) : fuzz.pick([`nobody.${String(fuzz.int(100))}`, 'a'.repeat(200), '../door']) },
      { kind: 'reload', seq, slot: fuzz.int(32) }, { kind: 'reload', seq, slot: fuzz.int(256) }, { kind: 'equip', seq, slot: fuzz.int(32) }, { kind: 'equip', seq, slot: fuzz.int(256) },
      { kind: 'ride', seq, action: fuzz.pick(RIDES) },
      { kind: 'pose', seq, names: fuzz.chance(0.5) ? fuzz.text() : 'tm,'.repeat(fuzz.int(86)) },
      { kind: 'chat', seq, channel: fuzz.pick(CHANNELS), text: fuzz.text() }, { kind: 'report', seq, line: fuzz.chance(0.5) ? fuzz.int(32) : fuzz.int(0x7fffffff) },
    ];
    return encodeAct(this.writer, fuzz.pick(acts));
  }
  /** A second `hello`, sound or not: this client has said one already. */
  hello(fuzz: Fuzz): ArrayBuffer {
    return encodeHello(this.writer, { schemaHash: fuzz.chance(0.5) ? NET_SCHEMA_HASH : fuzz.int(0x7fffffff), build: '', player: fuzz.pick(['bad id', 'p', 'a'.repeat(200)]), name: fuzz.text(), ledger: fuzz.int(0x7fffffff) });
  }
  /** Noise, a message cut short, or a message with bits flipped. */
  broken(fuzz: Fuzz, tick: number): ArrayBuffer {
    const kind = fuzz.int(4);
    if (kind === 0) return Uint8Array.from({ length: fuzz.chance(0.05) ? 5000 : fuzz.int(64) }, () => fuzz.int(256)).buffer;
    const base = new Uint8Array(kind === 1 ? this.commands(fuzz, tick) : kind === 2 ? this.act(fuzz, []) : this.hello(fuzz));
    if (fuzz.chance(0.5)) return base.slice(0, fuzz.int(base.length + 1)).buffer;
    for (let flips = 1 + fuzz.int(4); flips > 0; flips--) { const at = fuzz.int(base.length); base[at] = (base[at] ?? 0) ^ (1 << fuzz.int(8)); }
    return base.buffer;
  }
  /** One message of any kind. */
  any(fuzz: Fuzz, tick: number, interactions: readonly string[]): ArrayBuffer {
    const kind = fuzz.int(10);
    return kind < 5 ? this.commands(fuzz, tick) : kind < 8 ? this.act(fuzz, interactions) : kind < 9 ? this.broken(fuzz, tick) : this.hello(fuzz);
  }
}
