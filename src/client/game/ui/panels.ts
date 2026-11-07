import type { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { declarePanel as declare, type PanelChild as Child, type PanelNode as Node, type PanelStyle as Style, type PanelSvg as Svg, type PanelView as View } from '@wildshard/engine/ui/panel';
import { mountUi, uiScope } from '@wildshard/engine/ui/ownership';
import { listenPage } from '@wildshard/engine/input/dom';

/** One declared panel element: tag, classes, strings, attributes, static style, children and a ref (SF28). */
export type PanelNode = Node;
/** A built panel: its root and the verbs a shard drives it with; it never touches the elements. */
export type PanelView = View;
/** An inline SVG icon as data (tag, attributes, children). */
export type PanelSvg = Svg;
/** A panel element's child: an element or an SVG icon. */
export type PanelChild = Child;
/** Static inline style (camelCase keys). */
export type PanelStyle = Style;

/** Build a declared panel from data (detached). Place its root with `mountPanel`, `ctx.hud.widget` or `ctx.hud.pin`. */
export function declarePanel(spec: PanelNode): PanelView { return declare(spec); }
/** A UI scope under the current owner (the level, else the engine): a panel's lifetime. */
export function panelScope(name: string): Scope { return uiScope(name); }
/**
 * Mount a panel on the shared HUD root (band 1) for the scope's life; `parent` mounts it inside another HUD element,
 * `before` keeps an exact insertion position.
 */
export function mountPanel(view: PanelView, scope: Scope, parent?: HTMLElement, before?: ChildNode | null): void {
  mountUi(view.root, scope, parent, before);
}

/** Content and input policy for a mounted panel; layer, focus and submit rules remain caller bindings. */
export interface DeclaredPanelPolicy {
  readonly lifetime?: 'persistent' | 'open';
  readonly showClass?: string;
  readonly closeRef?: string;
  readonly closeKeys?: readonly string[];
  readonly stopEvents?: readonly ('pointerdown' | 'touchstart' | 'mousedown')[];
  /** Bind custom keys, focus/input guards or a UI layer to this view's actual lifetime. */
  readonly bind?: (view: PanelView, scope: Scope, close: () => void) => void;
  readonly render?: (view: PanelView) => void;
}

/** Declared content with scoped row replacements and an explicit persistent or per-open lifetime. */
export class DeclaredPanel {
  onOpen?: () => void;
  onClose?: () => void;
  private opened = false;
  /** when it last opened (the event clock): the key press that opened it must not also close it */
  private openedAt = 0;
  private mounted: { view: PanelView; scope: Scope } | null = null;
  private rows: Scope | null = null;
  constructor(private readonly content: () => PanelNode, private readonly owner: Scope,
    private readonly policy: DeclaredPanelPolicy = {}) {
    if ((policy.closeKeys?.length ?? 0) > 32 || (policy.stopEvents?.length ?? 0) > 3) throw new RangeError('Panel input policy is unbounded');
    if (policy.lifetime !== 'open') this.mount();
    owner.onDispose(() => {
      this.opened = false;
      if (policy.lifetime === 'open') { this.mounted = null; this.rows = null; }
    });
  }
  get view(): PanelView {
    if (this.mounted === null) throw new Error('Panel has no mounted view');
    return this.mounted.view;
  }
  get root(): HTMLElement { return this.view.root; }
  get isOpen(): boolean { return this.opened; }
  private mount(): void {
    const scope = this.policy.lifetime === 'open' ? this.owner.child('panel') : this.owner;
    const view = declarePanel(this.content());
    this.mounted = { view, scope };
    if (this.policy.closeRef !== undefined) view.on(this.policy.closeRef, 'click', e => { e.stopPropagation(); this.close(); }, scope);
    for (const event of this.policy.stopEvents ?? []) view.on('', event, e => { e.stopPropagation(); }, scope);
    if (this.policy.closeKeys !== undefined) listenPage(scope, 'keydown', e => {
      if (!this.opened || e.repeat || e.timeStamp <= this.openedAt || !this.policy.closeKeys?.includes(e.code)) return;
      e.preventDefault(); e.stopPropagation(); this.close();
    }, { capture: true, on: 'document' });
    this.policy.bind?.(view, scope, () => { this.close(); });
    mountPanel(view, scope);
  }
  /** Old row listeners retire before replacement content is bound. */
  protected renderRows(nodes: readonly PanelNode[], ref = 'body'): Scope {
    if (this.mounted === null) throw new Error('Panel has no mounted view');
    this.rows?.dispose();
    this.view.fill(ref, nodes);
    this.rows = this.mounted.scope.child('rows');
    return this.rows;
  }
  render(): void { this.policy.render?.(this.view); }
  open(): void {
    if (this.opened || this.owner.disposed) return;
    if (this.mounted === null) this.mount();
    this.opened = true; this.openedAt = diagnosticNow(); this.render();
    if (this.policy.showClass !== undefined) this.view.flag('', this.policy.showClass, true);
    this.onOpen?.();
  }
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    if (this.policy.showClass !== undefined) this.view.flag('', this.policy.showClass, false);
    if (this.policy.lifetime === 'open') this.view.blur();
    try { this.onClose?.(); }
    finally {
      if (this.policy.lifetime === 'open') {
        const mounted = this.mounted;
        this.mounted = null; this.rows = null;
        mounted?.scope.dispose();
      }
    }
  }
}
