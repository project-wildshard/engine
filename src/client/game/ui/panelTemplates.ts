import type { PanelAction, PanelCondition, PanelTemplate, PanelValue } from '@wildshard/format/panelTemplate';
import type { PanelNode } from '@wildshard/engine/ui/panel';

/** Read only own fields; a template cannot invoke a method or reach a prototype. */
function read(values: unknown, path: string): unknown {
  let current = values;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}
/** Evaluate text or scalar selection without allocating a DOM or changing the lent state. */
export function panelValue(value: PanelValue, values: unknown): string | number | boolean | undefined {
  if (typeof value !== 'object') return value;
  if ('read' in value) {
    const result = read(values, value.read);
    if (result === undefined || typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') return result;
    throw new Error('Panel text requires a scalar');
  }
  if ('concat' in value) return value.concat.map(part => String(panelValue(part, values) ?? '')).join('');
  if ('choose' in value) return panelValue(panelCondition(value.choose, values) ? value.yes : value.no, values);
  return value.lookup[String(panelValue(value.key, values))] ?? value.fallback;
}
/** The same comparison serves repeats, visibility and transient class flags. */
export function panelCondition(condition: PanelCondition, values: unknown): boolean {
  const left = panelValue(condition.left, values), right = panelValue(condition.right, values);
  if (condition.op === 'eq') return left === right;
  if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) throw new Error('Panel comparison requires finite numbers');
  return condition.op === 'lt' ? left < right : left >= right;
}
/** Finite markup plus captured button arguments; safe to run in a headless server. */
export function expandPanelTemplates(templates: readonly PanelTemplate[], values: unknown): {
  nodes: PanelNode[]; actions: { ref: string; action: PanelAction; value: unknown }[];
} {
  const actions: { ref: string; action: PanelAction; value: unknown }[] = [];
  let count = 0;
  const node = (row: PanelTemplate, context: unknown): PanelNode => {
    if (++count > 4096) throw new RangeError('Expanded panel exceeds its node bound');
    const result: PanelNode = {
      ...(row.tag === undefined ? {} : { tag: row.tag }), ...(row.button === undefined ? {} : { button: row.button }),
      ...(row.cls === undefined ? {} : { cls: String(panelValue(row.cls, context)) }),
      ...(row.text === undefined ? {} : { text: String(panelValue(row.text, context) ?? '') }),
      ...(row.ref === undefined ? {} : { ref: String(panelValue(row.ref, context)) }),
      ...(row.attrs === undefined ? {} : { attrs: row.attrs }),
      ...(row.props === undefined ? {} : { props: row.props.map(([key, value]) => [key, String(panelValue(value, context))] as const) }),
      ...(row.input === undefined ? {} : { input: { ...(row.input.type === undefined ? {} : { type: row.input.type }),
        ...(row.input.maxLength === undefined ? {} : { maxLength: row.input.maxLength }), ...(row.input.autocomplete === undefined ? {} : { autocomplete: row.input.autocomplete }),
        ...(row.input.spellcheck === undefined ? {} : { spellcheck: row.input.spellcheck }), ...(row.input.value === undefined ? {} : { value: String(panelValue(row.input.value, context)) }) } }),
      ...(row.children === undefined ? {} : { children: rows(row.children, context) }),
    };
    if (row.action !== undefined) {
      if (result.ref === undefined) throw new Error('Panel action requires a ref');
      actions.push({ ref: result.ref, action: row.action, value: row.action.arg === undefined ? undefined : panelValue(row.action.arg, context) });
    }
    return result;
  };
  function rows(entries: readonly PanelTemplate[], context: unknown): PanelNode[] { return entries.flatMap(row => {
    const repeat = row.repeat;
    if (repeat === undefined) return row.when === undefined || panelCondition(row.when, context) ? [node(row, context)] : [];
    const source = read(context, repeat.source);
    if (!(Array.isArray(source) || typeof source === 'number' && Number.isSafeInteger(source) && source >= 0)) throw new Error('Invalid panel repeat');
    const items: readonly unknown[] = Array.isArray(source) ? source : Array.from({ length: Math.min(257, source) }, (_, i) => i);
    if (items.length > 256) throw new RangeError('Panel repeat exceeds its bound');
    return items.flatMap((item, index) => {
      const next = { ...(typeof context === 'object' && context !== null ? context : {}), [repeat.as]: item, ...(repeat.index === undefined ? {} : { [repeat.index]: index }) };
      return row.when === undefined || panelCondition(row.when, next) ? [node(row, next)] : [];
    });
  }); }
  return { nodes: rows(templates, values), actions };
}
