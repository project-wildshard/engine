import type { Scope } from '@wildshard/engine/app/scope';
import { VOICE_PIECE_CHARS } from '@wildshard/engine/net/socketFrames';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { listenPage } from '@wildshard/engine/input/dom';
import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import { talkerKey, voiceNear } from '@wildshard/engine/net/voiceNear';

// J218: voice chat, peer to peer. The server's main thread only says who in this cell is on voice and carries signalling
// (`src/server/host/dedicated/voiceRelay.ts`); audio goes straight between players, or through TURN. Whoever joins offers to
// everyone already on, so two offers never cross. Off by default: nothing touches the microphone until the player asks.
// VOICE-POLISH V7: a voice fades with the distance to its player's body and is silent from 40 m (`voiceNear.ts`); the links stay up,
// so walking back in range is heard at once. iOS Safari ignores a media element's volume, so an iPhone hears full or nothing.

/** What the server says on the `voice` control. */
export type VoiceHeard =
  | { readonly k: 'you'; readonly id: string }
  | { readonly k: 'roster'; readonly peers: readonly { readonly id: string; readonly name: string; readonly body?: string }[] }
  | { readonly k: 'hi'; readonly ice: readonly RTCIceServer[]; readonly peers: readonly string[] }
  | { readonly k: 'full' }
  | { readonly k: 'sig'; readonly from: string; readonly m: number; readonly i: number; readonly n: number; readonly d: string };
/** The game socket's half of voice: say a word, and hear the server's. A redial re-seats and says `you` again. */
export interface VoiceLink {
  readonly send: (word: object) => void;
  readonly on: (listener: (word: VoiceHeard) => void) => () => void;
}
/** Where voice stands for this player. */
export type VoiceState = 'off' | 'asking' | 'joining' | 'on' | 'denied' | 'unsupported' | 'full' | 'failed';
/** One other player on voice; `body` is their player row's id (V7, V8), and `far` is out of earshot: 40 m or more away or out of sight. */
export interface VoicePeer { readonly id: string; readonly name: string; readonly body?: string | null; speaking: boolean; muted: boolean; linked: boolean; far: boolean }

/** A remote level past this is talking; held this long after it drops, so a word's gaps don't flicker. */
const SPEAKING_LEVEL = 0.03, SPEAKING_HOLD_MS = 450, LEVEL_POLL_MS = 150;
/** An offerer retries a failed or silent link this many times, the silent one after this long. */
const RETRIES = 3, UNANSWERED_MS = 15_000;
/** Signalling in pieces: a half-heard message is dropped after this long, and no peer holds more than a few at once. */
const PIECES_MS = 10_000, PIECES_PER_PEER = 4, MAX_PIECES = 64;
/** Pieces sent per 50 ms: signalling shares the game socket's message budget, so a burst is spread out. */
const SEND_EVERY_MS = 50, SEND_PER_TICK = 6;
/**
 * TURN for phones on 4G: a Cloudflare Worker mints short-lived Realtime TURN credentials, so the key's token never reaches a
 * page or the game server. Without it, the game server's STUN-only list stands and two phones behind carrier NAT may not meet.
 */
export const VOICE_ICE_URL = 'https://wildshard-voice-ice.wildshard.workers.dev/';
const ICE_WAIT_MS = 4000, ICE_KEEP_MS = 3_600_000;
const IceAnswerSchema = v.object({ iceServers: v.union([v.array(v.object({ urls: v.union([v.string(), v.array(v.string())]), username: v.optional(v.string()), credential: v.optional(v.string()) })),
  v.object({ urls: v.union([v.string(), v.array(v.string())]), username: v.optional(v.string()), credential: v.optional(v.string()) })]) });
