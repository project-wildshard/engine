// The tables engine owns: starter rows and boot tables. Shard programs, discovery and vocabulary are sharddev's build.
// oxlint-disable-next-line import/no-unassigned-import -- Its hooks are the point, and they must run first.
import './bake-loader.mjs';

const { generateBootTables } = await import('./app-build/gen.ts');
generateBootTables();

// P4: the admission revision a client build stamps. An installed engine has no lockfile to hash, so authors read this file.
await import('./stamp-validation-revision.mjs');
await import('./stamp-renderer-revision.mjs');
