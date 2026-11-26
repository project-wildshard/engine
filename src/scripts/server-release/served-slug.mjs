// The names a release and the grid use for pinned shards. No dependencies: CI's job-1 checks run it before `pnpm install`.

/** The release's shards when `E7_SERVER_SHARDS` (from `E7_STAGING_SHARDS` or `E7_PRODUCTION_SHARDS`) is unset or empty. */
export const DEFAULT_SERVER_SHARDS = 'driftwood-isle,nalati-grasslands';
/** The folder a pinned slug installs into, which is the name the server, its book and the grid use: the slug itself since
 *  meta TEMPLATE-E2E TR-9 dropped the Template from staging, the last pin whose folder (`_template`) was not its slug. */
export const servedSlug = (/** @type {string} */ slug) => slug;
