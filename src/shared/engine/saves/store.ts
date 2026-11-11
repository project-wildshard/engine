import { appIdentity, installedIdentity, saveEpoch } from '../app/identity';
import * as v from 'valibot';
import { resetLegacy } from './legacy';
import { saveEnvironment } from './environment';
import { keepUnknown, known } from './shape';

/**
 * Where a save key lives; `profile` (reserved, no key yet) is the player above every level.
 * The profile is identity, inventory, gear and titles that travel between levels (docs/design/mmo/MMO-REQUIREMENTS.md
 * M6, SHARD-PLATFORM SP2); it is exported and imported like `global`.
 */
export type SaveScope = 'global' | 'profile' | 'shard' | 'device' | 'session';
/** scope names a `'shard'` namespace may never take: they would share a stored document with that scope */
const RESERVED_NAMESPACES: ReadonlySet<string> = new Set(['global', 'profile', 'device', 'session']);
export interface SaveKeyDef<T> {
  key: string; scope: SaveScope; version: number; schema: v.GenericSchema<unknown, T>; initial: () => T;
  migrate?: Readonly<Record<number, (old: unknown) => unknown>>;
  /** Says only that a file may hold this key, so an import keeps it. The definition that reads it takes its place. */
  stub?: true;
}
export interface SaveSlot<T> { /** Validated existing data, without creating or changing a save. */ peek: (namespace?: string) => T | null;
  /** Storage/admission metadata only; nullable valid values remain distinct from malformed or absent entries. */ status?: (namespace?: string) => 'absent' | 'valid' | 'invalid' | 'future';
  /** Opaque document revision; observes external storage changes without parsing or validating it. */
  revision?: (namespace?: string) => number;
  read: (namespace?: string) => T; write: (value: T, namespace?: string) => boolean; reset: (namespace?: string) => void }
/** Stable local-state identity; an explicit legacy namespace can be copied without depending on a grid cell. */
export interface SaveInstance { id: string; legacy?: string }
/** Instance binding accepts only shard-local definitions; profile/device/session retain their existing scopes. */
export type InstanceSaveKeyDef<T> = SaveKeyDef<T> & { scope: 'shard' };
/** A save slot bound to one durable instance, with no caller-supplied namespace on each operation. */
export interface InstanceSaveSlot<T> { readonly instanceId: string; peek: () => T | null; read: () => T; write: (value: T) => boolean; reset: () => void }
export interface SaveStorage { readonly length: number; key: (index: number) => string | null; getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void }
/** `contract`: the entry was written at this build's own version and still failed, so the save contract broke (WR7). */
export interface SchemaFailure { kind: 'save-schema'; scope: string; key: string; version: number; issue: string; contract?: true }
export interface CorruptSave { scope: string; key: string; at: string; bytes: number }
export interface ImportReport { imported: string[]; skipped: { key: string; reason: string }[] }
interface Entry { v: number; data: unknown }
interface Document { keys: Record<string, unknown>; reset?: number }
interface StoreOptions {
  local?: SaveStorage | null; session?: SaveStorage | null; build?: string; now?: () => string;
  report?: (failure: SchemaFailure) => void;
  persist?: () => Promise<boolean>;
}
/** every save key's prefix: the app's (a wire contract; src/shared/engine/app/identity.ts) */
const savePrefix = (): string => appIdentity().savePrefix;
/**
 * A key's prefix where it is about to be read or written: a store with real storage needs the app's (without it the
 * player's progress would land under another name, so appIdentity() throws); one without storage (a Node script, a
 * bare test) keeps its keys in this process' memory, where any prefix serves.
 */
/** a key's scope part (the name less its prefix), for reports */
const scopeOf = (name: string): string => { const p = installedIdentity()?.savePrefix ?? 'unsaved.'; return name.startsWith(p) ? name.slice(p.length) : name; };
const keyPrefix = (persisted: boolean): string => installedIdentity()?.savePrefix ?? (persisted ? savePrefix() : 'unsaved.');
/** Hidden content namespaces use one leading underscore; paths and embedded underscores stay invalid. */
const shardNamespace = (slug: string): boolean => /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) && !RESERVED_NAMESPACES.has(slug);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const entry = (value: unknown): value is Entry => object(value) && typeof value['v'] === 'number' && Number.isInteger(value['v']) && value['v'] > 0 && Object.hasOwn(value, 'data');
const doc = (value: unknown): value is Document => object(value) && object(value['keys'])
  && (value['reset'] === undefined || (typeof value['reset'] === 'number' && Number.isSafeInteger(value['reset']) && value['reset'] > 0));
