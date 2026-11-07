/** Exact retired reflection adapter, retained only for independent legacy laws.
 * Live products enter closed chapter rows and cannot import this fixture. */
import * as v from 'valibot';
import type { SimHost } from '../../src/server/engine/sim';
import { bindBorrowedMethod, readBorrowedOwner } from '../../src/shared/game/plugin/borrowed';
import { DirectorScriptStageLane } from '../../src/shared/game/plugin/director';

const borrowedPath = { owner: v.pipe(v.string(), v.minLength(1), v.maxLength(96)), path: v.pipe(v.array(v.union([v.string(), v.number()])), v.minLength(1), v.maxLength(16)) };
const argument = v.union([v.string(), v.number(), v.boolean(), v.null()]);
const DirectorBindingsSchema = v.strictObject({
  observations: v.pipe(v.record(v.string(), v.union([v.number(), v.strictObject({ ...borrowedPath,
    args: v.exactOptional(v.pipe(v.array(argument), v.maxLength(16))), present: v.exactOptional(v.boolean()), fallback: v.exactOptional(v.number()),
  })])), v.maxEntries(32)),
  actions: v.pipe(v.record(v.string(), v.pipe(v.array(v.variant('kind', [
    v.strictObject({ kind: v.literal('call'), ...borrowedPath, args: v.optional(v.pipe(v.array(argument), v.maxLength(16)), []) }),
    v.strictObject({ kind: v.literal('set'), ...borrowedPath, value: argument }),
  ])), v.maxLength(16))), v.maxEntries(64)),
  changes: v.optional(v.pipe(v.array(v.strictObject({ ...borrowedPath, keys: v.pipe(v.array(v.string()), v.maxLength(32)) })), v.maxLength(16)), []),
  source: v.picklist(['matching', 'optional']), initialDt: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0),
});


export function bindLegacyDirector(data: unknown, script: ConstructorParameters<typeof DirectorScriptStageLane>[1], input: unknown, owners: ReadonlyMap<string, unknown>,
  scope: { readonly disposed: boolean; readonly onDispose: (cleanup: () => void) => void }, restoring = false, host?: SimHost, id?: string): DirectorScriptStageLane {
  const rows = v.parse(DirectorBindingsSchema, input);
  const observations = Object.entries(rows.observations).map(([key, row]) => {
    if (typeof row === 'number') return [key, () => row] as const;
    const call = row.args === undefined ? null : bindBorrowedMethod(owners, row);
    if (call === null) readBorrowedOwner(owners, row);
    return [key, () => {
      const value = call === null ? readBorrowedOwner(owners, row)?.value : call(...(row.args ?? []));
      if (row.present === true) return Number(value !== null && value !== undefined);
      const number = typeof value === 'boolean' ? Number(value) : value ?? row.fallback;
      if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error('Invalid director bound observation');
      return number;
    }] as const;
  });
  const actions = new Map(Object.entries(rows.actions).map(([key, commands]) => {
    const calls = commands.map(command => {
      if (command.kind === 'call') { const call = bindBorrowedMethod(owners, command); return () => { call(...command.args); }; }
      const field = readBorrowedOwner(owners, command);
      if (field === null || typeof field.value !== typeof command.value) throw new Error('Invalid director bound field');
      return () => { field.receiver[field.key] = command.value; };
    });
    return [key, () => { for (const call of calls) call(); }] as const;
  }));
  const changes = rows.changes.map(row => ({ subscribe: bindBorrowedMethod(owners, row), keys: row.keys }));
  const clock = new DirectorScriptStageLane(data, script, { scope, observe: () => Object.fromEntries(observations.map(([key, read]) => [key, read()])),
    emits: { source: rows.source, value: 'literal', actions } }, restoring, rows.initialDt);
  for (const row of changes) {
    const off = row.subscribe((key: unknown, on: unknown) => { if (on === true && typeof key === 'string' && row.keys.includes(key)) clock.changed(); });
    const cleanup = v.parse(v.custom<() => void>(value => typeof value === 'function', 'Director edge cleanup'), off);
    scope.onDispose(cleanup);
  }
  if (host !== undefined) {
    if (id === undefined) throw new Error('Native stage lane requires its declared id');
    clock.registerNative(host, id);
  }
  return clock;
}