/** The Worker's ICE servers, or null when it can't say in time. */
async function fetchIce(url: string): Promise<RTCIceServer[] | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ICE_WAIT_MS) });
    if (!response.ok) return null;
    const said = v.safeParse(IceAnswerSchema, await response.json());
    if (!said.success) return null;
    return (Array.isArray(said.output.iceServers) ? said.output.iceServers : [said.output.iceServers]).map(server => {
      const out: RTCIceServer = { urls: server.urls };
      if (server.username !== undefined) out.username = server.username;
      if (server.credential !== undefined) out.credential = server.credential;
      return out;
    });
  } catch { return null; }
}
const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** `early` holds candidates heard before the remote description; `held`, our own found before our description went out. */
interface Link { readonly pc: RTCPeerConnection; readonly offerer: boolean; readonly audio: HTMLAudioElement; readonly early: RTCIceCandidateInit[]; readonly held: RTCIceCandidateInit[]; readonly openedAt: number; described: boolean; everLinked: boolean; heardAt: number; retries: number }
interface Pieces { readonly from: string; readonly n: number; readonly at: number; readonly parts: (string | undefined)[]; got: number }
type Signal = { readonly sdp: RTCSessionDescriptionInit } | { readonly cand: RTCIceCandidateInit };

/** Who a peer is, for their body. */
const talker = (peer: VoicePeer): { readonly body: string | null; readonly name: string } => ({ body: peer.body ?? null, name: peer.name });

/** This device's voice choices: on when it last left (so a grid crossing keeps it on), and whether the first tip was seen. */
export interface VoicePrefs { readonly wanted: boolean; readonly seen: boolean }
const prefsSlot = saves.define({ key: 'voice', scope: 'device', version: 1, schema: v.object({ wanted: v.boolean(), seen: v.boolean() }), initial: (): VoicePrefs => ({ wanted: false, seen: false }) });
/** Read and change the prefs; a page with no storage just forgets. */
export const voicePrefs = {
  read: (): VoicePrefs => { try { return prefsSlot.read(); } catch { return { wanted: false, seen: false }; } },
  write: (change: Partial<VoicePrefs>): void => { try { prefsSlot.write({ ...voicePrefs.read(), ...change }); } catch { /* Forgotten next visit, and nothing else. */ } },
};

