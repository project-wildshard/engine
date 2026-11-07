import { Vector3, type PerspectiveCamera } from 'three';
import type { BossPresentation, BossScript } from '@wildshard/engine/ai/BossBrain';
import type { NetClient } from '@wildshard/engine/net/client';
import { ENCOUNTER_CLASS } from '@wildshard/engine/net/netSchemas';
import type { EncounterReward } from '@wildshard/engine/sim/encounterRows';
import type { EliteBar, SkullMark } from '@wildshard/engine/ui/EliteBar';
import { engineString } from '@wildshard/engine/strings';

/** One fight or lair this frame, as a client sees it. `body` is the row's handle, 0 while no body is out. */
export interface EncounterRow { readonly id: string; readonly kind: string; readonly state: string; readonly hp: number; readonly phase: number; readonly shield: boolean; readonly body: number;
  /** A hold-to-skip's ring, 0 to 1. */ readonly skip: number;
  /** Counts of a lair's banners and signature moves. */ readonly banners: number; readonly signatures: number;
  /** A lair on the map, and how much of its sleep is left, 0 to 1. */ readonly known: boolean; readonly sleep: number;
  /** Where the fight's reward waits to be taken, or null. */ readonly reward: EncounterReward | null }
/**
 * E6 COMBAT: the one thing a bar asks of the world. A page's brains still present by themselves, and the flip takes them away
 * with `installLoot`'s law; after it the `encounter` rows are this feed, and these views are what draws a bar. A page has one
 * driver for a bar: the brain or the feed, never both.
 */
export interface EncounterFeed { readonly rows: () => readonly EncounterRow[] }
const PREFIX = 'encounter:';

/** The server's encounters in the newest frame. Rows the frame doesn't carry aren't in this cell's view. */
export function netEncounterFeed(client: Pick<NetClient, 'entities' | 'fields' | 'latest'>): EncounterFeed {
  const out: EncounterRow[] = [];
  return { rows: () => {
    out.length = 0;
    const { latest } = client;
    if (latest === null) return out;
    for (const [handle, info] of client.entities) {
      if (info.cls.cls !== ENCOUNTER_CLASS.cls) continue; // the shell's bundle has its own copy of the class
      const row = client.fields(latest, handle);
      if (row !== null) out.push({ id: info.id.slice(PREFIX.length), kind: String(info.initial['kind']), state: String(row['state']), hp: Number(row['hp']), phase: Number(row['phase']), shield: row['shield'] === true || row['shield'] === 1, body: Number(row['body']),
        skip: Number(row['skip']), banners: Number(row['banners']), signatures: Number(row['signatures']), known: row['known'] === true, sleep: Number(row['sleep']), reward: row['rewarded'] === true ? { x: Number(row['rewardX']), y: Number(row['rewardY']), z: Number(row['rewardZ']) } : null });
    }
    return out;
  } };
}

