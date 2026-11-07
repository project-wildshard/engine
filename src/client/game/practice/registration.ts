import type { ShardContext } from '../plugin/context';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { PlaygroundHost } from '@wildshard/engine/practice/playground/Playground';
import type { PracticeCourseRows } from './course';

/** Client-only course cards load admitted layouts into the native practice rooms. */
export function installPracticeCourse(ctx: ShardContext, row: ClientFeatureRow): void {
  if (row.kind !== 'practice.course') throw new Error('Invalid practice course');
  const id=row.course;
  ctx.playground({ id, title: row.title, blurb: row.blurb, icon: row.icon, art: ctx.product.url(row.art),
    load: async () => {
      const { PracticeCourse } = await import('./course');
      const { practice } = await ctx.product.json<{ practice: PracticeCourseRows['layout'] }>(row.file);
      return class extends PracticeCourse { constructor(host: PlaygroundHost) { super(host, ctx, {kind:id,layout:practice}); } };
    },
  });
}
