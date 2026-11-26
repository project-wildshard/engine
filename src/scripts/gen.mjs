// The tables engine owns: starter rows and boot tables. Shard programs, discovery and vocabulary are sharddev's build.
// oxlint-disable-next-line import/no-unassigned-import -- Its hooks are the point, and they must run first.
import './bake-loader.mjs';

const { generateBootTables } = await import('./app-build/gen.ts');
generateBootTables();
