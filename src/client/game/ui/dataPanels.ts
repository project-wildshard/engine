import { app } from '@wildshard/engine/app/runtime';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { Scope } from '@wildshard/engine/app/scope';
import type { UiHandle } from '@wildshard/engine/ui/layers';
import { parseQuestPanelCatalogue, type PanelAction, type PanelDefinition } from '@wildshard/format/panelTemplate';
import { DeclaredPanel, panelScope } from './panels';
import { expandPanelTemplates, panelCondition, panelValue } from './panelTemplates';

/** Existing action owners receive captured button values or a form's current text. */
export type PanelActions = ReadonlyMap<string, (value: unknown) => void>;
/** Admit named quest panels before constructing their entered view owners. */
export async function readDataPanels(product: { file: (name: string) => Promise<Uint8Array> }): Promise<Readonly<Record<string, PanelDefinition>>> {
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await product.file('quests/panels.json')));
  return parseQuestPanelCatalogue(input);
}
/** Data-driven repeated panels and forms over the existing scoped panel, input and modal owners. */
export class DataPanel extends DeclaredPanel {
  private readonly data: PanelDefinition;
  private readonly state: { values: () => unknown; actions: PanelActions; live: Scope; run: (action: PanelAction) => void; layer: UiHandle | null };
  private readonly panelOwner: Scope;
  private hide: Scope | null = null;
  constructor(data: PanelDefinition, options: { scope?: Scope; values?: () => unknown; actions?: PanelActions } = {}) {
    const scope = options.scope ?? panelScope('dataPanel');
    const state: DataPanel['state'] = { live: scope, values: options.values ?? (() => ({})), actions: options.actions ?? new Map(),
      run: () => { throw new Error('Panel has not initialized'); }, layer: null };
    const frame = () => {
      const nodes = expandPanelTemplates([data.frame], state.values()).nodes;
      const root = nodes[0]; if (nodes.length !== 1 || root === undefined) throw new Error('Panel requires one frame');
      return root;
    };
    super(frame, scope, { lifetime: data.lifetime, ...(data.showClass === undefined ? {} : { showClass: data.showClass }),
      ...(data.closeRef === undefined ? {} : { closeRef: data.closeRef }), ...(data.closeKeys === undefined ? {} : { closeKeys: data.closeKeys }),
      ...(data.stopEvents === undefined ? {} : { stopEvents: data.stopEvents }),
      bind: (view, live, close) => {
        state.live = live;
        const run = (action: PanelAction): void => { state.run(action); };
        for (const type of ['keydown', 'keypress'] as const) if (data.stopTyping === true || data.keys !== undefined) view.on('', type, event => {
          if (data.stopTyping === true) event.stopPropagation();
          if (type !== 'keydown' || !(event instanceof KeyboardEvent)) return;
          const key = data.keys?.find(row => row.codes.includes(event.code));
          if (key !== undefined) { event.preventDefault(); run(key.action); }
        }, live);
        if (data.inputGuard !== undefined) {
          // This transient DOM guard must expire even while simulation is paused.
          const opened = diagnosticNow(), guard = data.inputGuard;
          view.on(guard.ref, 'beforeinput', event => { if (diagnosticNow() - opened < guard.milliseconds) event.preventDefault(); }, live);
        }
        if (data.layer !== undefined) {
          const layer = app.ui.push('modal', { root: view.root, presentation: 'glass', order: data.layer.order, back: close }, live);
          state.layer = layer;
          live.onDispose(() => { layer.dispose(); });
        }
      },
    });
    this.data = data; this.state = state; this.panelOwner = scope; state.run = action => { this.deliver(action); };
  }
  private deliver(action: PanelAction, captured?: unknown): void {
    const value = action.input === undefined ? captured ?? (action.arg === undefined ? undefined : panelValue(action.arg, this.state.values())) : this.view.value(action.input);
    const run = this.state.actions.get(action.id);
    if (run === undefined) throw new Error(`Unbound panel action ${action.id}`);
    if (action.close === true) this.close();
    run(value);
  }
  override render(): void {
    const source = this.data.body ?? this.data.frame.children ?? [], expanded = expandPanelTemplates(source, this.state.values());
    const scope = this.data.lifetime === 'open' ? this.state.live.child('actions') : this.renderRows(expanded.nodes, this.data.body === undefined ? '' : 'body');
    for (const row of expanded.actions) this.view.on(row.ref, 'click', event => {
      event.stopPropagation(); this.deliver(row.action, row.value);
      if (this.data.lifetime !== 'open' || this.isOpen) this.render();
    }, scope);
  }
  override open(values?: unknown, actions?: PanelActions): void {
    if (this.data.lifetime === 'open') this.close();
    if (values !== undefined) this.state.values = () => values;
    if (actions !== undefined) this.state.actions = actions;
    super.open();
    if (this.isOpen && this.data.focus !== undefined) this.view.select(this.data.focus);
  }
  override close(): void {
    if (this.data.lifetime === 'open' && this.isOpen) this.view.blur();
    this.state.layer?.dispose(); this.state.layer = null;
    super.close();
  }
  /** Replace a transient readout and restart its original animation and scoped hide deadline. */
  show(values: unknown): void {
    if (this.panelOwner.disposed) return;
    const transient = this.data.transient, cls = this.data.showClass;
    if (transient === undefined || cls === undefined) throw new Error('Panel is not transient');
    this.state.values = () => values; this.render(); this.view.restart('', cls);
    for (const flag of transient.flags) this.view.flag('', flag.cls, panelCondition(flag.when, values));
    this.hide?.dispose();
    const hide = this.panelOwner.child('hide'); this.hide = hide;
    hide.timeout(transient.milliseconds, () => { this.view.flag('', cls, false); hide.dispose(); });
  }
}