/** What a boss's bar says that a row doesn't: the pack's words. */
export interface BossBarCard {
  readonly id: string; readonly name: string; readonly title: string; readonly retryTitle: string;
  /** `name` is a phase's line in the kill feed. */
  readonly phases: readonly { readonly at: number; readonly caption: string; readonly name?: string }[];
}
/** What a boss's moments say past its bar, as `BossBrain`'s host hears them on a page: all of it is this page's, none of it is law. */
export interface BossRowVoice {
  /** The fight's score and stings. A reward's `pickup` sting is the press's, not a row's. */
  readonly music?: (event: 'intro' | 'phase' | 'victory' | 'death', intensity?: number) => void;
  readonly feed?: (line: string) => void;
  /** A win with nothing left to take. */
  readonly toast?: (line: string) => void;
  /** A fight's own word on its win, for a fight that has one. */
  readonly won?: () => void;
  /** A fight's intro holds a page's weapons and legs, as its host's `lockInput` does. */
  readonly lock?: (on: boolean) => void;
  /** Analytics: the page's half of `boss.attempt`. */
  readonly attempt?: (outcome: 'started' | 'won' | 'died' | 'left') => void;
  /** A frame of an intro: the view turns toward `body`, the row's handle, as the brain's `faceToward` does on a page. */
  readonly face?: (body: number, dt: number) => void;
  /** A dormant fight armed: a quest summoned it. */
  readonly summoned?: () => void;
}
/** A reward as a page draws it. `hide` says whether the row ended on this player's press: what's in hand changes then, not at the press. */
export interface BossRowDrop { readonly show: (at: EncounterReward) => void; readonly hide: (taken: boolean) => void }
/** How long a press waits for its row to end. A press is judged where the server has the body, a command behind. */
const PRESS_WAIT = 1.5;
/** A reward the rows say lies on the ground. A press takes the orb away at once, and only the row says it worked: one that still stands after the wait was refused, and comes back. */
export class RowReward {
  private out = false; private waiting = 0;
  private readonly drop: BossRowDrop;
  constructor(drop: BossRowDrop) { this.drop = drop; }
  pressed(): void { this.waiting = PRESS_WAIT; }
  draw(at: EncounterReward | null, dt: number): void {
    if (this.waiting > 0 && at !== null && (this.waiting -= dt) <= 0) this.out = false;
    if ((at !== null) === this.out) return;
    this.out = at !== null;
    if (at !== null) { this.drop.show(at); return; }
    const taken = this.waiting > 0;
    this.waiting = 0; this.drop.hide(taken);
  }
}
/** The two points a `Boss` keeps of a fight its row draws. */
export interface RowFightPoints { readonly rewardPoint: BossScript['rewardPoint']; readonly respawnPoint: BossScript['respawnPoint'] }
/** What a `Boss` holds for a fight the server steps. Its bar and cards come off `BossRowBar`, so no brain ever turns this: it answers with the fight's points, and nothing else of it can move. */
export function rowFightScript<P extends RowFightPoints>(points: P): P & BossScript {
  const still = (): void => undefined;
  return { ...points, inArena: () => false, intro: () => points.rewardPoint(), reset: still, seal: still, begin: still, enterPhase: still, update: still, clampHp: still, setInvulnerable: still, victory: still, hpFrac: 0, shielded: false, dead: false };
}
const HOLD_AFTER_WIN = 1.4;
const fighting = (state: string): boolean => state === 'fight' || state === 'beat';
const engaged = (state: string): boolean => state === 'intro' || fighting(state);
/**
 * A boss's bar and cards off its row, in the order `BossBrain` shows them on a page. Who has died and how often is the room's, so
 * the attempt on the retry card is this client's own count of them. A reward lying on the ground is the page's to draw and the
 * server's to give: `drop` shows it where the row says, and the row ending takes it away. `voice` hears the same moments, and a
 * row that only just came into view has none: an old win or a fight under way isn't this page's to announce.
 */