const clone = <T>(value: T): T => structuredClone(value);


/** WR7: every definition any store in this process has taken, for `saves.lock.json` (test/saves-lock.test.ts). Stubs only
 *  name a key, so they are not in it. */
const everyDefinition = new Map<string, SaveKeyDef<unknown>>();
export function definedSaveKeys(): ReadonlyMap<string, SaveKeyDef<unknown>> { return everyDefinition; }

/** Renderer-free, write-through save service. Compare persisted text before borrowing a parsed document, preserving other writers. */
export class SaveStore {
  private readonly definitions = new Map<string, SaveKeyDef<unknown>>();
  private readonly memory = new Map<string, string>();
  private readonly documents = new Map<string, { raw: string | null; value: Document }>();
  private readonly entryTexts = new WeakMap<Entry, string | undefined>();
  private readonly failedWrites = new Set<string>();
  private readonly readonlyKeys = new Set<string>();
  private initialized = false;
  private lastStamp = 0;
  private persistence: Promise<boolean> | null = null;
  private readonly options: StoreOptions;
  constructor(options: StoreOptions = {}) { this.options = options; }
  private storage(scope: SaveScope): SaveStorage | null {
    return scope === 'session' ? this.options.session === undefined ? saveEnvironment().storage(scope) : this.options.session
      : this.options.local === undefined ? saveEnvironment().storage(scope) : this.options.local;
  }
  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    try { resetLegacy(this.storage('global'), this.storage('session')); } catch { /* blocked storage: memory keeps this page playable */ }
  }
  private name(scope: SaveScope, namespace?: string): string {
    if (scope === 'shard' && (!namespace || !shardNamespace(namespace))) throw new Error('Shard saves need a slug');
    let persisted = false;
    // a page's storage persists; Node's global localStorage (a script, a bake) does not outlive the process
    try { persisted = saveEnvironment().persistent() && this.storage(scope) !== null; } catch { /* blocked storage: memory only */ }
    return keyPrefix(persisted) + (scope === 'shard' ? namespace : scope);
  }
  private get(scope: SaveScope, name: string): string | null {
    try { if (this.failedWrites.has(name)) return this.memory.get(name) ?? null; const storage = this.storage(scope); return storage ? storage.getItem(name) : this.memory.get(name) ?? null; } catch { return this.memory.get(name) ?? null; }
  }
  private put(scope: SaveScope, name: string, value: string): boolean {
    this.documents.delete(name); this.memory.set(name, value);
    try { const storage = this.storage(scope); if (!storage) { this.failedWrites.add(name); return false; } storage.setItem(name, value); this.failedWrites.delete(name); return true; } catch { this.failedWrites.add(name); return false; }
  }
  private remove(scope: SaveScope, name: string): void {
    this.documents.delete(name); this.memory.delete(name);
    try { this.storage(scope)?.removeItem(name); } catch { /* already absent from memory */ }
  }
  private names(scope: SaveScope): string[] {
    const names = new Set(this.memory.keys());
    try { const storage = this.storage(scope); if (storage) for (let i = 0; i < storage.length; i++) { const name = storage.key(i); if (name) names.add(name); } } catch { /* memory only */ }
    return [...names].filter((name) => name.startsWith(savePrefix()));
  }
  private at(): string {
    const now = this.options.now?.() ?? new Date().toISOString(), epoch = Date.parse(now);
    if (!Number.isFinite(epoch)) return now;
    this.lastStamp = Math.max(epoch, this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }
  private report(scope: string, key: string, version: number, issue: string, contract = false): void {
    try { this.options.report?.({ kind: 'save-schema', scope, key, version, issue, ...(contract ? { contract: true as const } : {}) }); } catch { /* error reporting cannot break a read */ }
  }
  private prune(keys: readonly string[], remove: (key: string) => void): void {
    for (const key of [...keys].sort().slice(0, -3)) remove(key);
  }
  private savedDoc(scope: SaveScope, name: string): Document {
    this.initialize();
    const raw = this.get(scope, name), cached = this.documents.get(name);
    if (cached !== undefined && cached.raw === raw) return cached.value;
    if (raw === null) { const value: Document = { keys: {} }; this.documents.set(name, { raw, value }); return value; }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (doc(parsed)) { this.documents.set(name, { raw, value: parsed }); return parsed; }
    } catch { /* set aside below */ }
    const prefix = `${name}.corrupt.`;
    this.put(scope, prefix + this.at(), raw);
    this.prune(this.names(scope).filter((key) => key.startsWith(prefix)), (key) => { this.remove(scope, key); });
    const fresh: Document = { keys: {} };
    this.putDocument(scope, name, fresh);
    this.report(scopeOf(name), '*', 0, 'Invalid save savedDoc: expected JSON with a keys object');
    return fresh;
  }
  private putDocument(scope: SaveScope, name: string, value: Document): boolean {
    const raw = JSON.stringify(value), result = this.put(scope, name, raw);
    // The cache must reflect JSON storage semantics and own its payload. A
    // caller's mutable object, Date or undefined cannot leak through a cache.
    const parsed: unknown = JSON.parse(raw);
    if (!doc(parsed)) throw new Error('Invalid serialized save document');
    this.documents.set(name, { raw, value: parsed }); return result;
  }
  /** One changed entry of an owned cached document (js-heap D2: a shard's 270 KB continuation was written every 5 s):
   *  the entry's data is an owned parse of its serialized `text`, which is kept for the next equality check, and the
   *  document is serialized once and cached as is instead of parsed back from storage text. */
  private putEntry(scope: SaveScope, name: string, saved: Document, key: string, value: Entry, text: string): boolean {
    saved.keys[key] = value; this.entryTexts.set(value, text);
    const raw = JSON.stringify(saved), result = this.put(scope, name, raw);
    this.documents.set(name, { raw, value: saved }); return result;
  }
  private entryText(value: Entry): string | undefined {
    if (this.entryTexts.has(value)) return this.entryTexts.get(value);
    const text = JSON.stringify(value.data); this.entryTexts.set(value, text); return text;
  }
  define<T>(definition: SaveKeyDef<T>): SaveSlot<T> {
    const id = `${definition.scope}/${definition.key}`;
    const priorDef = this.definitions.get(id);
    if (priorDef && priorDef !== definition && priorDef.stub !== true) throw new Error(`Duplicate save definition: ${id}`);
    this.definitions.set(id, definition);
    if (definition.stub !== true) everyDefinition.set(id, definition);
    const generations = new Map<string, number>();
    const remember = (name: string, stored: Document): void => { if (!generations.has(name)) generations.set(name, stored.reset ?? 0); };
    const read = (namespace?: string): T => {
      const name = this.name(definition.scope, namespace), savedDoc = this.savedDoc(definition.scope, name);
      remember(name, savedDoc);
      const raw = savedDoc.keys[definition.key];
      if (raw === undefined) return clone(definition.initial());
      const identity = `${name}/${definition.key}`;
      if (entry(raw) && raw.v > definition.version) { this.readonlyKeys.add(identity); return clone(definition.initial()); }
      let data: unknown = entry(raw) ? raw.data : undefined;
      let version = entry(raw) ? raw.v : 0;
      let issue = 'Invalid save entry';
      try {
        if (!entry(raw)) throw new Error(issue);
        while (version < definition.version) {
          const migrate = definition.migrate?.[version];
          if (!migrate) throw new Error(`Missing migration ${version} → ${version + 1}`);
          data = migrate(data); version++;
        }
        const result = v.safeParse(definition.schema, known(definition.schema, data));
        if (!result.success) {
          const first = result.issues[0];
          throw new Error(`${first.path?.map((item) => String(item.key)).join('.') ?? ''}: ${first.message}`);
        }
        if (version !== raw.v) { savedDoc.keys[definition.key] = { v: version, data: keepUnknown(definition.schema, data, result.output) }; this.putDocument(definition.scope, name, savedDoc); }
        return clone(result.output);
      } catch (error) { issue = error instanceof Error ? error.message : 'Migration failed'; }
      const prefix = `${definition.key}.corrupt.`;
      savedDoc.keys[prefix + this.at()] = raw;
      this.prune(Object.keys(savedDoc.keys).filter((key) => key.startsWith(prefix)), (key) => { delete savedDoc.keys[key]; });
      const initial = definition.initial();
      savedDoc.keys[definition.key] = { v: definition.version, data: initial };
      this.putDocument(definition.scope, name, savedDoc);
      this.report(scopeOf(name), definition.key, version, issue, entry(raw) && raw.v === definition.version);
      return clone(initial);
    };
    const write = (value: T, namespace?: string): boolean => {
      const name = this.name(definition.scope, namespace), savedDoc = this.savedDoc(definition.scope, name);
      remember(name, savedDoc);
      if (generations.get(name) !== (savedDoc.reset ?? 0)) return false;
      const prior = savedDoc.keys[definition.key];
      if (this.readonlyKeys.has(`${name}/${definition.key}`) || (entry(prior) && prior.v > definition.version)) return false;
      const result = v.safeParse(definition.schema, value);
      if (!result.success) { this.report(scopeOf(name), definition.key, definition.version, result.issues[0].message); return false; }
      // Equality is exact JSON content, not object identity. A failed durable
      // write still retries even when this page already retained the value.
      // WR7: the whole document goes back, with the fields this build does not know.
      const output = entry(prior) && prior.v === definition.version ? keepUnknown(definition.schema, prior.data, result.output) : result.output;
      const text = JSON.stringify(output);
      if (entry(prior) && prior.v === definition.version && !this.failedWrites.has(name) && this.entryText(prior) === text) return true;
      if (text === undefined) { savedDoc.keys[definition.key] = { v: definition.version, data: output }; return this.putDocument(definition.scope, name, savedDoc); }
      return this.putEntry(definition.scope, name, savedDoc, definition.key, { v: definition.version, data: JSON.parse(text) }, text);
    };
    const peek = (namespace?: string): T | null => {
      this.initialize();
      const raw = this.get(definition.scope, this.name(definition.scope, namespace));
      if (raw === null) { remember(this.name(definition.scope, namespace), { keys: {} }); return null; }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!doc(parsed)) return null;
        remember(this.name(definition.scope, namespace), parsed);
        const stored = parsed.keys[definition.key];
        if (!entry(stored) || stored.v > definition.version) return null;
        let data = stored.data, version = stored.v;
        while (version < definition.version) {
          const migrate = definition.migrate?.[version];
          if (migrate === undefined) return null;
          data = migrate(data); version++;
        }
        const result = v.safeParse(definition.schema, known(definition.schema, data));
        return result.success ? clone(result.output) : null;
      } catch { return null; }
    };
    const status = (namespace?: string): 'absent' | 'valid' | 'invalid' | 'future' => {
      this.initialize();
      const raw = this.get(definition.scope, this.name(definition.scope, namespace));
      if (raw === null) return 'absent';
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!doc(parsed)) return 'invalid';
        const stored = parsed.keys[definition.key];
        if (stored === undefined) return 'absent';
        if (!entry(stored)) return 'invalid';
        if (stored.v > definition.version) return 'future';
        let data: unknown = stored.data, version = stored.v;
        while (version < definition.version) {
          const migrate = definition.migrate?.[version];
          if (migrate === undefined) return 'invalid';
          data = migrate(data); version++;
        }
        return v.safeParse(definition.schema, known(definition.schema, data)).success ? 'valid' : 'invalid';
      } catch { return 'invalid'; }
    };
    const revisions = new Map<string, { raw: string | null; value: number }>();
    const revision = (namespace?: string): number => {
      this.initialize();
      const name = this.name(definition.scope, namespace), raw = this.get(definition.scope, name), prior = revisions.get(name);
      if (prior?.raw === raw) return prior.value;
      const value = (prior?.value ?? 0) + 1;
      revisions.set(name, { raw, value }); return value;
    };
    return { peek, status, revision, read, write, reset: (namespace) => { write(definition.initial(), namespace); } };
  }
  /** Bind local state to an instance; copy legacy keys once missing, preserve target/future entries and retry failed writes. */
  instance<T>(definition: InstanceSaveKeyDef<T>, identity: SaveInstance): InstanceSaveSlot<T> {
    if (!shardNamespace(identity.id) || (identity.legacy !== undefined && !shardNamespace(identity.legacy))) throw new Error('Invalid save instance');
    const id = identity.id, legacy = identity.legacy, slot = this.define(definition);
    const migrate = (): void => {
      if (legacy === undefined || legacy === id) return;
      const source = this.name('shard', legacy), target = this.name('shard', id);
      this.initialize();
      if (this.get('shard', source) === null) return;
      const old = this.savedDoc('shard', source), current = this.savedDoc('shard', target);
      if (current.reset !== undefined) return;
      const merged = JSON.stringify({ keys: { ...old.keys, ...current.keys } });
      if (merged !== this.get('shard', target) || this.failedWrites.has(target)) this.put('shard', target, merged);
    };
    migrate();
    slot.peek(id);
    return { instanceId: id, peek: () => slot.peek(id), read: () => { migrate(); return slot.read(id); },
      write: (value) => { migrate(); return slot.write(value, id); }, reset: () => { migrate(); slot.reset(id); } };
  }
  /** Durably merge one retired shard namespace into another. Destination entries and explicit resets win; a refused write changes neither namespace. Source remains available for retry. */
  mergeShardEntries(sourceId: string, targetId: string): boolean {
    const sourceName = this.name('shard', sourceId), targetName = this.name('shard', targetId);
    this.initialize();
    if (sourceName === targetName) return true;
    const read = (name: string): Document => {
      const raw = this.get('shard', name);
      if (raw === null) return { keys: {} };
      const parsed: unknown = JSON.parse(raw);
      if (!doc(parsed)) throw new Error('Invalid shard save document');
      return parsed;
    };
    const source = read(sourceName), target = read(targetName);
    if (target.reset !== undefined || Object.keys(source.keys).length === 0) return true;
    const raw = JSON.stringify({ keys: { ...source.keys, ...target.keys } });
    try {
      const storage = this.storage('shard');
      if (storage === null) return false;
      storage.setItem(targetName, raw);
    } catch { return false; }
    this.memory.set(targetName, raw); this.failedWrites.delete(targetName);
    return true;
  }
  /** Detached local entries for a preview, without creating, repairing or migrating a document. */
  inspectShard(identity: SaveInstance): Readonly<Record<string, unknown>> {
    this.name('shard', identity.id);
    if (identity.legacy !== undefined) this.name('shard', identity.legacy);
    this.initialize();
    const inspect = (id: string): Document => {
      const raw = this.get('shard', this.name('shard', id));
      if (raw === null) return { keys: {} };
      const parsed: unknown = JSON.parse(raw);
      if (!doc(parsed)) throw new Error('Invalid shard save document');
      return parsed;
    };
    const current = inspect(identity.id);
    const legacy = identity.legacy === undefined || identity.legacy === identity.id || current.reset !== undefined ? {} : inspect(identity.legacy).keys;
    return clone({ ...legacy, ...current.keys });
  }
  /** Read only the namespace's validated reset generation; no state is repaired, migrated or exposed. */
  inspectShardGeneration(identity: SaveInstance): number {
    const name = this.name('shard', identity.id);
    this.initialize();
    const raw = this.get('shard', name);
    if (raw === null) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (!doc(parsed)) throw new Error('Invalid shard save document');
    return parsed.reset ?? 0;
  }
  /** Atomically reset one namespace, retaining explicit entries and preventing stale bindings or legacy imports from reviving it. False leaves the prior save intact. */
  resetShard(identity: SaveInstance, keptKeys: readonly string[] = []): boolean {
    const entries = this.inspectShard(identity), name = this.name('shard', identity.id);
    const current = this.savedDoc('shard', name), generation = current.reset ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0 || generation === Number.MAX_SAFE_INTEGER) throw new Error('Invalid shard reset generation');
    const keep = new Set(keptKeys);
    const stored: Document = { keys: Object.fromEntries(Object.entries(entries).filter(([key]) => keep.has(key))), reset: generation + 1 };
    const raw = JSON.stringify(stored);
    try {
      const storage = this.storage('shard');
      if (storage === null) return false;
      storage.setItem(name, raw);
    } catch { return false; }
    this.memory.set(name, raw); this.failedWrites.delete(name);
    for (const key of this.readonlyKeys) if (key.startsWith(`${name}/`) && !keep.has(key.slice(name.length + 1))) this.readonlyKeys.delete(key);
    return true;
  }
  persist(): Promise<boolean> {
    this.persistence ??= (async () => {
      let granted = false;
      try { granted = await (this.options.persist?.() ?? saveEnvironment().persist()); } catch { /* API missing or denied */ }
      const name = this.name('device'), savedDoc = this.savedDoc('device', name);
      savedDoc.keys['storage.persisted'] = { v: 1, data: granted };
      this.putDocument('device', name, savedDoc);
      return granted;
    })();
    return this.persistence;
  }
  exportAll(): string {
    this.initialize();
    const docs: Record<string, Document> = {};
    for (const name of new Set([`${savePrefix()}global`, ...this.names('global')])) {
      const scope = scopeOf(name);
      if (scope === 'device' || scope === 'session' || scope.includes('.corrupt.')) continue;
      docs[scope] = this.savedDoc('global', name);
    }
    return JSON.stringify({ format: appIdentity().saveFormat, version: 2, saveEpoch: saveEpoch(), build: this.options.build ?? '', exported: this.at(), docs }, null, 2);
  }
  importAll(json: string): ImportReport {
    const report: ImportReport = { imported: [], skipped: [] };
    let value: unknown;
    try { value = JSON.parse(json); } catch { return { imported: [], skipped: [{ key: '*', reason: 'Invalid JSON' }] }; }
    if (!object(value) || value['format'] !== appIdentity().saveFormat || value['version'] !== 2 || !object(value['docs'])) return { imported: [], skipped: [{ key: '*', reason: 'Unknown save format' }] };
    if ((value['saveEpoch'] ?? 0) !== saveEpoch()) return { imported: [], skipped: [{ key: '*', reason: 'Save belongs to another progress epoch' }] };
    for (const [scope, savedDoc] of Object.entries(value['docs'])) {
      if (scope === 'device' || scope === 'session' || (scope !== 'global' && scope !== 'profile' && !shardNamespace(scope)) || !doc(savedDoc)) { report.skipped.push({ key: scope, reason: 'Invalid or private scope' }); continue; }
      const kind = scope === 'global' || scope === 'profile' ? scope : 'shard';
      for (const [key, raw] of Object.entries(savedDoc.keys)) {
        const identity = `${scope}/${key}`, definition = this.definitions.get(`${kind}/${key}`);
        if (!definition || !entry(raw)) { report.skipped.push({ key: identity, reason: 'Unknown key or invalid entry' }); continue; }
        const target = this.savedDoc(kind, savePrefix() + scope), existing = target.keys[key];
        if (raw.v > definition.version || (entry(existing) && existing.v > definition.version)) { report.skipped.push({ key: identity, reason: 'Newer version: kept untouched' }); continue; }
        let data = raw.data, version = raw.v;
        try {
          while (version < definition.version) { const migrate = definition.migrate?.[version]; if (!migrate) throw new Error('Missing migration'); data = migrate(data); version++; }
          const result = v.safeParse(definition.schema, known(definition.schema, data));
          if (!result.success) throw new Error(result.issues[0].message);
          target.keys[key] = { v: version, data: keepUnknown(definition.schema, data, result.output) };
          if (this.putDocument(kind, savePrefix() + scope, target)) report.imported.push(identity);
          else report.skipped.push({ key: identity, reason: 'Storage unavailable or full: kept in memory for this page only' });
        } catch (error) { report.skipped.push({ key: identity, reason: error instanceof Error ? error.message : 'Invalid data' }); }
      }
    }
    return report;
  }
  corrupt(): CorruptSave[] {
    this.initialize();
    const copies: CorruptSave[] = [];
    for (const name of this.names('global')) {
      const [scope = '', at] = scopeOf(name).split('.corrupt.');
      if (scope === 'device' || scope === 'session') continue;
      if (at) { copies.push({ scope, key: '*', at, bytes: new TextEncoder().encode(this.get('global', name) ?? '').length }); continue; }
      for (const [key, raw] of Object.entries(this.savedDoc('global', name).keys)) {
        const [original = '', stamp] = key.split('.corrupt.');
        if (stamp) copies.push({ scope, key: original, at: stamp, bytes: new TextEncoder().encode(JSON.stringify(raw)).length });
      }
    }
    return copies;
  }
  exportCorrupt(copy: CorruptSave): string {
    if (copy.scope === 'device' || copy.scope === 'session') throw new Error('Private saves cannot be exported');
    const name = savePrefix() + copy.scope;
    return copy.key === '*' ? this.get('global', `${name}.corrupt.${copy.at}`) ?? '' : JSON.stringify(this.savedDoc('global', name).keys[`${copy.key}.corrupt.${copy.at}`], null, 2);
  }
}
