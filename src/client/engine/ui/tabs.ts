import type { IconId } from './icons';

export type TabId = string;
export interface TabSpec { id: TabId; title: string; icon?: IconId; order?: number; hint?: string }
export interface TabFragment { id: string; order?: number; render: (host: HTMLElement) => void }

/** Stable registration order breaks ties; two owners cannot silently replace one another. */
export class TabRegistry {
  private tabs = new Map<TabId, TabSpec>();
  private fragments = new Map<TabId, Map<string, TabFragment>>();
  tab(spec: TabSpec): () => void {
    if (this.tabs.has(spec.id)) throw new Error(`Duplicate UI tab: ${spec.id}`);
    this.tabs.set(spec.id, spec);
    return () => { if (this.tabs.get(spec.id) === spec) this.tabs.delete(spec.id); };
  }
  fragment(tab: TabId, fragment: TabFragment): () => void {
    const rows = this.fragments.get(tab) ?? new Map<string, TabFragment>();
    if (rows.has(fragment.id)) throw new Error(`Duplicate UI fragment: ${tab}/${fragment.id}`);
    this.fragments.set(tab, rows); rows.set(fragment.id, fragment);
    return () => { if (rows.get(fragment.id) === fragment) rows.delete(fragment.id); if (rows.size === 0) this.fragments.delete(tab); };
  }
  get registeredTabs(): readonly TabSpec[] { return [...this.tabs.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
  hasFragments(tab: TabId): boolean { return (this.fragments.get(tab)?.size ?? 0) > 0; }
  render(tab: TabId, host: HTMLElement): void {
    for (const fragment of [...(this.fragments.get(tab)?.values() ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) fragment.render(host);
  }
}
