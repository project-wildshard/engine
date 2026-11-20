import type { AudioPlaybackRecipe } from '@wildshard/format/audioProfiles';
import { audioMixValue } from '../../../shared/engine/audio/audioProfiles';
import { resourceScope } from '../../../shared/engine/app/resources';
import { ownAudioSource } from './ownership';
import { tap } from '../../../shared/engine/core/harnessTap';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { panFromYaw, audioRandom } from './util';
import type { Scope } from '../../../shared/engine/app/scope';
import { jsonSlot } from '../saves/slots';
/**
 * Voices — the procedural sound bank (src/client/engine/audio/gen.ts) as AudioBuffers, and a one-node-chain player for them.
 *
 *   audio.voices.prewarm(['step-sand', 'hurt', …])   // after the first gesture: one variant rendered per idle slice
 *   audio.voices.play('impact-shell', { at: pos, gain: 0.8, rate: 1.1 })   // a random variant, ±5 % pitch, placed in the world
 *   audio.voices.setListener(x, y, z, yaw)           // per frame (a zoned ambience does it) — for `at` plays
 *   audio.voices.buffer('ir-cave')                   // a stereo buffer (the ConvolverNodes take these)
 *
 * A family is rendered the first time it is asked for if prewarm has not reached it yet (a few ms on desktop). A play is
 * AudioBufferSourceNode → gain (→ distance low-pass → stereo panner when placed) → the sfx bus (or `out`). Nothing here
 * runs per frame; setListener only stores four numbers.
 */
import type { Vector3 } from 'three';
import { FAMILIES, type Family, type FamilyName, type VoiceWork } from './voiceFamilies';

/** meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13b, 2026-11-19): iOS Safari 18.6 has no requestIdleCallback, so the prewarm's
 *  "idle" slices fall back to this timer. At 16 ms they ran between nearly every pair of frames: about 375 ms of the main
 *  thread in Driftwood's first 3 s of play on the iPhone 13 (impulse responses 200 ms of it). The device slot
 *  `debug.audioWarmPaceMs` (0 to 2000) sets the gap; unset, 16 until the phone pairs decide. */
export const AUDIO_WARM_PACE_SLOT = 'debug.audioWarmPaceMs';
export const AUDIO_WARM_PACE_DEFAULT_MS = 16;
/** The slot's gap: a number from 0 to 2000 wins, anything else is the default. */
export function audioWarmPace(saved: unknown): number {
  return typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 && saved <= 2000 ? saved : AUDIO_WARM_PACE_DEFAULT_MS;
}
function audioWarmPaceMs(): number {
  try { return audioWarmPace(jsonSlot(AUDIO_WARM_PACE_SLOT, 'device').read()); } catch { return AUDIO_WARM_PACE_DEFAULT_MS; }
}

/** meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13d): the prewarm renders in a worker (voiceRender.worker.ts) when the device
 *  slot `debug.audioWarmWorker` is true; a play that finds its family unrendered still renders on the main thread. */
