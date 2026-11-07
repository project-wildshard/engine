/** Entity identity belongs to the simulation instance, never a tile, position or draw LOD. */
export class EntityIds {
  private next = 0;
  private readonly used = new Set<string>();
  private readonly namespace: string;
  constructor(namespace: string) { this.namespace = namespace; }
  allocate(authored?: string): string {
    const id = authored ?? `${this.namespace}:${String(this.next++)}`;
    if (id.length === 0 || this.used.has(id)) throw new Error(`Duplicate or empty entity id: ${id}`);
    this.used.add(id);
    return id;
  }
  snapshot(): { next: number; used: string[] } { return { next: this.next, used: [...this.used] }; }
  restore(state: { next: number; used: readonly string[] }): void {
    if (!Number.isSafeInteger(state.next) || state.next < 0 || new Set(state.used).size !== state.used.length || state.used.some((id) => id.length === 0)) throw new Error('Invalid entity identity state');
    this.next = state.next; this.used.clear(); for (const id of state.used) this.used.add(id);
  }
}