export class BossRowBar {
  private state = 'dormant'; private shown = 0; private attempts = 1; private won = false; private held = 0; private seen = false;
  private readonly bar: BossPresentation;
  private readonly card: BossBarCard;
  private readonly drop: RowReward | null;
  private readonly voice: BossRowVoice;
  constructor(bar: BossPresentation, card: BossBarCard, drop: BossRowDrop | null = null, voice: BossRowVoice = {}) { this.bar = bar; this.card = card; this.drop = drop === null ? null : new RowReward(drop); this.voice = voice; }
  /** The phase the fight stands in: a score's phase lookup reads this, since the page's script never leaves its first. */
  get phase(): number { return this.shown; }
  /** The player pressed the reward. */
  pressed(): void { this.drop?.pressed(); }
  draw(rows: readonly EncounterRow[], dt: number): void {
    const { bar, card } = this, row = rows.find(entry => entry.id === card.id), state = row?.state ?? 'dormant', was = this.state;
    bar.update(dt);
    if (state !== was) { this.state = state; this.enter(state, was, row, this.seen); }
    this.seen = row !== undefined;
    this.drop?.draw(row?.reward ?? null, dt);
    if (row === undefined) return;
    if (state === 'intro') { bar.setSkip(row.skip); this.voice.face?.(row.body, dt); }
    if (fighting(state)) {
      bar.setHp(row.hp); bar.setShield(row.shield);
      if (row.phase !== this.shown) {
        const rose = row.phase > this.shown, phase = card.phases[row.phase]; this.shown = row.phase;
        if (phase !== undefined) bar.setPhase(row.phase, phase.caption);
        if (rose) { if (phase?.name !== undefined) this.voice.feed?.(`${card.name} · ${phase.name}`); this.voice.music?.('phase', 1); }
      }
    } else if (state === 'victory' && (this.held += dt) > HOLD_AFTER_WIN && bar.barShown) bar.hideBar();
  }
  /** `moment`: the row was in view already, so this change happened now. */
  private enter(state: string, was: string, row: EncounterRow | undefined, moment: boolean): void {
    const { bar, card, voice } = this, phases = card.phases.slice(1).map(phase => phase.at);
    if (was === 'intro') voice.lock?.(false);
    if (engaged(was) && !engaged(state)) voice.attempt?.(state === 'victory' ? 'won' : state === 'armed' ? 'died' : 'left');
    if (state === 'intro') {
      this.shown = row?.phase ?? 0;
      voice.lock?.(true);
      bar.showNameCard(card.name, card.title, this.attempts > 1 || this.won);
      if (moment) { voice.attempt?.('started'); voice.music?.('intro', 1); }
      return;
    }
    if (fighting(state) && !fighting(was)) {
      bar.hideNameCard(); bar.showBar(card.name, phases);
      this.shown = row?.phase ?? 0;
      const phase = card.phases[this.shown]; if (this.shown > 0 && phase !== undefined) bar.setPhase(this.shown, phase.caption);
    } else if (state === 'victory') {
      this.won = true; this.held = 0; bar.setHp(0); bar.setShield(false);
      if (moment && engaged(was)) { voice.music?.('victory'); voice.won?.(); if (row?.reward === null) voice.toast?.(engineString('s_100cbeedfcec', [card.name])); }
    } else if (state === 'armed' && engaged(was)) { bar.hideBar(); bar.hideNameCard(); bar.showRetry(card.retryTitle, ++this.attempts); voice.music?.('death'); }
    else if (state === 'dormant') { bar.hideBar(); bar.hideNameCard(); this.attempts = 1; }
    else if (state === 'armed' && was === 'dormant' && moment) voice.summoned?.();
  }
}