export const AUDIO_WARM_WORKER_SLOT = 'debug.audioWarmWorker';
export const AUDIO_WARM_WORKER_DEFAULT = false;
let warmWorkerPicked: boolean | undefined;
/** Whether the prewarm renders off the main thread; read once per page. */
export function audioWarmWorkerOn(): boolean {
  if (warmWorkerPicked !== undefined) return warmWorkerPicked;
  let saved: unknown = null;
  try { saved = jsonSlot(AUDIO_WARM_WORKER_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  warmWorkerPicked = typeof saved === 'boolean' ? saved : AUDIO_WARM_WORKER_DEFAULT;
  return warmWorkerPicked;
}
/** The render worker's port, as the pool uses it (a real Worker, or a test's). */
export type VoiceRenderPort = Pick<Worker, 'postMessage' | 'terminate'> & EventTarget;
let makeRenderPort = (): VoiceRenderPort | null => typeof Worker === 'function'
  ? new Worker(new URL('voiceRender.worker.ts', import.meta.url), { type: 'module', name: 'voice-render' }) : null;
/** Tests only: read the slot again (or force it), and swap the worker. */
export function resetAudioWarmWorker(on?: boolean, port?: () => VoiceRenderPort | null): void {
  warmWorkerPicked = on; if (port !== undefined) makeRenderPort = port;
}
/** a worker render that takes longer than this is given up and rendered on the main thread */
const WORKER_RENDER_DEADLINE_MS = 5000;

interface Host { readonly ctx: BaseAudioContext; readonly sfx: GainNode; readonly ready: boolean }

export interface PlayOpts {
  /** linear gain (default 1) */
  gain?: number;
  /** playback rate before the ±5 % jitter (default 1) — pitch and length together */
  rate?: number;
  /** stereo pan −1…1 for an unplaced play */
  pan?: number;
  /** sweep the pan from `pan` to this over the sound (a swing crossing the view) */
  panTo?: number;
  /** a world position: distance attenuation + low-pass + pan from the listener (setListener) */
  at?: Vector3 | { x: number; y: number; z: number } | undefined;
  /** where it goes (default the sfx bus) */
  out?: AudioNode;
  /** seconds from now */
  delay?: number;
  /** the pitch jitter (default 0.05 = ±5 %) */
  jitter?: number;
}

export interface SampleVoice { buffer: AudioBuffer; offset: number; duration: number; gain?: number }
export interface SamplePolicy {
  reach?: number; scale?: number; power?: number; cutoff?: number; cutoffScale?: number;
  spread?: number; delay?: number; jitter?: number; gainJitter?: number; panAlways?: boolean;
  repeat?: boolean; startAtZero?: boolean;
}
export interface SamplePlay extends PlayOpts {
  time?: number;
}
export type VoiceTable = Readonly<Record<string, Family | { clips: () => readonly SampleVoice[] | undefined; policy?: SamplePolicy }>>;

export class VoicePool {
  private readonly memoryOwner = resourceScope().name;
  private readonly scope = resourceScope().child('VoicePool');
  private bufs = new Map<string, (AudioBuffer | undefined)[]>();
  private warm: [string, number][] = [];
  private warming = false;
  private lx = 0; private ly = 0; private lz = 0; private yaw = 0;
  private last = new Map<string, number>();
  private done = new Set<string>();
  /** DW3: the prewarm's render worker (undefined until first used, null when off or failed) and its one job in flight */
  private renderPort: VoiceRenderPort | null | undefined;
  private inFlight: { id: number; name: string; family: Family; v: number; c: number; sr: number; deadline: ReturnType<Scope['timeout']> } | null = null;
  private jobIds = 0;

  private readonly tables = new Map<string, Family | { clips: () => readonly SampleVoice[] | undefined; policy?: SamplePolicy }>();
  private readonly host: Host;
  constructor(host: Host) {
    this.host = host;
    this.scope.onDispose(() => {
      this.bufs.clear(); this.warm.length = 0; this.warming = false;
      this.last.clear(); this.done.clear(); this.tables.clear();
      this.inFlight = null; this.renderPort?.terminate(); this.renderPort = null;
    });
  }
  private get live(): boolean { return !this.scope.disposed && !this.scope.disposing; }
  /** PCM belongs to the definition that rendered it, not a reused family name.
   * Playing sources keep their own buffers; only the retired cache is cleared. */
  private forgetFamily(id: string): void {
    const variants = this.bufs.get(id)?.length ?? 0;
    this.bufs.delete(id); this.last.delete(id);
    for (let variant = 0; variant < variants; variant++) for (let channel = 0; channel < 2; channel++) this.done.delete(`${id}/${variant}/${channel}`);
    this.warm = this.warm.filter(([name]) => name !== id);
  }
  register(table: VoiceTable, scope?: Scope): () => void {
    if (!this.live) return () => undefined;
    for (const [id, entry] of Object.entries(table)) {
      if (this.tables.get(id) !== entry) this.forgetFamily(id);
      this.tables.set(id, entry);
    }
    const remove = (): void => { for (const [id, entry] of Object.entries(table)) if (this.tables.get(id) === entry) {
      this.tables.delete(id); this.forgetFamily(id);
    } };
    scope?.onDispose(remove);
    return remove;
  }
  private family(id: string): Family | undefined { if (!this.live) return undefined; const entry = this.tables.get(id); return entry && 'gen' in entry ? entry : FAMILIES[id]; }
  /** Sample selection and generated rendering share the same source, roll-off and output chain. Content owns its tap. */
  sample(clips: readonly SampleVoice[], o: SamplePlay = {}, policy: SamplePolicy = {}, random: () => number = audioRandom, scope?: Scope): AudioBufferSourceNode | undefined {
    if (!this.live || !this.host.ready || scope?.disposed) return undefined;
    const clip = clips[Math.floor(random() * clips.length)];
    if (!clip) return undefined;
    let gain = (clip.gain ?? 1) * (o.gain ?? 1), pan = o.pan ?? 0, cutoff = policy.cutoff ?? 20000;
    if (o.at) {
      const dx = o.at.x - this.lx, dy = o.at.y - this.ly, dz = o.at.z - this.lz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > (policy.reach ?? 150)) return undefined;
      gain *= 1 / (1 + dist / (policy.scale ?? 9)) ** (policy.power ?? 1.4);
      cutoff = 12000 / (1 + dist / (policy.cutoffScale ?? 22));
      pan = panFromYaw(dx, dz, this.yaw, policy.spread ?? 0.8, dist);
    }
    if (!Number.isFinite(gain + pan + cutoff)) return undefined;
    const c = this.host.ctx, src = scope ? c.createBufferSource() : ownAudioSource(c.createBufferSource());
    const t = o.time ?? (policy.startAtZero === true ? 0 : c.currentTime + (o.delay ?? policy.delay ?? 0));
    src.buffer = clip.buffer;
    if (policy.jitter !== 0 || o.rate !== undefined) src.playbackRate.value = (o.rate ?? 1) * 2 ** (policy.jitter === 0 ? 0 : (random() * 2 - 1) * (policy.jitter ?? 40) / 1200);
    const g = c.createGain(); g.gain.value = gain * (policy.gainJitter === undefined ? 1 : policy.gainJitter + random() * (1 - policy.gainJitter));
    src.connect(g);
    const nodes: AudioNode[] = [src, g];
    let node: AudioNode = g;
    if (cutoff < 19000) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; node.connect(lp); node = lp; nodes.push(lp); }
    if ((pan !== 0 || o.panTo !== undefined || policy.panAlways === true) && 'createStereoPanner' in c) {
      const p = c.createStereoPanner(); p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
      if (o.panTo !== undefined && !o.at) p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, o.panTo)), t + clip.duration / src.playbackRate.value);
      node.connect(p); node = p; nodes.push(p);
    }
    node.connect(o.out ?? this.host.sfx);
    if (scope) {
      let ended = false;
      const cleanup = (): void => { for (const n of nodes) n.disconnect(); };
      const forget = scope.capture('sounds', () => { if (!ended) src.stop(); cleanup(); });
      scope.listen(src, 'ended', () => { ended = true; forget(); cleanup(); }, { once: true });
    }
    src.start(t, clip.offset, clip.duration);
    return src;
  }

  /** Bind declared controls to this pool's original sample and procedural players. */
  playback(recipe:AudioPlaybackRecipe,ports:{available?:()=>boolean;samples?:{clips:(family:string)=>readonly SampleVoice[]|undefined;load:(family:string)=>void}}={}):{
    play:(id:string,parameters?:Readonly<Record<string,number|string|boolean>>,options?:SamplePlay)=>boolean;
    value:(id:string)=>number;listener:(x:number,y:number,z:number,yaw:number)=>void;
  } {
    const state=new Map(Object.entries(recipe.initial)),values=new Map<string,number>();let armed=false,lx=0,ly=0,lz=0;
    return {value:id=>values.get(id)??0,listener:(x,y,z,yaw)=>{lx=x;ly=y;lz=z;this.setListener(x,y,z,yaw);},play:(id,parameters={},options={})=>{
      const row=recipe.actions[id];if(row===undefined)throw new Error('Missing declared audio action');
      if(recipe.mode==='samples'&&(!this.host.ready||ports.available?.()===false))return false;
      if(row.warm===true&&!armed&&this.host.ready){armed=true;this.prewarm(recipe.prewarm);}
      const family=row.family.prefix+(row.family.param===undefined?'':String(parameters[row.family.param]));
      const clips=recipe.mode==='samples'?ports.samples?.clips(family):undefined;
      if(recipe.mode==='samples'&&clips===undefined){ports.samples?.load(family);return false;}
      values.clear();
      const read=(key:string):number=>{
        if(key.startsWith('state.'))return state.get(key.slice(6))??0;
        const value=values.get(key);if(value!==undefined)return value;
        const parts=key.split('.'),table=recipe.tables[parts[0]??''];
        const selector=parts[1],selected=selector===undefined?undefined:parameters[selector];
        if(table!==undefined&&typeof selected==='string'){const level=table[selected];if(level!==undefined)return level;}
        const parameter=parameters[key];if(typeof parameter==='number')return parameter;if(typeof parameter==='boolean')return Number(parameter);
        throw new Error('Missing audio playback value');
      };
      for(const [key,expr]of row.state)state.set(key,audioMixValue(expr,read));
      for(const [key,expr]of row.values)values.set(key,audioMixValue(expr,read));
      const output:SamplePlay={...options};for(const [key,expr]of row.options)output[key]=audioMixValue(expr,read);
      if(recipe.mode==='samples'){
        const policy=recipe.sample;if(policy===undefined||clips===undefined)throw new Error('Missing sample playback policy');
        if(output.at){const distance=Math.hypot(output.at.x-lx,output.at.y-ly,output.at.z-lz);if(distance>policy.reach)return policy.outOfRangeHandled;if(!Number.isFinite(distance))return false;}
        const source=this.sample(clips,output,policy);if(source===undefined)return false;
      }else{this.play(family,output);}
      if(row.tap!==undefined)tap.sound?.(row.tap+family);
      return true;
    }};
  }

  setListener(x: number, y: number, z: number, yaw: number): void { this.lx = x; this.ly = y; this.lz = z; this.yaw = yaw; }

  /** render these families' variants in the background, one per idle slice, in the order given */
  prewarm(names: readonly string[]): void {
    if (!this.live || !this.host.ready) return;
    for (const n of names) { const f = this.family(n); if (f && !this.warm.some(job => job[0] === n)) for (let v = 0; v < f.n; v++) for (let c = 0; c < f.ch; c++) this.warm.push([n, v * 2 + c]); }
    // even the first slice waits for an idle moment: an ambience built on a frame must not render an impulse inside it
    if (!this.warming) { this.warming = true; this.next(); }
  }
  private next(): void {
    if (!this.live) return;
    const w: { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void } = window;
    if (w.requestIdleCallback) {
      let forget = (): void => undefined;
      const id = w.requestIdleCallback(() => { forget(); this.slice(); }, { timeout: 400 });
      forget = this.scope.capture('disposers', () => { w.cancelIdleCallback?.(id); });
    } else this.scope.timeout(audioWarmPaceMs(), () => this.slice());
  }
  private slice(): void {
    if (!this.live) return;
    const job = this.warm.shift();
    if (!job) { this.warming = false; return; }
    const [name, vc] = job;
    if (audioWarmWorkerOn() && this.renderOff(name, vc >> 1, vc & 1)) return;
    this.variant(name, vc >> 1, vc & 1);
    this.next();
  }
  /** DW3: post one prewarm slice to the render worker; false when it must render here (no worker, no work, already done) */
  private renderOff(name: string, v: number, c: number): boolean {
    const f = this.family(name);
    if (!f || this.done.has(`${name}/${v}/${c}`)) return false;
    const work: VoiceWork | undefined = f.work ?? (FAMILIES[name] === f ? { kind: 'family', name } : undefined);
    if (work === undefined) return false;
    const port = this.port();
    if (port === null) return false;
    const id = ++this.jobIds, sr = f.half === true ? this.host.ctx.sampleRate / 2 : this.host.ctx.sampleRate;
    const deadline = this.scope.timeout(WORKER_RENDER_DEADLINE_MS, () => { this.dropPort('deadline'); });
    this.inFlight = { id, name, family: f, v, c, sr, deadline };
    try { port.postMessage({ id, work, sr, seed: v + 1, ch: c }); } catch (error) { this.dropPort(String(error)); }
    return true;
  }
  private port(): VoiceRenderPort | null {
    if (this.renderPort !== undefined) return this.renderPort;
    try { this.renderPort = makeRenderPort(); } catch { this.renderPort = null; }
    const port = this.renderPort;
    if (port === null) return null;
    this.scope.listen(port, 'message', (event: Event) => { this.workerReply((event as MessageEvent<{ id?: unknown; data?: unknown; error?: unknown }>).data); });
    this.scope.listen(port, 'error', (event: Event) => { event.preventDefault(); this.dropPort('worker failed'); });
    return port;
  }
  /** a worker reply: store the channel unless the family moved on or a play rendered it first, then the next slice */
  private workerReply(reply: { id?: unknown; data?: unknown; error?: unknown }): void {
    const job = this.inFlight;
    if (!this.live || job === null || reply.id !== job.id) return;
    if (!(reply.data instanceof Float32Array)) { this.dropPort(typeof reply.error === 'string' ? reply.error : 'malformed reply'); return; }
    this.inFlight = null; this.scope.cancelTimer(job.deadline);
    if (this.family(job.name) === job.family && !this.done.has(`${job.name}/${String(job.v)}/${String(job.c)}`)) this.store(job.name, job.family, job.v, job.c, reply.data, job.sr);
    this.next();
  }
  /** the worker is gone for this page: the job in flight (if any) and the rest render here */
  private dropPort(reason: string): void {
    console.warn(`[audio] voice render worker off: ${reason}`);
    const job = this.inFlight;
    this.renderPort?.terminate(); this.renderPort = null;
    this.inFlight = null;
    if (job !== null) this.scope.cancelTimer(job.deadline);
    if (job !== null && this.live) { this.variant(job.name, job.v, job.c); this.next(); }
  }
  /** one rendered channel into its variant's AudioBuffer (made by the first channel stored) */
  private store(name: string, f: Family, v: number, c: number, data: Float32Array, sr: number): void {
    const list = this.bufs.get(name) ?? []; this.bufs.set(name, list);
    const b = list[v] ?? observeAudioMemory(this.host.ctx.createBuffer(f.ch, data.length, sr), {
      owner: this.memoryOwner, asset: `audio/procedural/${name}/${String(v)}`,
    }); list[v] = b;
    b.getChannelData(c).set(data);
    this.done.add(`${name}/${String(v)}/${String(c)}`);
  }
  /** one variant rendered into its AudioBuffer — every channel, or only `ch` (prewarm renders a stereo IR a channel per slice) */
  private variant(name: string, v: number, ch = -1): AudioBuffer | undefined {
    const f = this.family(name); if (!f) return undefined;
    const ctx = this.host.ctx, sr = f.half === true ? ctx.sampleRate / 2 : ctx.sampleRate;
    for (let c = 0; c < f.ch; c++) {
      if ((ch >= 0 && c !== ch) || this.done.has(`${name}/${String(v)}/${String(c)}`)) continue;
      this.store(name, f, v, c, f.gen(sr, v + 1, c), sr);
    }
    return this.bufs.get(name)?.[v];
  }

  /** every channel of every variant of `name` is rendered (a caller can build on it without a synchronous render) */
  has(name: FamilyName): boolean { const f = this.family(name); if (!f) return false; for (let v = 0; v < f.n; v++) for (let c = 0; c < f.ch; c++) if (!this.done.has(`${name}/${v}/${c}`)) return false; return true; }

  /** a procedural family not yet wholly rendered (a caller that must not render on this frame waits for its prewarm) */
  rendering(name: FamilyName): boolean { return this.family(name) !== undefined && !this.has(name); }

  /** a family's first variant (the IRs, the bubble bed), rendered now if it is not yet */
  buffer(name: FamilyName): AudioBuffer | undefined {
    if (!this.live || !this.host.ready) return undefined;
    const entry = this.tables.get(name);
    return entry && 'clips' in entry ? entry.clips()?.[0]?.buffer : this.variant(name, 0);
  }

  /** play a random variant (never the same one twice in a row); returns the source, or undefined before the first gesture */
  play(name: FamilyName, o: PlayOpts = {}): AudioBufferSourceNode | undefined {
    const entry = this.tables.get(name);
    if (entry && 'clips' in entry) return this.sample(entry.clips() ?? [], o, entry.policy);
    const f = this.family(name);
    if (!f || !this.host.ready) return undefined;
    let dist = 0;
    if (o.at) { const dx = o.at.x - this.lx, dy = o.at.y - this.ly, dz = o.at.z - this.lz; dist = Math.sqrt(dx * dx + dy * dy + dz * dz); if (dist > 150) return undefined; }
    const prev = this.last.get(name) ?? -1;
    let v = Math.floor(audioRandom() * f.n); if (f.n > 1 && v === prev) v = (v + 1) % f.n;
    this.last.set(name, v);
    const buf = this.variant(name, v);
    if (!buf) return undefined;
    const c = this.host.ctx, t = c.currentTime + (o.delay ?? 0);
    tap.sound?.(`voices:${name}`);
    const src = ownAudioSource(c.createBufferSource()); src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (audioRandom() * 2 - 1) * (o.jitter ?? 0.05));
    const g = c.createGain(); g.gain.value = o.gain ?? 1;
    src.connect(g);
    let node: AudioNode = g, pan = o.pan ?? 0;
    if (o.at) {
      const dx = o.at.x - this.lx, dz = o.at.z - this.lz;
      g.gain.value *= 1 / (1 + dist / 9) ** 1.4;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 12000 / (1 + dist / 22);
      node.connect(lp); node = lp;
      pan = panFromYaw(dx, dz, this.yaw, 0.8, dist);
    }
    if ((pan !== 0 || (o.panTo !== undefined && !o.at)) && 'createStereoPanner' in c) {
      const p = c.createStereoPanner(), clampP = (x: number) => Math.max(-1, Math.min(1, x));
      p.pan.setValueAtTime(clampP(pan), t);
      if (o.panTo !== undefined && !o.at) p.pan.linearRampToValueAtTime(clampP(o.panTo), t + buf.duration / src.playbackRate.value);
      node.connect(p); node = p;
    }
    node.connect(o.out ?? this.host.sfx);
    src.start(t);
    return src;
  }

  /** diagnostics: variants rendered per family */
  get rendered(): Record<string, number> { const o: Record<string, number> = {}; for (const [k, list] of this.bufs) o[k] = list.filter((b) => b !== undefined).length; return o; }
}

export { VoicePool as Voices };