/** One page's voice chat. */
export class VoiceChat {
  state: VoiceState = 'off';
  /** Everyone on voice in this cell, joined or not, but this player. */
  readonly roster: Map<string, VoicePeer> = new Map<string, VoicePeer>();
  /** This player's own level, 0 to 1, while the mic is open. */
  level = 0;
  speaking = false;
  private readonly link: VoiceLink;
  private readonly links = new Map<string, Link>();
  private readonly pieces = new Map<string, Pieces>();
  private readonly outbox: object[] = [];
  /** Bumped on every new seat, stop and disposal: an await that comes back to an older one does nothing. */
  private session = 0;
  private readonly muted = new Set<string>();
  private readonly changes = new Set<() => void>();
  private me: string | null = null;
  private mic: MediaStream | null = null;
  private ice: readonly RTCIceServer[] = [];
  private sent = 0;
  private analyser: { readonly context: AudioContext; readonly node: AnalyserNode; readonly data: Float32Array<ArrayBuffer> } | null = null;
  private selfAt = 0;
  private wanted = false;
  private turn: { readonly at: number; readonly servers: Promise<RTCIceServer[] | null> } | null = null;
  private turned: RTCIceServer[] | null = null;
  private readonly iceUrl: string;
  constructor(scope: Scope, link: VoiceLink, iceUrl: string = VOICE_ICE_URL) {
    this.link = link; this.iceUrl = iceUrl;
    if (typeof RTCPeerConnection !== 'function' || typeof navigator.mediaDevices?.getUserMedia !== 'function') this.state = 'unsupported';
    scope.onDispose(link.on(word => { this.heard(word); }));
    scope.interval(LEVEL_POLL_MS, () => { void this.poll(); });
    scope.interval(SEND_EVERY_MS, () => { for (const word of this.outbox.splice(0, SEND_PER_TICK)) this.link.send(word); });
    scope.onDispose(() => { this.wanted = false; this.session++; this.close(); });
    // A remote stream an autoplay rule held back plays on the next touch.
    listenPage(scope, 'pointerdown', () => { for (const { audio } of this.links.values()) if (audio.paused) void audio.play().catch(() => undefined); });
    void this.checkPermission();
  }
  /** The player turned voice on before this page: a grid crossing or a reload keeps it on when the browser already allows the mic. */
  get remembered(): boolean { return voicePrefs.read().wanted; }
  onChange(listener: () => void): () => void { this.changes.add(listener); return () => { this.changes.delete(listener); }; }
  /** Voice on: the browser asks for the mic once, then this cell's voice is joined. Call from a tap or a key. */
  async start(): Promise<void> {
    if (this.state === 'unsupported' || this.state === 'asking' || this.state === 'joining' || this.state === 'on') return;
    this.wanted = true; voicePrefs.write({ wanted: true });
    const session = ++this.session;
    this.set('asking');
    // Made inside the tap: Safari only lets an AudioContext run if it starts in the gesture, and the mic's answer comes later.
    const context = this.analyser === null && typeof AudioContext === 'function' ? new AudioContext() : null;
    void context?.resume().catch(() => undefined);
    const turn = this.ask();
    let mic: MediaStream;
    try {
      mic = this.mic ?? await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false });
    } catch (error) {
      void context?.close().catch(() => undefined);
      if (session !== this.session) return;
      this.wanted = false;
      this.set(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'failed');
      return;
    }
    // Stopped, or started again, while the browser asked: this answer is nobody's.
    if (session !== this.session || !this.wanted) { void context?.close().catch(() => undefined); if (mic !== this.mic) for (const track of mic.getTracks()) track.stop(); return; }
    this.mic = mic;
    if (context !== null) this.listenToSelf(context);
    this.set('joining');
    // The TURN list is in hand before joining, so nobody's offer can arrive while this page still waits for it.
    this.turned = await turn;
    if (session !== this.session || !this.wanted) return;
    if (this.me !== null) this.link.send({ k: 'join' });
  }
  /** The Worker's TURN list: a good answer is kept for an hour, a failed one is asked again next time. */
  private ask(): Promise<RTCIceServer[] | null> {
    if (this.iceUrl === '') return Promise.resolve(null);
    if (this.turn !== null && diagnosticNow() - this.turn.at < ICE_KEEP_MS) return this.turn.servers;
    const servers = fetchIce(this.iceUrl), asked = { at: diagnosticNow(), servers };
    this.turn = asked;
    void servers.then(found => { if (found === null && this.turn === asked) this.turn = null; return found; });
    return servers;
  }
  /** Voice off: leave, hang up on everyone, and give the mic back so the browser's mic light goes out. */
  stop(): void {
    this.wanted = false; this.session++; voicePrefs.write({ wanted: false });
    if (this.state === 'on' || this.state === 'joining') this.link.send({ k: 'leave' });
    this.close();
    this.set(this.state === 'unsupported' ? 'unsupported' : 'off');
  }
  toggle(): void { if (this.state === 'on' || this.state === 'joining' || this.state === 'asking') this.stop(); else void this.start(); }
  /** Silence one player, for this player only. */
  mute(id: string, muted: boolean): void {
    if (muted) this.muted.add(id); else this.muted.delete(id);
    const peer = this.roster.get(id), link = this.links.get(id);
    if (peer !== undefined) { peer.muted = muted; if (muted) peer.speaking = false; }
    if (link !== undefined && peer !== undefined) this.loudness(peer, link);
    this.changed();
    this.tellTalking();
  }
  private async checkPermission(): Promise<void> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      if (status.state === 'denied' && this.state === 'off') this.set('denied');
      else if (status.state === 'granted' && this.remembered && this.state === 'off') await this.start();
    } catch { /* Not every browser can say; the tap asks. */ }
  }
  private heard(word: VoiceHeard): void {
    if (word.k === 'you') {
      // A new seat: a first one, or one after a redial. Every old link belonged to the old id.
      this.me = word.id; this.hangUp();
      if (this.wanted && this.mic !== null) { this.set('joining'); this.link.send({ k: 'join' }); }
      return;
    }
    if (word.k === 'roster') {
      const now = new Set<string>();
      for (const { id, name, body } of word.peers) {
        if (id === this.me) continue;
        now.add(id);
        if (!this.roster.has(id)) this.roster.set(id, { id, name, body: body ?? null, speaking: false, muted: this.muted.has(id), linked: false, far: voiceNear.gain({ name, body: body ?? null }) === 0 });
      }
      for (const id of this.roster.keys()) if (!now.has(id)) { this.roster.delete(id); this.drop(id); this.forget(id); }
      this.changed();
      return;
    }
    if (word.k === 'full') { this.wanted = false; this.close(); this.set('full'); return; }
    if (word.k === 'hi') {
      if (!this.wanted || this.mic === null || this.state !== 'joining') { if (!this.wanted) this.link.send({ k: 'leave' }); return; }
      this.ice = this.turned ?? word.ice; this.set('on');
      for (const id of word.peers) if (id !== this.me) void this.offer(id);
      return;
    }
    this.piece(word);
  }
  private piece(word: Extract<VoiceHeard, { k: 'sig' }>): void {
    if (this.state !== 'on' || !this.roster.has(word.from) || word.n > MAX_PIECES || word.i >= word.n) return;
    const key = `${word.from}:${String(word.m)}`;
    let held = this.pieces.get(key);
    if (held === undefined) {
      let mine = 0;
      for (const other of this.pieces.values()) if (other.from === word.from) mine++;
      if (mine >= PIECES_PER_PEER) return;
      held = { from: word.from, n: word.n, at: diagnosticNow(), parts: Array.from<string | undefined>({ length: word.n }), got: 0 };
      this.pieces.set(key, held);
    }
    if (held.n !== word.n || held.parts[word.i] !== undefined) return;
    held.parts[word.i] = word.d; held.got++;
    if (held.got < held.n) return;
    this.pieces.delete(key);
    let signal: Signal;
    try { signal = JSON.parse(held.parts.join('')) as Signal; } catch { return; }
    void this.signal(word.from, signal);
  }
  /** Drop every half-heard message from one peer. */
  private forget(id: string): void { for (const [key, held] of this.pieces) if (held.from === id) this.pieces.delete(key); }
  private async signal(from: string, signal: Signal): Promise<void> {
    try {
      if ('cand' in signal) {
        const link = this.links.get(from);
        if (link === undefined) return;
        if (link.pc.remoteDescription === null) link.early.push(signal.cand); else await link.pc.addIceCandidate(signal.cand);
        return;
      }
      if (signal.sdp.type === 'offer') {
        // A fresh offer replaces whatever link there was: the offerer started again.
        this.drop(from);
        const link = this.open(from, false);
        await link.pc.setRemoteDescription(signal.sdp);
        await this.flush(link);
        const answer = await link.pc.createAnswer();
        if (this.links.get(from) !== link) return;
        await link.pc.setLocalDescription(answer);
        if (this.links.get(from) === link && link.pc.localDescription !== null) this.describe(from, link, link.pc.localDescription.toJSON());
      } else if (signal.sdp.type === 'answer') {
        const link = this.links.get(from);
        if (link === undefined || link.pc.signalingState !== 'have-local-offer') return;
        await link.pc.setRemoteDescription(signal.sdp);
        await this.flush(link);
      }
    } catch { /* A link that can't be made stays unmade; its peer shows as not linked. */ }
  }
  private async flush(link: Link): Promise<void> { for (const cand of link.early.splice(0)) await link.pc.addIceCandidate(cand).catch(() => undefined); }
  private async offer(id: string, retries = 0): Promise<void> {
    this.drop(id);
    const link = this.open(id, true);
    link.retries = retries;
    try {
      const offer = await link.pc.createOffer();
      if (this.links.get(id) !== link) return;
      await link.pc.setLocalDescription(offer);
      if (this.links.get(id) === link && link.pc.localDescription !== null) this.describe(id, link, link.pc.localDescription.toJSON());
    } catch { if (this.links.get(id) === link) this.drop(id); }
  }
  private open(id: string, offerer: boolean): Link {
    const pc = new RTCPeerConnection({ iceServers: [...this.ice] }), audio = document.createElement('audio');
    audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.muted = true; audio.dataset['voicePeer'] = id;
    // Played from memory, never mounted: a hidden element in the page would only be one more node to keep.
    const link: Link = { pc, offerer, audio, early: [], held: [], openedAt: diagnosticNow(), described: false, everLinked: false, heardAt: 0, retries: 0 };
    this.links.set(id, link);
    const known = this.roster.get(id);
    if (known !== undefined) this.loudness(known, link);
    for (const track of this.mic?.getAudioTracks() ?? []) if (this.mic !== null) pc.addTrack(track, this.mic);
    pc.ontrack = event => { audio.srcObject = event.streams[0] ?? new MediaStream([event.track]); void audio.play().catch(() => undefined); };
    // WebKit finds candidates before `setLocalDescription` settles: one sent ahead of its offer would reach a peer with no link to add it to.
    pc.onicecandidate = event => { if (event.candidate === null) return; if (link.described) this.say(id, { cand: event.candidate.toJSON() }); else link.held.push(event.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (this.links.get(id) !== link) return;
      const peer = this.roster.get(id);
      if (pc.connectionState === 'connected') link.everLinked = true;
      if (peer !== undefined) { peer.linked = pc.connectionState === 'connected'; this.changed(); }
      // The joiner offered, so the joiner tries again; the other side waits for its fresh offer.
      if (pc.connectionState === 'failed' && link.offerer && link.retries < RETRIES && this.state === 'on') void this.offer(id, link.retries + 1);
    };
    return link;
  }
  /** Send our offer or answer, then every candidate found while it was being made. */
  private describe(id: string, link: Link, sdp: RTCSessionDescriptionInit): void {
    this.say(id, { sdp }); link.described = true;
    for (const cand of link.held.splice(0)) this.say(id, { cand });
  }
  private say(to: string, signal: Signal): void {
    const text = JSON.stringify(signal), m = ++this.sent, n = Math.ceil(text.length / VOICE_PIECE_CHARS);
    for (let i = 0; i < n; i++) this.outbox.push({ k: 'sig', to, m, i, n, d: text.slice(i * VOICE_PIECE_CHARS, (i + 1) * VOICE_PIECE_CHARS) });
  }
  private drop(id: string): void {
    const link = this.links.get(id);
    if (link === undefined) return;
    this.links.delete(id);
    link.pc.ontrack = null; link.pc.onicecandidate = null; link.pc.onconnectionstatechange = null;
    link.pc.close(); link.audio.srcObject = null; link.audio.remove();
    const peer = this.roster.get(id);
    if (peer !== undefined) { peer.linked = false; peer.speaking = false; }
  }
  private hangUp(): void { for (const id of this.links.keys()) this.drop(id); this.pieces.clear(); this.outbox.length = 0; }
  private close(): void {
    this.hangUp(); this.releaseMic();
    for (const peer of this.roster.values()) peer.speaking = false;
    this.tellTalking();
  }
  /** V7: this peer's volume by the distance to their body; muted by the player or out of earshot, nothing at all. */
  private loudness(peer: VoicePeer, link: Link): number {
    const gain = voiceNear.gain(talker(peer));
    peer.far = gain === 0;
    link.audio.muted = peer.muted || peer.far;
    link.audio.volume = Math.min(1, Math.max(0, gain));
    return gain;
  }
  /** V8: the Names heard talking, for the ring over their heads. */
  private tellTalking(): void {
    const names = new Set<string>();
    for (const peer of this.roster.values()) if (peer.speaking) names.add(talkerKey(talker(peer)));
    const was = voiceNear.talking;
    if (names.size !== was.size || [...names].some(name => !was.has(name))) voiceNear.talking = names;
  }
  private releaseMic(): void {
    for (const track of this.mic?.getTracks() ?? []) track.stop();
    this.mic = null;
    void this.analyser?.context.close().catch(() => undefined);
    this.analyser = null; this.level = 0; this.speaking = false;
  }
  private listenToSelf(context: AudioContext): void {
    if (this.mic === null) return;
    try {
      const node = context.createAnalyser();
      node.fftSize = 512;
      context.createMediaStreamSource(this.mic).connect(node);
      this.analyser = { context, node, data: new Float32Array(node.fftSize) };
    } catch { this.analyser = null; void context.close().catch(() => undefined); }
  }
  private async poll(): Promise<void> {
    const now = diagnosticNow();
    let moved = false;
    if (this.analyser !== null) {
      this.analyser.node.getFloatTimeDomainData(this.analyser.data);
      let sum = 0;
      for (const sample of this.analyser.data) sum += sample * sample;
      const level = Math.min(1, Math.sqrt(sum / this.analyser.data.length) * 4);
      if (level > SPEAKING_LEVEL * 2) this.selfAt = now;
      const speaking = now - this.selfAt < SPEAKING_HOLD_MS;
      if (speaking !== this.speaking || Math.abs(level - this.level) > 0.05) moved = true;
      this.level = level; this.speaking = speaking;
    }
    for (const [key, held] of this.pieces) if (now - held.at > PIECES_MS) this.pieces.delete(key);
    for (const [id, link] of this.links) {
      // An offer nobody answered, or a link that never got going: the offerer starts again. A link that worked and dropped
      // gets ICE's own recovery first (a phone's blip), and a new offer only once it says failed.
      if (link.offerer && this.state === 'on' && !link.everLinked && link.pc.connectionState !== 'connected' && now - link.openedAt > UNANSWERED_MS && link.retries < RETRIES) { void this.offer(id, link.retries + 1); continue; }
      const peer = this.roster.get(id);
      if (peer === undefined) continue;
      const far = peer.far;
      this.loudness(peer, link);
      if (far !== peer.far) moved = true;
      const level = await heardLevel(link.pc);
      // Stopped, hung up or redialled while the stats were read: this link's word is no longer anyone's.
      if (this.links.get(id) !== link) continue;
      if (level > SPEAKING_LEVEL) link.heardAt = now;
      // Talking is what this player hears: a muted or far player's voice never lights their name or their head.
      const speaking = !peer.muted && !peer.far && now - link.heardAt < SPEAKING_HOLD_MS;
      if (speaking !== peer.speaking) { peer.speaking = speaking; moved = true; }
    }
    for (const peer of this.roster.values()) if (!this.links.has(peer.id)) { const far = voiceNear.gain(talker(peer)) === 0; if (far !== peer.far) { peer.far = far; moved = true; } }
    this.tellTalking();
    if (moved) this.changed();
  }
  private set(state: VoiceState): void { this.state = state; this.changed(); }
  private changed(): void { for (const listener of this.changes) listener(); }
}

/** A peer's loudness: the receiver's own reading where the browser has one, else the stats. */
async function heardLevel(pc: RTCPeerConnection): Promise<number> {
  for (const receiver of pc.getReceivers()) {
    const level = receiver.getSynchronizationSources?.()[0]?.audioLevel;
    if (typeof level === 'number') return level;
  }
  try {
    let level = 0;
    (await pc.getStats()).forEach((row: { type?: string; kind?: string; audioLevel?: number }) => { if (row.type === 'inbound-rtp' && row.kind === 'audio' && typeof row.audioLevel === 'number') level = Math.max(level, row.audioLevel); });
    return level;
  } catch { return 0; }
}
