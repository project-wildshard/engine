import { parseSceneScatterPage, type SceneScatterPage } from '@wildshard/format/sceneDressing';
import type { Scope } from '@wildshard/engine/app/scope';

type Result = { readonly ok: true; readonly page: SceneScatterPage } | { readonly ok: false; readonly error: unknown };
interface PageFolder { readonly json: (name: string) => Promise<unknown>; readonly hasFile: (name: string) => boolean }
interface Context { readonly scope: Scope; readonly product: PageFolder }

/** Entered-owner page reads overlap in declared first-use order. Complete
 * parsing happens on arrival; errors surface only at the original cursor. */
export class SceneScatterPages {
  private readonly product: PageFolder;
  private readonly scope: Scope;
  private readonly json: PageFolder['json'];
  private readonly hasFile: PageFolder['hasFile'];
  private readonly pages = new Map<string, Promise<Result>>();
  constructor(private readonly ctx: Context, names: readonly string[]) {
    this.product = ctx.product; this.scope = ctx.scope; this.json = this.product.json; this.hasFile = this.product.hasFile;
    this.validate();
    const unique = [...new Set(names)];
    if (unique.length > 16) throw new Error('At most sixteen scatter pages may be admitted');
    for (const name of unique) if (!this.hasFile.call(this.product, name)) throw new Error(`Missing scene scatter file: ${name}`);
    for (const name of unique) this.pages.set(name, this.prepare(name));
  }
  private validate(): void {
    if (this.scope.disposed || this.scope.disposing || this.ctx.scope !== this.scope || this.ctx.product !== this.product
      || this.product.json !== this.json || this.product.hasFile !== this.hasFile) throw new Error('Scene scatter page owner changed or retired');
  }
  private async prepare(name: string): Promise<Result> {
    try {
      this.validate(); const value = await this.json.call(this.product, name); this.validate();
      const page=parseSceneScatterPage(value);
      for(const member of page.members)if(member.kind==='poses'){for(const row of member.rows)Object.freeze(row);Object.freeze(member.rows);}
      return { ok: true, page };
    } catch (error) { return { ok: false, error }; }
  }
  async poses(name: string, member: string): Promise<readonly Readonly<Extract<SceneScatterPage['members'][number], { kind: 'poses' }>['rows'][number]>[]> {
    this.validate(); const pending = this.pages.get(name);
    if (pending === undefined) throw new Error('Missing prepared scatter page');
    const result = await pending; this.validate();
    if (!result.ok) throw result.error;
    const row = result.page.members.find(candidate => candidate.id === member);
    if (row?.kind !== 'poses') throw new Error('Scene scatter page member is not a pose list');
    return row.rows;
  }
  /** Drain all reads before releasing page records, including on failure. */
  async close(): Promise<void> { await Promise.all(this.pages.values()); this.pages.clear(); }
}
