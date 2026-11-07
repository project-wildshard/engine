import type { App } from './app';

export const PHASES = ['input', 'fixed.pre', 'fixed.step', 'fixed.post', 'update', 'late', 'render'] as const;
export type Phase = typeof PHASES[number];
export type AppState = 'boot' | 'title' | 'loading' | 'play' | 'paused' | 'dead'
  | 'explore' | 'practice' | 'playground' | 'capture' | 'error';
export type RunCondition = (app: App) => boolean;
export type TickRateId = string;

export interface SystemSpec {
  id: string;
  phase: Phase;
  run: (dt: number, t: number) => void;
  before?: readonly string[];
  after?: readonly string[];
  when?: RunCondition;
  tick?: TickRateId;
  core?: boolean;
}

export function inState(...states: AppState[]): RunCondition {
  return (app) => states.includes(app.state);
}

/** Stable Kahn ordering: choose the earliest registered ready system at every step. */
export function sortSystems(systems: readonly SystemSpec[]): readonly SystemSpec[] {
  const byId = new Map(systems.map((system) => [system.id, system]));
  const edges = new Map(systems.map((system) => [system.id, new Set<string>()]));
  const pending = new Map(systems.map((system) => [system.id, 0]));
  function edge(from: string, to: string): void {
    const outgoing = edges.get(from);
    if (!outgoing || !byId.has(to) || outgoing.has(to)) return;
    outgoing.add(to);
    pending.set(to, (pending.get(to) ?? 0) + 1);
  }
  for (const system of systems) {
    for (const id of system.before ?? []) edge(system.id, id);
    for (const id of system.after ?? []) edge(id, system.id);
  }
  const sorted: SystemSpec[] = [];
  const done = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  function cycle(id: string): string[] | undefined {
    const at = stack.indexOf(id);
    if (at !== -1) return [...stack.slice(at), id];
    if (visited.has(id)) return undefined;
    visited.add(id);
    stack.push(id);
    for (const target of edges.get(id) ?? []) {
      const found = cycle(target);
      if (found) return found;
    }
    stack.pop();
    return undefined;
  }
  while (sorted.length < systems.length) {
    const next = systems.find((system) => !done.has(system.id) && pending.get(system.id) === 0);
    if (!next) {
      for (const system of systems) {
        const found = cycle(system.id);
        if (found) throw new Error(`System cycle: ${found.join(' -> ')}`);
      }
      throw new Error('Invalid system dependency graph');
    }
    sorted.push(next);
    done.add(next.id);
    for (const target of edges.get(next.id) ?? []) pending.set(target, (pending.get(target) ?? 0) - 1);
  }
  return sorted;
}
