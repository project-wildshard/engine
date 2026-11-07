import type { Scope } from '../../../shared/engine/app/scope';

/**
 * Declared panels (SF28): content describes a panel's whole element tree as plain data — tags, classes, strings,
 * attributes, static inline style and named refs — and the engine builds it. The content then drives the live panel
 * only through the view's verbs (text, flags, data, style properties, listeners, re-fills), never by touching elements.
 * The tree builds exactly the markup a hand-built panel produced, in the same order, so a converted panel keeps its
 * look and behaviour to the pixel.
 *
 *   const view = declarePanel({ cls: 'ws-ph-count', children: [{ tag: 'span', cls: 'ws-ph-count-label', ref: 'label' }] });
 *   mountUi(view.root, scope);          // or hud.widget / hud.pin with view.root
 *   view.text('label', 'AMBER RESIN');
 *   view.restart('', 'show');           // '' names the root
 *
 * Every string lands as `textContent`; a panel never writes HTML (SF58).
 */

/** the element kinds a panel may declare */
export type PanelTag = 'div' | 'span' | 'b' | 'i' | 'small' | 'p' | 'strong' | 'em' | 'button' | 'input' | 'meter';
type StyleKey = { [K in keyof CSSStyleDeclaration]: K extends string ? CSSStyleDeclaration[K] extends string ? K : never : never }[keyof CSSStyleDeclaration];
/** static inline style, assigned in declaration order (camelCase keys, as `el.style.zIndex`) */
export type PanelStyle = Readonly<Partial<Record<StyleKey, string>>>;
/** an input element's live properties, set in this order (they reflect to attributes as the DOM does) */
export interface PanelInput {
  readonly type?: string; readonly maxLength?: number; readonly value?: string;
  readonly autocomplete?: AutoFill; readonly spellcheck?: boolean;
}
/** one declared element */
export interface PanelNode {
  /** 'div' when absent */
  readonly tag?: PanelTag;
  /** the class list as one string (`className`); absent leaves no class attribute */
  readonly cls?: string;
  /** set before attributes, as `el.dataset[key]` */
  readonly data?: Readonly<Record<string, string>>;
  /** input properties (type, maxLength, value, …) */
  readonly input?: PanelInput;
  /** `button.type` */
  readonly button?: 'button' | 'submit' | 'reset';
  /** extra attributes, in order (`aria-label`, `autocapitalize`, …) */
  readonly attrs?: readonly (readonly [string, string])[];
  /** static inline style */
  readonly style?: PanelStyle;
  /** style properties by CSS name (`--tilt`, `border-color`), through `style.setProperty` */
  readonly props?: readonly (readonly [string, string])[];
  /** text content; wins over children */
  readonly text?: string;
  readonly children?: readonly PanelChild[];
  /** a name the view's verbs reach this element by; unique among live refs */
  readonly ref?: string;
}

/** an inline SVG element (an icon drawn as data): its tag, attributes in order and children, in the SVG namespace */
export interface PanelSvg {
  readonly svg: 'svg' | 'path' | 'circle' | 'g' | 'rect' | 'line' | 'polyline' | 'polygon' | 'ellipse';
  readonly attrs?: readonly (readonly [string, string])[];
  readonly children?: readonly PanelSvg[];
}
/** a panel element's child: an element or an SVG icon */
export type PanelChild = PanelNode | PanelSvg;

/** the live panel: its root and the verbs content drives it with ('' names the root) */
export interface PanelView {
  readonly root: HTMLElement;
  /** the element a ref names, for an engine verb that places it (`hud.widget`, `hud.pin`, a layer) */
  node: (ref: string) => HTMLElement;
  /** whether a ref is live */
  has: (ref: string) => boolean;
  text: (ref: string, text: string) => void;
  /** `classList.toggle(cls, on)` */
  flag: (ref: string, cls: string, on?: boolean) => boolean;
  /** whether a ref carries a class */
  flagged: (ref: string, cls: string) => boolean;
  /** remove a class, reflow, add it again: restarts its CSS animation */
  restart: (ref: string, cls: string) => void;
  /** `dataset[key] = value` */
  data: (ref: string, key: string, value: string) => void;
  /** `style.setProperty(name, value)` (CSS names: `transform`, `--threat`, `border-color`); '' clears it */
  style: (ref: string, name: string, value: string) => void;
  /** listen on a ref for the scope's life */
  on: <K extends keyof HTMLElementEventMap>(ref: string, type: K, fn: (event: HTMLElementEventMap[K]) => void, scope: Scope, opts?: AddEventListenerOptions) => void;
  /** replace a ref's children with declared nodes; the old children's refs leave, the new ones join */
  fill: (ref: string, nodes: readonly PanelChild[]) => void;
  /** an input ref's current value */
  value: (ref: string) => string;
  focus: (ref: string) => void;
  /** focus and select an input ref's text */
  select: (ref: string) => void;
  /** blur whatever inside the panel holds focus */
  blur: () => void;
  /** detach the root from the page */
  remove: () => void;
}

