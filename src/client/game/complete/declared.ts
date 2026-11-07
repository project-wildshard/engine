import type { CompletionRows } from '@wildshard/format/completion';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { LiveMarker } from '@wildshard/engine/quest/view';
import type { ShardContext } from '../plugin/context';
import { findTitleManifest } from '../shard/titleList';
import { findChunk } from '../shard/registry';
import { travel } from '../travel/travel';
import { ShardComplete, completeEntry, setCompleteEntry, type CompleteEntry, type ShardCompleteData } from './ShardComplete';
import { installEnteredLevelService } from '../shard/retainedHooks';

/** Live progress remains in its existing owner; the card reads these values without copying or saving them. */
export interface CompletionProgress {
  readonly rows: readonly { def: { id: string; name: string; count: number; event?: string | undefined }; count: number; earned: boolean }[];
  readonly earnedCount: number;
  readonly title: { title: string } | null;
  readonly playS: number;
}
/** A declared card's page control; reward clocks may hand over carry ownership only once. */
export interface Completion {
  showAfterReward: () => boolean;
  open: () => void;
  readonly up: boolean;
  leftMarkers: () => LiveMarker[];
}
const completions = new WeakMap<CompletionContext['scope'], Completion>();
/** Borrow a card already installed in this entry; no new UI or carry owner. */
export function enteredCompletion(scope: CompletionContext['scope']): Completion | undefined {
  return scope.disposed ? undefined : completions.get(scope);
}
/** Display elapsed play time using whole minutes, retaining the short initial interval. */
export function fmtPlayTime(s: number): string {
  const m = Math.floor(s / 60);
  if (m < 1) return '< 1m';
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
/** Renderer-free projection of admitted find groups and current progress. No flag, save or world writes occur. */
export function completionProjection(rows: CompletionRows, flags: Pick<Flags, 'has'>, progress: CompletionProgress | undefined,
  title: string = rows.title, next?: string, anchors?: ReadonlyMap<string, { readonly x: number; readonly z: number }>): { data: ShardCompleteData; markers: LiveMarker[] } {
  const groups = rows.groups.map(group => ({ ...group, left: group.spots.map(spot => { const at = spot.anchor === undefined ? undefined : anchors?.get(spot.anchor); return at === undefined ? spot : { ...spot, x: at.x, z: at.z }; }).filter(spot => !flags.has(spot.flag)) }));
  const todo = groups.flatMap(group => group.todo === 'count' ? group.left.length === 0 ? [] : [`${group.left.length} ${group.label}`] : group.left.map(spot => spot.label));
  for (const row of progress?.rows ?? []) if (!row.earned && !rows.coveredEvents.includes(row.def.event ?? ''))
    todo.push(row.def.count > 1 ? `${row.def.name} ${row.count} / ${row.def.count}` : row.def.name);
  const stats = rows.stats.map(({ label, value }) => {
    if (value.kind === 'time') return { label, value: fmtPlayTime(progress?.playS ?? 0) };
    if (value.kind === 'title') return { label, value: progress?.title?.title ?? value.fallback };
    let got: number, total: number;
    if (value.kind === 'achievements') { got = progress?.earnedCount ?? 0; total = progress?.rows.length ?? 0; }
    else if (value.kind === 'flags') { got = value.flags.filter(flag => flags.has(flag)).length; total = value.flags.length; }
    else { const group = groups.find(candidate => candidate.id === value.group); if (group === undefined) throw new Error('Missing admitted completion group'); got = group.spots.length - group.left.length; total = Math.max(value.total, group.spots.length); }
    return { label, value: `${got} / ${total}`, frac: got / Math.max(1, total) };
  });
  return { data: { ...rows.card, title, stats, todo: todo.length > rows.maximumTodo
    ? [...todo.slice(0, rows.maximumTodo - 1), `+${todo.length - rows.maximumTodo + 1} ${rows.more}`] : todo,
  ...(next === undefined ? {} : { next }) }, markers: groups.flatMap(group => group.left.map(spot => ({ id: spot.flag, label: spot.short, short: spot.short, x: spot.x, z: spot.z }))) };
}

/** The existing play services borrowed by the card; no caller supplies a policy callback or a second clock. */
export interface CompletionContext {
  readonly scope: ShardContext['scope']; readonly system: ShardContext['system']; readonly product: ShardContext['product'];
  readonly manifest: Pick<ShardContext['manifest'], 'slug' | 'next'>;
  readonly game: { readonly runtime?: { readonly world: { readonly player: {
    readonly position: { readonly x: number; readonly z: number }; readonly velocity: { set: (x: number, y: number, z: number) => unknown }; carried: boolean;
  } } | null; readonly play: { readonly weapons: { visible: boolean }; readonly audio: { worldMuted: boolean };
    readonly hud: { toast: (text: string) => void; onResume?: (() => void) | undefined; exitToMenu?: (() => void) | undefined };
    readonly animals: { readonly animals: readonly { readonly alive: boolean; readonly aggressive?: boolean; readonly position: { readonly x: number; readonly z: number } }[] };
  } | null } };
}
/** Install the admitted card on the actual play owner. Inputs are data and borrowed platform owners, never shard callbacks. */
export function installCompletion(ctx: CompletionContext, flags: Flags, progress: CompletionProgress | undefined, objective?: HTMLElement, anchors?: ReadonlyMap<string, { readonly x: number; readonly z: number }>): Completion {
  const rows = ctx.product.section('ui/completion'), runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (world === undefined || world === null || play === undefined || play === null) throw new Error('Completion requires the normal play owner');
  const player = world.player, card = new ShardComplete(), title = (findChunk(ctx.manifest.slug)??findTitleManifest(ctx.manifest.slug))?.name ?? rows.title;
  const next = ctx.manifest.next === undefined ? undefined : findChunk(ctx.manifest.next)??findTitleManifest(ctx.manifest.next);
  const project = () => completionProjection(rows, flags, progress, title, next?.name, anchors);
  let wasMuted = false;
  const close = (): void => { card.close(); player.carried = false; play.weapons.visible = true; objective?.classList.remove('ws-quest-hide'); };
  const open = (): void => {
    if (card.isOpen) return;
    flags.set(rows.seenFlag);
    if (document.pointerLockElement) document.exitPointerLock();
    player.carried = true; player.velocity.set(0, 0, 0); play.weapons.visible = false;
    wasMuted = play.audio.worldMuted; play.audio.worldMuted = true;
    card.open(project().data, {
      keep: () => { close(); play.audio.worldMuted = wasMuted; play.hud.onResume?.(); },
      next: () => { if (next !== undefined) { close(); travel({ to: next.slug, mode: 'enter' }); } },
      title: () => { close(); play.hud.exitToMenu?.(); },
    });
  };
  // the pause menu's complete row is one per page: a retained (grid) runtime holds it only while entered
  let mine: CompleteEntry | null = null;
  const syncEntry = (): void => { mine = flags.has(rows.doneFlag) ? { label: `${title} complete`, sub: rows.menuSubtitle, open } : null; setCompleteEntry(mine); };
  installEnteredLevelService(ctx, (scope) => {
    syncEntry(); const off = flags.onChange(flag => { if (flag === rows.doneFlag) syncEntry(); });
    scope.onDispose(() => { off(); if (mine !== null && completeEntry() === mine) setCompleteEntry(null); mine = null; });
  });
  ctx.scope.onDispose(() => { card.close(); });
  let offered = false, checkT = 0;
  ctx.system({ id: rows.system, phase: 'update', before: rows.before, after: rows.after, run: (_dt, t) => {
    if (offered || t - checkT < rows.pollSeconds) return;
    checkT = t;
    if (!flags.has(rows.doneFlag) || flags.has(rows.seenFlag) || player.carried || card.isOpen
      || play.animals.animals.some(animal => animal.alive && animal.aggressive === true && Math.hypot(animal.position.x - player.position.x, animal.position.z - player.position.z) < rows.safeRadius)) return;
    offered = true;
    if (rows.trigger === 'quest') open(); else play.hud.toast(`${title}${rows.toastSuffix}`);
  } });
  const completion: Completion = { showAfterReward: () => { if (flags.has(rows.seenFlag)) return false; open(); return true; }, open,
    get up() { return card.isOpen; }, leftMarkers: () => project().markers };
  completions.set(ctx.scope, completion);
  return completion;
}