/** What an elite's bar says that a row doesn't. */
export interface EliteBarCard { readonly id: string; readonly name: string; readonly epithet: string; readonly phase2: string; readonly signature: string; readonly lair: { readonly x: number; readonly z: number } }
/** The rows an elite's view needs of the page: where it stands, and how the bar sees it. */
export interface EliteRowPorts {
  readonly player: { readonly position: Vector3 }; readonly camera: PerspectiveCamera;
  /** The head over a row's body, into `to`; false while the page draws no such body. */
  readonly head: (body: number, to: Vector3) => boolean;
  /** A lair's first-kill orb as this page draws it. */
  readonly drop?: (id: string, pressed: () => void) => BossRowDrop;
  /** A lair's score: its banner, its second phase, its fall. */
  readonly sting?: (id: string, event: 'banner' | 'phase2' | 'kill') => void;
  /** A lair fell: its line in the kill feed. */
  readonly trophy?: (id: string) => void;
}
const FADE_AFTER_FALL = 1.6;
type BarOf = Pick<EliteBar, 'show' | 'hide' | 'set' | 'caption' | 'update' | 'banner' | 'skulls'>;
/** The one elite bar off the rows: the nearest aware or engaged lair, as `EliteView` chooses, with every lair's skull, and a banner or a signature's name as a row's count moves. */
export class EliteRowBar {
  private focus: string | null = null; private phase = 0; private fading = 0;
  private readonly at = new Vector3();
  private readonly bar: BarOf;
  private readonly cards: ReadonlyMap<string, EliteBarCard>;
  private readonly ports: EliteRowPorts;
  /** The counts each lair last showed: what a row says when it first arrives is no moment. */
  private readonly shown = new Map<string, { banners: number; signatures: number; phase: number; state: string }>();
  private readonly skulls: SkullMark[] = [];
  private readonly orbs = new Map<string, RowReward>();
  constructor(bar: BarOf, cards: readonly EliteBarCard[], ports: EliteRowPorts) {
    this.bar = bar; this.cards = new Map(cards.map(card => [card.id, card])); this.ports = ports;
  }
  /** A banner shows wherever it is; a signature's name, only under the bar it belongs to. */
  private moments(rows: readonly EncounterRow[]): void {
    for (const row of rows) {
      if (row.kind !== 'elite') continue;
      const seen = this.shown.get(row.id), card = this.cards.get(row.id);
      if (seen === undefined) { this.shown.set(row.id, { banners: row.banners, signatures: row.signatures, phase: row.phase, state: row.state }); continue; }
      if (row.banners !== seen.banners && card !== undefined) { this.bar.banner(card.name, card.epithet); this.ports.sting?.(row.id, 'banner'); }
      if (row.phase > seen.phase && card !== undefined) this.ports.sting?.(row.id, 'phase2');
      if (row.signatures !== seen.signatures && card !== undefined && this.focus === row.id) this.bar.caption(card.signature);
      if (row.state === 'dead' && seen.state !== 'dead' && card !== undefined) { this.ports.trophy?.(row.id); this.ports.sting?.(row.id, 'kill'); }
      seen.banners = row.banners; seen.signatures = row.signatures; seen.phase = row.phase; seen.state = row.state;
    }
  }
  private drawSkulls(rows: readonly EncounterRow[]): void {
    const { skulls } = this;
    skulls.length = 0;
    for (const row of rows) {
      const card = row.kind === 'elite' ? this.cards.get(row.id) : undefined;
      if (card !== undefined) skulls.push({ x: card.lair.x, z: card.lair.z, shown: row.known && row.state !== 'retired', dead: row.state === 'dead', engaged: row.state === 'engaged', countdown: row.sleep });
    }
    this.bar.skulls(skulls, this.ports.player.position);
  }
  /** A lair's orb, for as long as its row says it lies there. */
  private drawOrbs(rows: readonly EncounterRow[], dt: number): void {
    const { drop } = this.ports;
    if (drop === undefined) return;
    for (const row of rows) {
      if (row.kind !== 'elite' || !this.cards.has(row.id)) continue;
      let orb = this.orbs.get(row.id);
      if (orb === undefined) { const made: RowReward = new RowReward(drop(row.id, () => { made.pressed(); })); orb = made; this.orbs.set(row.id, made); }
      orb.draw(row.reward, dt);
    }
  }
  draw(rows: readonly EncounterRow[], dt: number): void {
    const { at, bar, ports } = this, held = rows.find(row => row.id === this.focus);
    this.moments(rows); this.drawOrbs(rows, dt);
    let best = rows.find(row => row.kind === 'elite' && row.state === 'broken') ?? null, nearest = Infinity;
    if (best === null) for (const row of rows) {
      if (row.kind !== 'elite' || (row.state !== 'aware' && row.state !== 'engaged') || !ports.head(row.body, at)) continue;
      const away = at.distanceTo(ports.player.position);
      if (away < nearest) { best = row; nearest = away; }
    }
    if (best === null && held?.state === 'dead') { bar.set(0, 'pinned', null, ports.camera, false); this.fading = FADE_AFTER_FALL; this.focus = null; }
    if (this.fading > 0 && (this.fading -= dt) <= 0 && this.focus === null) bar.hide();
    if ((best?.id ?? null) !== this.focus) this.focusOn(best);
    if (best !== null && this.focus !== null) {
      if (best.state === 'broken') { if (ports.head(best.body, at)) bar.set(0, 'pinned', at, ports.camera, false, true); }
      else {
        if (best.phase > this.phase) { const card = this.cards.get(best.id); if (card !== undefined) bar.caption(card.phase2); }
        if (ports.head(best.body, at)) bar.set(best.hp, best.state === 'engaged' ? 'pinned' : 'head', at, ports.camera, best.shield, false, false);
      }
      this.phase = best.phase;
    }
    this.drawSkulls(rows);
    bar.update(dt);
  }
  private focusOn(row: EncounterRow | null): void {
    const card = row === null ? undefined : this.cards.get(row.id), { bar } = this;
    this.focus = row === null || card === undefined ? null : row.id; this.phase = row?.phase ?? 0;
    if (card === undefined) { if (this.fading <= 0) bar.hide(); return; }
    bar.show(card.name, card.epithet);
    if (row?.state === 'broken') bar.caption('BROKEN');
  }
}
