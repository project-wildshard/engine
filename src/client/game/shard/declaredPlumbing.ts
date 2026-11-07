import { isJsonData } from '@wildshard/format/json';
import type { Scope } from '@wildshard/engine/app/scope';
import type { InputService } from '@wildshard/engine/input/InputService';
import type { DebugRowSpec, TierKnobSchema } from '@wildshard/engine/level/context';
import { parsePlumbing, type PlumbingData } from '@wildshard/format/plumbing';
import { inputWhenMatches, type InputObservation, type InputWhen } from '@wildshard/format/inputDeclarations';

/** Session-owned instance/activity and admitted scene dispatcher; data never calls arbitrary module exports. */
export interface PlumbingPorts {
  instance: string; tier: 'phone' | 'desktop'; scope: Scope; input: InputService;
  active: () => boolean; scene: (id: string) => void;
  knobs: (schema: TierKnobSchema) => void; debugRow: (row: DebugRowSpec) => void;
  /** Trusted item inputs already have a scoped callback; register their keys/touch without a second scene callback. */
  handledInput?: ReadonlySet<string>;
  /** Live host observations. These are not author callbacks or property paths. */
  observation?: InputObservation;
}
/** Resolve scoped context identities and selected tier values for the loader's declared content builders. */
export interface PlumbingHandles {
  contexts: ReadonlyMap<string, string>; knobs: Readonly<Record<string, number | boolean>>;
  knob: (id: string) => number | boolean;
  /** The input owner synchronizes conditional context push/pop before collecting input. */
  update: () => void;
}
/** Resolve a declared quality value before world construction, with an explicit expected scalar kind. */
export function plumbingKnob(input: unknown, tier: 'phone' | 'desktop', id: string, kind: 'number', overrides?: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>>): number;
export function plumbingKnob(input: unknown, tier: 'phone' | 'desktop', id: string, kind: 'boolean', overrides?: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>>): boolean;
export function plumbingKnob(input: unknown, tier: 'phone' | 'desktop', id: string, kind: 'number' | 'boolean', overrides: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>> = {}): number | boolean {
  if (!isJsonData(overrides)) throw new Error('Tier overrides require plain data');
  const row = parsePlumbing(input).knobs.find(entry => entry.id === id);
  const value = row === undefined ? undefined : Object.hasOwn(overrides, row.id) ? overrides[row.id] : row[tier];
  if (value === undefined || typeof value !== kind || typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Unknown or mismatched declared knob ${id}`);
  return value;
}

/** Install declared input through the normal command path and Debug choices through admitted script scene hooks. */
export function installDeclaredPlumbing(input: PlumbingData, ports: PlumbingPorts): PlumbingHandles {
  const data = parsePlumbing(input), adapters = ports;
  if (ports.scope.disposed || !/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ports.instance)) throw new Error('Invalid plumbing instance');
  if (data.input.some(row => row.when !== undefined || row.hiddenWhen !== undefined) && ports.observation === undefined) throw new Error('Conditional input requires host observations');
  for (const row of data.input) {
    if (ports.input.has(`${ports.instance}.${row.id}`)) throw new Error(`Duplicate declared input context ${row.id}`);
    if (row.keysFrom !== undefined && !ports.input.has(row.keysFrom)) throw new Error(`Unknown declared input source ${row.keysFrom}`);
  }
  const matches = (when: InputWhen | undefined): boolean => when === undefined || ports.observation !== undefined && inputWhenMatches(when, ports.observation);
  const knobs = Object.fromEntries(data.knobs.map((row) => [row.id, row[ports.tier]]));
  ports.knobs({ id: `${ports.instance}.${data.namespace}`, defaults: knobs });
  const contexts = new Map<string, string>();
  for (const row of data.input) {
    const id = `${ports.instance}.${row.id}`; contexts.set(row.id, id);
    const enabled = (): boolean => ports.active() && matches(row.when);
    const show = (): boolean => enabled() && (row.hiddenWhen === undefined || !matches(row.hiddenWhen));
    const verbs = Object.fromEntries(Object.entries(row.verbs ?? {}).map(([slot, verb]) => [slot, { ...verb, show }]));
    if (row.touch !== undefined) verbs[row.touch.slot] = { action: row.touch.action, label: row.touch.label, icon: row.touch.icon, show };
    ports.input.register({ id, priority: row.priority, enabled, actions: row.actions.map((action) => action.id),
      keys: Object.fromEntries(row.actions.filter(action => action.keys !== undefined).map((action) => [action.id, action.keys])),
      ...(row.keysFrom === undefined ? {} : { keysFrom: row.keysFrom }), ...(row.blocks === undefined ? {} : { blocks: row.blocks }),
      ...(row.touch === undefined && row.verbs === undefined && row.relabel === undefined ? {} : { touch: { relabel: row.relabel ?? {}, verbs } }) }, ports.scope);
    for (const action of row.actions) {
      const scene = action.scene;
      if (scene !== undefined && !ports.handledInput?.has(action.id)) ports.input.bind(action.id, () => { ports.scene(scene); }, ports.scope, enabled);
    }
    if (row.describe !== undefined) ports.input.bindings.describe({ rows: row.describe }, ports.scope);
    if (matches(row.when)) ports.input.push(id, ports.scope);
  }
  for (const row of data.debug) adapters.debugRow({ ...row, change: (value) => {
    const choice = row.choices.find((entry) => entry.value === value); if (choice === undefined) throw new Error('Unknown declared Debug choice');
    if (choice.scene !== undefined) ports.scene(choice.scene);
  } });
  return { contexts, knobs, knob: id => {
    const value = Object.hasOwn(knobs, id) ? knobs[id] : undefined; if (value === undefined) throw new Error(`Unknown declared knob ${id}`); return value;
  }, update: () => {
    if (ports.scope.disposed) return;
    for (const row of data.input) {
      const id = contexts.get(row.id); if (id === undefined) throw new Error('Missing declared context');
      if (matches(row.when)) { if (!ports.input.active(id)) ports.input.push(id, ports.scope); }
      else ports.input.pop(id);
    }
  } };
}
