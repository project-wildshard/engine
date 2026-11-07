/**
 * The wild groups' notices, renderer-free (CI12: the Nalati tape reads the same "The wolves howl…" text the page toasts): a
 * creature signal raises its admitted notice row's text, and a knockdown its own, each at most once per its `every`
 * seconds (one cooldown per signal name, and one for 'knockdown'). `bindPageGroups` toasts what it answers, in the page's
 * order; a native host answers with its own clock.
 *
 *   const notices = new GroupNotices(rows.effects);   notices.signal('howl', now) → 'The wolves howl in the hills' | null
 */
import type { PageGroupRows } from '@wildshard/format/creatures';

type Effects = NonNullable<PageGroupRows['effects']>;
/** the cooldowns as data: each key and when it last raised its notice */
export type GroupNoticesSnapshot = readonly (readonly [key: string, at: number])[];

export class GroupNotices {
  private readonly last = new Map<string, number>();
  constructor(private readonly effects: Effects) {}
  /** The text creature signal `name` raises at `now` (s), or null: no notice row for it, or still in its cooldown. */
  signal(name: string, now: number): string | null {
    const notice = this.effects.notices.find(row => row.signal === name);
    return notice === undefined ? null : this.take(name, notice.text, notice.every, now);
  }
  /** The text a knockdown raises at `now`, or null in its cooldown. */
  knockdown(now: number): string | null { return this.take('knockdown', this.effects.knockdown.text, this.effects.knockdown.every, now); }
  snapshot(): GroupNoticesSnapshot { return [...this.last]; }
  restore(saved: GroupNoticesSnapshot): void {
    if (saved.some(([, at]) => !Number.isFinite(at))) throw new Error('Invalid group notices snapshot');
    this.last.clear(); for (const [key, at] of saved) this.last.set(key, at);
  }
  private take(key: string, text: string, every: number, now: number): string | null {
    if (now - (this.last.get(key) ?? -1e9) < every) return null;
    this.last.set(key, now); return text;
  }
}
