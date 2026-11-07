import { Vector3 } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import type { SystemSpec } from '../app/systems';
import type { BossDefinition, BossPresentation } from '../../../shared/engine/ai/BossBrain';
import type { HudVerbs } from '../../../server/engine/level/context';
import { BossBar } from './BossBar';
import type { DiscSpot } from './hudSlots';
import { icon, type IconId } from './icons';
import type { TabFragment } from './tabs';

/**
 * Declared HUD pieces (SF7f): content describes a marker, a counter, a boss panel, a disc relabel or a text panel as
 * plain data and the engine draws it with the shared HUD's own slots and styles. Every string lands as `textContent`;
 * icons are engine icon ids, never markup. The game validates the data (its format schema) before it reaches here.
 */

/** a label pinned over a world point (the shared `hud.pin` projection) */
export interface DeclaredMarker { readonly kind: 'marker'; readonly id: string; readonly label: string; readonly at: readonly [number, number, number] }
/** a meter row in the status column, its value read from a declared numeric field */
export interface DeclaredCounter {
  readonly kind: 'counter'; readonly id: string; readonly label: string;
  readonly band: 'band.2' | 'band.3' | 'band.4' | 'band.5'; readonly order: number;
  readonly min: number; readonly max: number; readonly field: string;
}
/** the engraved boss bar, name card and retry card for one encounter */
export interface DeclaredBossPanel { readonly kind: 'bossPanel'; readonly id: string; readonly encounter: string; readonly name: string; readonly title: string; readonly retry: string }
/** a label (and optional engine icon) on one of the shared touch discs */
export interface DeclaredRelabel { readonly kind: 'relabel'; readonly id: string; readonly spot: DiscSpot; readonly label: string; readonly icon: IconId | null }
/** a text section inside a menu tab */
export interface DeclaredTextPanel { readonly id: string; readonly order: number; readonly paragraphs: readonly string[] }
/** every declared HUD kind the engine draws */
export type DeclaredHud = DeclaredMarker | DeclaredCounter | DeclaredBossPanel | DeclaredRelabel;

/** what a declared boss panel hands the encounter that drives it */
export interface DeclaredBoss {
  readonly presentation: BossPresentation;
  /** the panel's strings in the shape the boss brain shows them */
  readonly definition: Pick<BossDefinition, 'name' | 'title' | 'retryTitle'>;
}
/** the shared HUD verbs, frame systems, scope and field reads a declaration set draws with */
export interface DeclaredHudPorts {
  /** the level's shared HUD verbs */
  readonly hud: Pick<HudVerbs, 'pin' | 'widget' | 'relabel'>;
  /** registers the counters' late refresh */
  readonly system: (spec: SystemSpec) => void;
  /** owns the boss panels' DOM */
  readonly scope: Scope;
  /** the current value of a declared numeric field */
  readonly read: (field: string) => number;
  /** where boss panels mount (the HUD root by default) */
  readonly bossRoot?: HTMLElement;
}
/** the mounted pieces by declaration id, for tests and bindings */
export interface DeclaredHudHandles {
  readonly markers: ReadonlyMap<string, HTMLElement>;
  readonly counters: ReadonlyMap<string, HTMLMeterElement>;
  /** keyed by encounter id */
  readonly bosses: ReadonlyMap<string, DeclaredBoss>;
}

/** Draw each declaration on the shared HUD for the scope's life; counters refresh in the late phase. */
export function mountDeclaredHud(list: readonly DeclaredHud[], ports: DeclaredHudPorts): DeclaredHudHandles {
  const markers = new Map<string, HTMLElement>(), counters = new Map<string, { el: HTMLMeterElement; field: string }>();
  const bosses = new Map<string, DeclaredBoss>();
  for (const d of list) {
    if (d.kind === 'marker') {
      const el = document.createElement('span'); el.textContent = d.label;
      ports.hud.pin(new Vector3(d.at[0], d.at[1], d.at[2]), el); markers.set(d.id, el);
    } else if (d.kind === 'counter') {
      const el = document.createElement('meter'); el.min = d.min; el.max = d.max; el.value = ports.read(d.field); el.setAttribute('aria-label', d.label);
      ports.hud.widget(d.band, el, d.order); counters.set(d.id, { el, field: d.field });
    } else if (d.kind === 'bossPanel') {
      const bar = ports.bossRoot === undefined ? new BossBar() : new BossBar(ports.bossRoot);
      ports.scope.onDispose(() => { bar.scope.dispose(); });
      bosses.set(d.encounter, { presentation: bar, definition: { name: d.name, title: d.title, retryTitle: d.retry } });
    } else ports.hud.relabel(d.spot, d.label, d.icon === null ? '' : icon(d.icon));
  }
  if (counters.size > 0) ports.system({ id: 'engine.declared.counters', phase: 'late', run: () => {
    for (const { el, field } of counters.values()) { const value = ports.read(field); if (value !== el.value) el.value = value; }
  } });
  return { markers, counters: new Map([...counters].map(([id, c]) => [id, c.el])), bosses };
}

/** a menu tab section of plain paragraphs */
export function textPanelFragment(d: DeclaredTextPanel): TabFragment {
  return { id: d.id, order: d.order, render: (host) => {
    for (const text of d.paragraphs) { const p = document.createElement('p'); p.textContent = text; host.append(p); }
  } };
}
