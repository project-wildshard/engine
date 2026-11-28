// QA 11-26 row 90 (J505): v0.1.102 reached production at 08:27 UTC on 2026-11-28 and npm latest stayed 0.1.100, because no
// step dispatched npm-publish.yml's `publish_final`. Production go-live now ends with it: npm latest must equal the tag the
// alias just moved to, or the release is not done.
//
// npmFinal reads npm latest; when it is behind, it dispatches `npm-publish.yml publish_final=<tag>` (once: an existing
// `npm latest <tag>` run is reused), waits for that run, then reads npm latest again until it names the version.

/**
 * @typedef {object} NpmFinalDeps
 * @property {() => Promise<string|undefined>} latest  `npm view @wildshard/engine@latest version`, fresh.
 * @property {(tag: string) => Promise<number|undefined>} existingRun  The id of an `npm latest <tag>` dispatch, if any.
 * @property {(tag: string) => Promise<number>} dispatch  `gh workflow run npm-publish.yml -f publish_final=<tag>`: the run id.
 * @property {(run: number) => Promise<string>} watch  Waits for the run and answers its conclusion.
 * @property {(line: string) => void} log
 * @property {(ms: number) => Promise<void>} sleep
 * @property {() => number} now
 * @property {number} [waitMs]  How long npm may take to show the version after the run (default 15 minutes).
 * @property {number} [pollMs]
 */

/**
 * @param {string} tag  `vX.Y.Z`, the tag production now serves.
 * @param {NpmFinalDeps} deps
 * @returns {Promise<{version: string, run?: number, already: boolean}>}  Throws when npm latest never names the version.
 */
export async function npmFinal(tag, deps) {
  if (!/^v\d+\.\d+\.\d+$/u.test(tag)) throw new Error(`npm final: ${tag} is not a release tag vX.Y.Z`);
  const version = tag.slice(1);
  const before = await deps.latest();
  if (before === version) {
    deps.log(`PASS npm latest is ${version}`);
    return {version, already: true};
  }
  let run = await deps.existingRun(tag);
  if (run === undefined) {
    run = await deps.dispatch(tag);
    deps.log(`npm latest is ${before ?? 'unreadable'}, not ${version}: dispatched npm-publish.yml publish_final=${tag} (run ${run})`);
  } else deps.log(`npm latest is ${before ?? 'unreadable'}, not ${version}: reusing npm-publish run ${run} for ${tag}`);
  const conclusion = await deps.watch(run);
  if (conclusion !== 'success') throw new Error(`npm final: npm-publish run ${run} for ${tag} ended ${conclusion}`);
  const deadline = deps.now() + (deps.waitMs ?? 15 * 60_000);
  for (;;) {
    const now = await deps.latest();
    if (now === version) {
      deps.log(`PASS npm latest is ${version} (run ${run})`);
      return {version, run, already: false};
    }
    if (deps.now() >= deadline) throw new Error(`npm final: run ${run} passed but npm latest is ${now ?? 'unreadable'}, not ${version}`);
    await deps.sleep(deps.pollMs ?? 15_000);
  }
}