function build(d: PanelNode, refs: Map<string, HTMLElement>): HTMLElement {
  const el = document.createElement(d.tag ?? 'div');
  if (d.cls !== undefined) el.className = d.cls;
  if (d.data) for (const [k, v] of Object.entries(d.data)) el.dataset[k] = v;
  if (d.input && el instanceof HTMLInputElement) {
    const i = d.input;
    if (i.type !== undefined) el.type = i.type;
    if (i.maxLength !== undefined) el.maxLength = i.maxLength;
    if (i.value !== undefined) el.value = i.value;
    if (i.autocomplete !== undefined) el.autocomplete = i.autocomplete;
    if (i.spellcheck !== undefined) el.spellcheck = i.spellcheck;
  }
  if (d.button !== undefined && el instanceof HTMLButtonElement) el.type = d.button;
  for (const [k, v] of d.attrs ?? []) el.setAttribute(k, v);
  if (d.style) Object.assign(el.style, d.style);
  for (const [k, v] of d.props ?? []) el.style.setProperty(k, v);
  if (d.text !== undefined) el.textContent = d.text;
  for (const c of d.children ?? []) el.append(child(c, refs));
  if (d.ref !== undefined) {
    if (refs.has(d.ref)) throw new Error(`Panel: duplicate ref ${d.ref}`);
    refs.set(d.ref, el);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(d: PanelSvg): SVGElement {
  const el = document.createElementNS(SVG_NS, d.svg);
  for (const [k, v] of d.attrs ?? []) el.setAttribute(k, v);
  for (const c of d.children ?? []) el.append(svg(c));
  return el;
}
function child(c: PanelChild, refs: Map<string, HTMLElement>): Element { return 'svg' in c ? svg(c) : build(c, refs); }

/** Build a declared panel (detached); mount its root with the HUD's own verbs. */
export function declarePanel(spec: PanelNode): PanelView {
  const refs = new Map<string, HTMLElement>();
  const root = build(spec, refs);
  const node = (ref: string): HTMLElement => {
    if (ref === '') return root;
    const el = refs.get(ref);
    if (el === undefined) throw new Error(`Panel: no ref ${ref}`);
    return el;
  };
  const input = (ref: string): HTMLInputElement => {
    const el = node(ref);
    if (!(el instanceof HTMLInputElement)) throw new Error(`Panel: ${ref} is not an input`);
    return el;
  };
  const forget = (el: Element): void => { for (const [k, v] of refs) if (el.contains(v)) refs.delete(k); };
  return {
    root, node,
    has: (ref) => ref === '' || refs.has(ref),
    text: (ref, text) => { node(ref).textContent = text; },
    flag: (ref, cls, on) => node(ref).classList.toggle(cls, on),
    flagged: (ref, cls) => node(ref).classList.contains(cls),
    restart: (ref, cls) => { const el = node(ref); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); },
    data: (ref, key, value) => { node(ref).dataset[key] = value; },
    style: (ref, name, value) => { if (value === '') node(ref).style.removeProperty(name); else node(ref).style.setProperty(name, value); },
    on: (ref, type, fn, scope, opts) => { scope.listen(node(ref), type, (e) => { fn(e as HTMLElementEventMap[typeof type]); }, opts); },
    fill: (ref, nodes) => {
      const host = node(ref);
      for (const c of host.children) forget(c);
      host.replaceChildren(...nodes.map((n) => child(n, refs)));
    },
    value: (ref) => input(ref).value,
    focus: (ref) => { node(ref).focus(); },
    select: (ref) => { const el = input(ref); el.focus(); el.select(); },
    blur: () => { const f = document.activeElement; if (f instanceof HTMLElement && root.contains(f)) f.blur(); },
    remove: () => { root.remove(); },
  };
}
