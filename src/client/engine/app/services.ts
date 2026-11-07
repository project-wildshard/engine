export class AppDebug {
  leakBaseline: Readonly<Record<string, unknown>> | null = null;
  private readonly values = new Map<string, unknown>();
  private readonly scoped = new Map<string, unknown>();
  expose(name: string, value: unknown): void { this.values.set(name, value); }
  scopedExpose(name: string, value: unknown): () => void {
    if (this.values.has(name)) throw new Error(`Duplicate debug exposure: ${name}`);
    this.values.set(name, value);
    this.scoped.set(name, value);
    return () => { this.values.delete(name); this.scoped.delete(name); };
  }
  snapshot(): Readonly<Record<string, unknown>> { return Object.freeze(Object.fromEntries(this.values)); }
  scopedSnapshot(): Readonly<Record<string, unknown>> { return Object.freeze(Object.fromEntries(this.scoped)); }
}

/** Resolve a base grade and its optional look layer without content vocabulary. */
export function resolveGrade<Grade extends object, Look extends { grade: Partial<Grade> }>(spec: { grade: Grade; look?: Look }): { grade: Grade; look: Look | null } {
  const look = spec.look ?? null;
  return { grade: look ? { ...spec.grade, ...look.grade } : spec.grade, look };
}
