// The preview, staging and production page release, in four phases, behind a page host (meta OFF-VERCEL OV4, Jake 2026-11-11:
// "Add staging & production release flow to the engine repo"). It replaces the scratch release scripts the v0.1.5 to
// v0.1.9 lanes copied by hand (singleplayer tmp/codex-release/v019-*-{refresh,promote,production-static}.mjs).
//
//   build    the channel's page for one exact SHA, baked with that channel's signed release file (PACKS-CDN PC3).
//   upload   the build's server book and parts to the packs bucket (packs first, J234), then the page, unaliased.
//   check    the uploaded page's bytes equal the local ones, the packs answer with the channel's CORS, then wait for
//            the producer's signed serial to name this build and the channel's /health to show that build and serial.
//   go-live  the alias move, LAST: refused without a fresh signed-release and /health match.
//
// Preview (the solo build of green main, J274) signs no release file and writes nothing to R2 (fix-preview PV13).
// Its document has no world stamp or release URL: the offline page still runs its server in a worker.
//
// The flow owns order and gates; the host (hosts/workers.mjs, page-release.mjs --host) owns how a
// page is packaged, uploaded, read back and aliased. Every dependency comes in through `deps`, so the tests drive a fake host.
// J205: the flow opens no socket. Nothing here ever joins a channel; production proofs are static.
import {createHash, createPublicKey, verify} from 'node:crypto';
import {LEGS} from '../staging-qa-budget.mjs';
import {smokeGap} from '../zone-entry-tour.mjs';

export const RELEASES_ORIGIN = 'https://releases.wildshard.io';
export const PACKS_ORIGIN = 'https://packs.wildshard.io';
/** Where every channel's page sends `/api/{errors,telemetry,inbox}` (API-CLOUDFLARE AC11). */
export const API_ORIGIN = 'https://api.wildshard.io';
/** E7_RELEASE_PUBLIC_KEY (engine variable), SPKI DER as hex: the box's RELEASE_PUBLIC_KEY and the pages' key. */
export const RELEASE_PUBLIC_KEY = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
export const PHASES = /** @type {const} */ (['build', 'upload', 'check', 'go-live']);
/** The static documents whose deployed bytes must equal the local build before the alias moves (OV4). The import map
 * is inline in index.html (src/scripts/app-build/importMap.mjs), so there is no importmap.json to compare. */
export const CHECKED_DOCUMENTS = /** @type {const} */ (['version.json', 'index.html', 'sw.js', 'deploy-chunks.json']);

/** @typedef {'staging'|'production'} WorldChannel */
/** @typedef {WorldChannel|'preview'|'explore'} Channel */
/** @typedef {typeof PHASES[number]} Phase */
/** @typedef {{channel: WorldChannel, solo: false, other: WorldChannel, origin: string, release: string, socket: string, health: string}} WorldChannelConfig */
/** @typedef {{channel: 'preview'|'explore', solo: true, origin: string, release: string}} SoloChannelConfig */
/** @typedef {WorldChannelConfig|SoloChannelConfig} ChannelConfig */

/** @type {{staging: WorldChannelConfig, production: WorldChannelConfig, preview: SoloChannelConfig, explore: SoloChannelConfig}} */
export const CHANNELS = {
  // SHELL-CUTOVER SC1: the solo build of the newest green main, no world stamp, so the in-page server runs.
  explore: {channel: 'explore', solo: true, origin: 'https://explore.wildshard.io', release: `${RELEASES_ORIGIN}/staging.json`},
  preview: {channel: 'preview', solo: true, origin: 'https://preview.wildshard.io', release: `${RELEASES_ORIGIN}/preview.json`},
  staging: {
    channel: 'staging', solo: false, other: 'production', origin: 'https://staging.wildshard.io',
    release: `${RELEASES_ORIGIN}/staging.json`, socket: 'wss://rooms-staging.wildshard.io',
    // D7: rooms' public /health is private; the tailnet one is the build's proof.
    health: 'https://wildshard.tailb41b20.ts.net:8443/health',
  },
  production: {
    channel: 'production', solo: false, other: 'staging', origin: 'https://play.wildshard.io',
    release: `${RELEASES_ORIGIN}/production.json`, socket: 'wss://rooms.wildshard.io',
    health: 'https://wildshard.tailb41b20.ts.net/health',
  },
};

// FAST-RELEASE FR-A15 (QA 11-25 row 31): both channels' rooms sit behind one Caddy on the box, and the release's own gates
// read the tailnet, so a box change that took both public hosts down (Cloudflare 521 from 10:11 UTC 11-25) passed every
// check. A staging or production release reads both public /up URLs before the cook and harden, after them, and after
// the alias move, and stops on anything but 200.
export const PUBLIC_ROOMS = Object.freeze(['https://rooms.wildshard.io/up', 'https://rooms-staging.wildshard.io/up']);

/** Each public rooms URL that does not answer 200, as `<url> answered <status>`. @param {Deps} deps @returns {Promise<string[]>} */
export async function roomsDown(deps) {
  const read = deps.roomsStatus;
  if (read === undefined) return [];
  const rows = await Promise.all(PUBLIC_ROOMS.map(async url => {
    let status = 0;
    try { status = await read(url); } catch { status = 0; }
    return status === 200 ? undefined : `${url} answered ${status === 0 ? 'nothing' : status}`;
  }));
  return rows.filter(row => row !== undefined);
}

export class RefusedError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = 'RefusedError'; }
}

/** Configuration may confirm the reviewed trust root, never replace it.
 * @param {string|undefined} configured @returns {string} */
export function pinnedReleaseKey(configured) {
  const value = configured?.trim();
  if (value !== undefined && value !== '' && value !== RELEASE_PUBLIC_KEY) throw new RefusedError('E7_RELEASE_PUBLIC_KEY differs from the pinned release key');
  return RELEASE_PUBLIC_KEY;
}

/**
 * @typedef {{id: string, url: string}} Deployment
 * @typedef {{algorithm: 'sha1'|'sha256', digest: string}} Digest
 * @typedef {{root: string, channel: ChannelConfig, build: string, saveEpoch: number, version: string, deployment?: Deployment}} HostContext
 * @typedef {object} PageHost
 * @property {string} name
 * @property {(context: HostContext) => Record<string, string>} buildEnv  Extra environment for `pnpm build:game`.
 * @property {(context: HostContext) => string} outputDir  The packaged static directory (absolute).
 * @property {(context: HostContext) => Promise<void>} prepare  Before the build: the host's project settings.
 * @property {(context: HostContext) => Promise<void>} package  After the build: the host's upload-ready output.
 * @property {(context: HostContext) => Promise<Deployment>} upload  Upload the packaged output; never moves the alias.
 * @property {(context: HostContext & {deployment: Deployment}, names: readonly string[]) => Promise<Map<string, Digest>>} deployedDigests
 *   The uploaded, unaliased deployment's content digest for each of `names`, after the host checks it owns it.
 * @property {(context: HostContext & {deployment: Deployment}) => Promise<void>} goLive  The alias move.
 * @property {(context: HostContext & {deployment: Deployment}) => Promise<string[]>} [unserved]  PV22: every file of the output
 *   directory, read from the uploaded version; each one that does not answer 200 is `<path> <status>`.
 * @property {(step: 'prepare'|'package'|'upload'|'deployedDigests'|'goLive', context: HostContext) => string[]} describe
 *   What a step would run, for --dry-run. Never includes a credential.
 *
 * @typedef {{parts: number, uploaded: number, held: number, book: string, cors: string}} PacksSummary
 * @typedef {object} PackStore
 * @property {(context: {root: string, build: string, cors: string, dryRun: boolean}) => Promise<PacksSummary>} publish
 *   Parts first, the book last; an existing object must already have the same bytes.
 * @property {(context: {root: string, build: string, cors: string}) => Promise<PacksSummary>} verify  Read-only.
 *
 * @typedef {object} Deps
 * @property {string} root
 * @property {Channel} channel
 * @property {string} build  The full source SHA.
 * @property {PageHost} host
 * @property {boolean} [codeRetention] FM7: sign and verify the actual retained-code graph. Legacy callers omit it.
 * @property {PackStore} packs
 * @property {(file: string, args: string[], env: Record<string, string>) => void} run
 * @property {(url: string) => Promise<unknown>} fetchJSON  200 only, no cache, no redirects.
 * @property {(url: string) => Promise<string>} fetchText
 * @property {(url: string) => Promise<number>} [roomsStatus]  FR-A15: the HTTP status of a public rooms URL (agent-marked,
 *   no cache). Staging and production read both PUBLIC_ROOMS before the cook and harden, after them and after the alias.
 * @property {boolean} [allowRoomsDown]  ALLOW_ROOMS_DOWN=1 (J381): a release that fixes a rooms outage goes on, and says so.
 * @property {(build: string) => Promise<string[]>} [productionPacks]  FR-A17: production's advertised heads with no exact-build pack index.
 * @property {boolean} [allowMissingPacks]  ALLOW_MISSING_PACKS=1 (J381).
 * @property {(when: 'before' | 'after', stagingBase: string | undefined) => Promise<{summary: string, problems: string[]}>} [contentReach]
 *   QA 11-25 row 131: production's page and its content set (content-reach.mjs). Every content path the page, its boot
 *   tables and spawn books name is in the set's index and answers with the page's CORS, and holds the bytes staging QA
 *   played (`stagingBase`, the verdict's `contentBase`): before the alias moves (the local build) and after (the live page).
 * @property {boolean} [allowContentGaps]  ALLOW_CONTENT_GAPS=1 (J381).
 * @property {(tag: string) => Promise<void>} [npmFinal]  QA 11-26 row 90 (J505): after production's alias move, npm latest must
 *   equal the tag (npm-final.mjs dispatches `npm-publish.yml publish_final` when it is behind); a miss leaves the release not done.
 * @property {(path: string) => Uint8Array} readFile
 * @property {{read: (phase: Phase) => any, write: (phase: Phase, value: object) => void}} state
 * @property {{clean: () => boolean, head: () => string, remoteTag: (tag: string) => string|undefined}} git
 * @property {{version: string, saveEpoch: number}} manifest  package.json version and save-epoch.json.
 * @property {(line: string) => void} log
 * @property {() => number} now
 * @property {(milliseconds: number) => Promise<void>} sleep
 * @property {boolean} [dryRun]
 * @property {number} [waitMs]  How long `check` waits for the signed serial and /health (default 45 minutes).
 * @property {number} [pollMs]
 * @property {QaVerdict} [qa]  Production go-live (meta STAGING-QA SQ15, J426-J428): one `staging-qa.mjs` verdict.json for this build,
 *   the candidate's or live staging's (`page-release.mjs --qa=<file>`; `{problem}` when it could not be read). It replaces
 *   --after-staging-proofs, verify-staging.sh's journeys and sweeps, and --smoke.
 * @property {QaVerdict} [localQa]  Staging go-live requires the full local QA verdict from the source before the cut.
 * @property {string} [localQaSource]  The release commit's parent, which the local QA rig built.
 * @property {string} [releaseKey]  Defaults to RELEASE_PUBLIC_KEY; tests sign with their own.
 * @property {string} [catalogue]  Preview only (SA35): the catalogue the page bakes, staging's borrowed grid (src/scripts/preview-grid.ts);
 *   default the pinned `test/pins/catalogue.json`.
 * @property {string} [zoneTable]  Preview only (fix preview PV2): the zone table the page bakes, from staging's signed release
 *   (src/scripts/page-release/zone-table.mjs build); the check phase HEADs every cooked object it names before the alias moves.
 */

const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Run one phase. A refusal throws `RefusedError`; under --dry-run it is logged as `would refuse` and the phase goes on
 * with placeholders, mutating nothing (no host write, no pack upload, no state write, no alias).
 * @param {Phase} phase @param {Deps} deps @returns {Promise<{refusals: string[]}>}
 */
export async function runPhase(phase, deps) {
  /** @type {ChannelConfig|undefined} */
  const channel = Object.hasOwn(CHANNELS, deps.channel) ? CHANNELS[deps.channel] : undefined;
  if (channel === undefined) throw new RefusedError(`unknown channel ${deps.channel}: preview, staging, production or explore`);
  if (!PHASES.includes(phase)) throw new RefusedError(`unknown phase ${phase}: ${PHASES.join(', ')}`);
  /** @type {string[]} */
  const refusals = [];
  const dry = deps.dryRun === true;
  const refuse = (/** @type {string} */ message) => {
    if (!dry) throw new RefusedError(`${channel.channel} ${phase} refused: ${message}`);
    refusals.push(message);
    deps.log(`DRY-RUN would refuse: ${message}`);
  };
  const plan = (/** @type {string} */ line) => deps.log(`${dry ? 'DRY-RUN would ' : ''}${line}`);
  const rooms = async (/** @type {string} */ when) => {
    if (dry || deps.roomsStatus === undefined || channel.channel === 'preview' || channel.solo) return;
    const down = await roomsDown(deps);
    if (down.length === 0) { deps.log(`PASS public rooms ${when}: both answer 200`); return; }
    if (deps.allowRoomsDown === true) { deps.log(`NOTE public rooms ${when}: ${down.join('; ')} (ALLOW_ROOMS_DOWN=1)`); return; }
    refuse(`public rooms ${when}: ${down.join('; ')} (FR-A15; ALLOW_ROOMS_DOWN=1 only for a release that fixes them)`);
  };
  /** @type {HostContext} */
  const context = {root: deps.root, channel, build: deps.build, saveEpoch: deps.manifest.saveEpoch, version: deps.manifest.version};

  if (!/^[0-9a-f]{40}$/u.test(deps.build)) refuse(`build ${deps.build} is not a full SHA`);
  if (deps.git.head() !== deps.build) refuse(`HEAD ${deps.git.head()} is not build ${deps.build}`);
  if (!deps.git.clean()) refuse('the release tree is not clean (one clean clone per channel)');
  if (!(deps.manifest.saveEpoch >= 1)) refuse('save-epoch.json must be at least 1');
  if (deps.catalogue !== undefined && !channel.solo) refuse(`--catalogue is preview's (SA35): ${channel.channel} bakes the pinned catalogue`);
  if (deps.zoneTable !== undefined && !channel.solo) refuse(`--zone-table is preview's (PV2): ${channel.channel} reads its own release`);
  deps.log(`${channel.channel} ${phase} ${deps.build} v${deps.manifest.version} epoch ${deps.manifest.saveEpoch} on ${deps.host.name}${dry ? ' (dry run)' : ''}`);

  if (phase === 'build') {
    if (channel.channel === 'explore') {
      if (deps.catalogue === undefined) refuse('Explore requires --catalogue pointing to the matching staging build');
      else if (!dry) {
        const expected = await deps.fetchText(`${CHANNELS.staging.origin}/catalogue.json`).catch(() => '');
        if (expected === '' || sha256(deps.readFile(deps.catalogue)) !== sha256(Buffer.from(expected))) refuse('Explore catalogue differs from the live staging build');
      }
    }
    // Fix preview PV17: staging and production read zones from the cook (PV16); PV15 retired content sets everywhere
    const zonesFromCook = channel.channel === 'staging' || channel.channel === 'production';
    // PV16: staging and production read every zone from the cook too, at their own build's key (their pins, main's cook)
    const own = channel.solo ? undefined : ownTablePath(deps);
    if (own !== undefined) {
      plan(`write ${channel.channel}'s zone table from its pins and main's cook to ${own} (PV16; none while a pin names no shard version)`);
      if (!dry) deps.run('node', ['--import', './src/scripts/bake-loader.mjs', 'src/scripts/page-release/zone-table.mjs', 'own', own, `--channel=${channel.channel}`, `--build=${deps.build}`], {});
    }
    const env = buildEnv(channel, own !== undefined && heldFile(deps, own) ? {...deps, zoneTable: own} : deps);
    for (const line of deps.host.describe('prepare', context)) plan(line);
    if (!dry) await deps.host.prepare(context);
    plan(`run pnpm build:game with ${channel.solo ? 'no release file (solo)' : `WILDSHARD_RELEASE_URL=${env.WILDSHARD_RELEASE_URL}`} WILDSHARD_CATALOGUE=${env.WILDSHARD_CATALOGUE} WS_BUILD_ID=${deps.build} WS_CHANNEL=${channel.channel}`);
    if (!dry) deps.run('pnpm', ['build:game'], {...env, ...deps.host.buildEnv(context)});
    // PAGE-SIZE PZ4: build:game splits the page (dist/) from its content (dist-content/); the release joins the two, so
    // the page serves its own content (PV15: no content set, no content base)
    if (zonesFromCook) {
      plan('join build-owned files and engine art into dist/, refusing zone payloads (PV17)');
      if (!dry) deps.run('node', ['src/scripts/app-build/splitOutput.mjs', 'dist', '--join', '--no-shard-content'], {});
    } else {
      plan('join dist-content/ back into dist/ (no content base: the page serves its own content)');
      if (!dry) deps.run('node', ['src/scripts/app-build/splitOutput.mjs', 'dist', '--join'], {});
    }
    if (deps.codeRetention === true) {
      plan('sign code-retention.json from the actual deploy-chunks.json; unscheduled retirement has no invented deadline');
      if (!dry) deps.run('node', ['src/scripts/code-retention.mjs', deps.host.outputDir(context), channel.channel], {});
    }
    for (const line of deps.host.describe('package', context)) plan(line);
    if (!dry) await deps.host.package(context);
    plan(`check ${deps.host.outputDir(context)} names ${channel.solo ? 'no release file' : channel.release} and build ${deps.build}`);
    if (dry) return {refusals};
    const files = checkOutput(channel, deps, context, refuse);
    deps.state.write('build', {build: deps.build, channel: channel.channel, host: deps.host.name, files});
    deps.log(`PASS ${channel.channel} page built for ${deps.build}; nothing uploaded, alias not moved`);
    return {refusals};
  }

  const built = deps.state.read('build');
  if (built?.build !== deps.build || built?.channel !== channel.channel || built?.host !== deps.host.name) refuse(`no ${channel.channel} build of ${deps.build} on ${deps.host.name}: run the build phase first`);
  else if (!dry) {
    const files = checkOutput(channel, deps, context, refuse);
    for (const [name, hash] of Object.entries(built.files)) if (files[name] !== hash) refuse(`local ${name} changed since the build phase`);
  }

  if (phase === 'upload') {
    /** @type {PacksSummary|undefined} */
    let packs;
    if (!channel.solo) {
      plan(`publish server book and parts for ${deps.build} to ${PACKS_ORIGIN} with CORS ${channel.origin} (packs first, J234)`);
      packs = await deps.packs.publish({root: deps.root, build: deps.build, cors: channel.origin, dryRun: dry});
      if (!dry && packs.held + packs.uploaded !== packs.parts) refuse(`packs: ${packs.held} held + ${packs.uploaded} uploaded is not ${packs.parts}`);
    }
    for (const line of deps.host.describe('upload', context)) plan(line);
    if (dry) return {refusals};
    const deployment = await deps.host.upload(context);
    deps.state.write('upload', {build: deps.build, channel: channel.channel, deployment, ...(packs === undefined ? {} : {packs})});
    deps.log(`PASS ${channel.channel} uploaded ${deployment.id} ${deployment.url}${packs === undefined ? '; solo, no packs' : `; packs ${packs.parts} parts (${packs.uploaded} uploaded, ${packs.held} held)`}; alias not moved`);
    return {refusals};
  }

  const uploaded = deps.state.read('upload');
  /** @type {Deployment} */
  let deployment = {id: '<deployment>', url: '<deployment url>'};
  if (uploaded?.build === deps.build && uploaded?.channel === channel.channel) deployment = uploaded.deployment;
  else refuse(`no ${channel.channel} upload of ${deps.build}: run the upload phase first`);
  const deployed = {...context, deployment};

  if (channel.channel === 'production') await productionGates(phase, deps, refuse);

  if (phase === 'check') {
    await rooms('before the check');
    if (channel.channel === 'staging') {
      plan('move the cook when this exact staging release is signed, during the rooms switch');
      if (!dry) {
        await waitForGate(channel, deps, refuse, true);
        deps.run('node', ['src/scripts/release-cook.mjs', '--staging', `--build=${deps.build}`]);
        await rooms('after the cook and harden');
      }
      plan('ready every signed extra placement for this exact build before checking the page');
      if (!dry) deps.run('node', ['--import', './src/scripts/bake-loader.mjs', 'src/scripts/release-placed-ready.mjs', 'staging'], {WS_BUILD_ID: deps.build});
    }
    const table = deps.zoneTable ?? (channel.solo || !heldFile(deps, ownTablePath(deps)) ? undefined : ownTablePath(deps));
    if (table !== undefined) {
      // PV2: no 404 at go-live. One missing index or object refuses, and preview keeps its last build.
      plan(`HEAD every cooked index and object ${table} names, with ${channel.origin}'s Origin (PV2, PV16)`);
      // QA 82 follow-up: a catalogue may place a cell the table lacks (preview's borrowed table did); its discovery would 404 at
      // every boot. Every channel checks the catalogue it bakes: preview's grid, or the pins.
      const baked = [`--catalogue=${(channel.solo ? deps.catalogue : undefined) ?? 'test/pins/catalogue.json'}`];
      // PV22: and every index admits the page's own validator, or the page refuses every zone (v0.1.102's preview, 11-28)
      const validator = [`--validator-from=${deps.host.outputDir(context)}/index.html`];
      if (!dry) deps.run('node', ['--import', './src/scripts/bake-loader.mjs', 'src/scripts/page-release/zone-table.mjs', 'check', table, `--page=${channel.origin}`, ...baked, ...validator], {});
    }
    for (const line of deps.host.describe('deployedDigests', deployed)) plan(line);
    if (!dry) await checkDeployed(deps, deployed, refuse);
    // PV22: the version serves every file the build wrote, not only the documents compared above
    if (deps.host.unserved !== undefined) {
      plan(`read every file of ${deps.host.outputDir(context)} from ${deployment.url}: each must answer 200 (PV22)`);
      if (!dry) {
        const gone = await deps.host.unserved(deployed);
        if (gone.length > 0) refuse(`${deployment.id} does not serve ${gone.length} file(s) the build wrote (PV22): ${gone.slice(0, 8).join(', ')}`);
        else deps.log(`PASS ${channel.channel} ${deployment.id} serves every file the build wrote`);
      }
    }
    // Fix-preview PV13 (Jake, 2026-11-26: "preview deploy github action should not write to R2"): preview signs no
    // releases/preview.json and reads no gate of its own; it follows staging (QA 11-26 row 9).
    if (!channel.solo) {
      plan(`verify the server book and parts on ${PACKS_ORIGIN} answer with CORS ${channel.origin}`);
      if (!dry) await deps.packs.verify({root: deps.root, build: deps.build, cors: channel.origin});
    }
    /** @type {{serial?: number, problem?: string}} */
    let gate = {};
    if (ownGate(channel)) {
      plan(`wait for ${channel.release} to sign ${deps.build}${channel.solo ? ' (solo deployment gate)' : ` and ${channel.health} to match its serial`}`);
      gate = await waitForGate(channel, deps, refuse);
    } else plan(`no signed gate: ${channel.channel} writes and reads no release file of its own (PV13)`);
    if (dry) return {refusals};
    deps.state.write('check', {build: deps.build, channel: channel.channel, deployment, serial: gate.serial});
    deps.log(`PASS ${channel.channel} check ${deployment.id}: deployed bytes equal, ${ownGate(channel) ? `serial ${gate.serial} signed${channel.solo ? ', solo deployment gate' : ', packs public and healthy'}` : 'no gate of its own'}; alias not moved`);
    return {refusals};
  }

  // go-live: the alias move, last, on a fresh gate. Everything before it must still hold now.
  const checked = deps.state.read('check');
  if (checked?.build !== deps.build || checked?.channel !== channel.channel || checked?.deployment?.id !== deployment.id) refuse(`no ${channel.channel} check of ${deployment.id}: run the check phase first`);
  if (channel.channel === 'staging') {
    const tag = `v${deps.manifest.version}`;
    const local = localQaGap(deps.localQa, deps.localQaSource, tag);
    if (local !== undefined) refuse(`staging go-live needs --local-qa=<verdict.json>: ${local}`);
    const candidate = candidateQaGap(deps.qa, deps.build, tag, deployment.id, checked?.serial);
    if (candidate !== undefined) refuse(`staging go-live needs --qa=<candidate verdict.json>: ${candidate}`);
    plan('recheck signed extra placements before the alias move');
    if (!dry) deps.run('node', ['--import', './src/scripts/bake-loader.mjs', 'src/scripts/release-placed-ready.mjs', 'staging'], {WS_BUILD_ID: deps.build});
  }
  for (const line of deps.host.describe('deployedDigests', deployed)) plan(line);
  if (!dry) await checkDeployed(deps, deployed, refuse);
  /** @type {{serial?: number, problem?: string}} */
  let gate = {};
  if (ownGate(channel)) {
    plan(`re-read ${channel.release}${channel.solo ? '' : ` and ${channel.health}`}: must name ${deps.build} and one serial`);
    gate = await readGate(channel, deps);
    if (gate.problem !== undefined) refuse(gate.problem);
    else if (checked !== undefined && gate.serial !== checked.serial) deps.log(`note: serial moved ${checked.serial} -> ${gate.serial} since check, still ${deps.build}`);
  }
  if (channel.channel === 'staging') {
    if (gate.serial !== deps.qa?.roomsSerial) refuse('staging rooms serial changed since candidate QA; run the candidate leg again');
    plan('move the cook to this signed staging build before moving the page alias');
    if (!dry) deps.run('node', ['src/scripts/release-cook.mjs', '--staging', `--build=${deps.build}`]);
    await rooms('after the cook and harden');
  }
  // QA 11-25 row 131: staging QA entered the MMO (K5) on this build; the page about to go live reads only what its set holds.
  if (channel.channel === 'production' && !dry) await contentGate('before', deps, refuse);
  for (const line of deps.host.describe('goLive', deployed)) plan(line);
  if (dry) return {refusals};
  await deps.host.goLive(deployed);
  deps.log(`ALIAS MOVED ${channel.origin} -> ${deployment.id}; checking the domain`);
  await waitForDomain(channel, deps, refuse);
  await rooms('after the alias move');
  if (channel.channel === 'production') await contentGate('after', deps, refuse);
  deps.state.write('go-live', {build: deps.build, channel: channel.channel, deployment, ...(gate.serial === undefined ? {} : {serial: gate.serial})});
  // QA 11-26 row 90 (J505): v0.1.102 went live with npm latest left on 0.1.100. Production is done only when npm says so.
  if (channel.channel === 'production' && deps.npmFinal !== undefined) {
    const tag = `v${deps.manifest.version}`;
    try { await deps.npmFinal(tag); }
    catch (error) { refuse(`npm latest after the alias move: ${error instanceof Error ? error.message : String(error)} (the alias has moved; the release is not done until npm latest is ${deps.manifest.version}: rerun go-live or dispatch npm-publish.yml publish_final=${tag})`); }
  }
  deps.log(`PASS ${channel.origin} -> ${deps.build} ${deployment.id} after matching serial ${gate.serial}${channel.solo ? ' (solo)' : ''} (alias last)`);
  deps.log(channel.solo ? `next: node src/scripts/e7-doctor-proof.mjs ${channel.origin} ${deps.build} --human-static`
    : channel.channel === 'staging'
    ? `next: strict staging proofs, then production. node src/scripts/e7-doctor-proof.mjs ${channel.origin} ${deps.build} ${RELEASE_PUBLIC_KEY}; node src/scripts/e7-live-staging-proof.mjs ${channel.origin} ${deps.build} ${RELEASE_PUBLIC_KEY} chromium|webkit`
    : `next: static proof only (J205). node src/scripts/e7-doctor-proof.mjs ${channel.origin} ${deps.build} ${RELEASE_PUBLIC_KEY} --human-static`);
  return {refusals};
}

/** PV16: where a staging or production build writes its own zone table, one per build. @param {Deps} deps */
export const ownTablePath = deps => `${deps.root}/tmp/page-release/${deps.channel}-${deps.build}-zone-table.json`;

/** Whether `path` exists (readFile throws on a missing file). @param {Deps} deps @param {string} path */
function heldFile(deps, path) {
  try { deps.readFile(path); return true; } catch { return false; }
}

/** @param {ChannelConfig} channel @param {Pick<Deps, 'build' | 'catalogue' | 'zoneTable' | 'releaseKey'>} deps @returns {Record<string, string>} */
export function buildEnv(channel, deps) {
  const common = {
    // SA35: preview bakes the grid it borrowed from staging when the workflow names one; staging and production bake the pin.
    WS_BUILD_ID: deps.build, WILDSHARD_CATALOGUE: (channel.solo ? deps.catalogue : undefined) ?? 'test/pins/catalogue.json',
    // PV2: preview bakes the zone table it took from staging's release; PV16: staging and production their own (runPhase)
    ...(deps.zoneTable !== undefined ? {WS_ZONE_TABLE: deps.zoneTable} : {}),
    WS_PREVIOUS_DEPLOY_ORIGIN: channel.origin, WS_RELEASE: '1', WS_CHANNEL: channel.channel,
    // API-CLOUDFLARE AC11: errors, telemetry and the inbox go to the api-server Worker on every channel.
    VITE_API_ORIGIN: API_ORIGIN, WILDSHARD_RELEASE_KEY: deps.releaseKey ?? RELEASE_PUBLIC_KEY,
  };
  // Preview is the solo game: no release file, so the build stamps no world (app-build-pipeline.mjs E7.2d).
  return channel.solo ? common
    : {...common, WILDSHARD_RELEASE_URL: channel.release, WILDSHARD_RELEASE_KEY: deps.releaseKey ?? RELEASE_PUBLIC_KEY};
}

/** PZ6: the boot bank's `contentBase` in a built document (undefined when it has none, or it is empty).
 * @param {string} html @returns {string|undefined} */
export function contentBaseIn(html) {
  const bank = /<script type="application\/json" id="boot-module-files">([^<]+)<\/script>/u.exec(html)?.[1];
  if (bank === undefined) return undefined;
  const base = JSON.parse(bank).contentBase;
  return typeof base === 'string' && base !== '' ? base : undefined;
}

/** @param {Deps} deps @returns {readonly string[]} */
const checkedDocuments = deps => deps.codeRetention === true ? [...CHECKED_DOCUMENTS, 'code-retention.json'] : CHECKED_DOCUMENTS;

/**
 * The packaged page names this build, this channel's release file and key, and never the other channel's file.
 * @param {ChannelConfig} channel @param {Deps} deps @param {HostContext} context @param {(message: string) => void} refuse
 * @returns {Record<string, string>} sha256 of each checked document
 */
function checkOutput(channel, deps, context, refuse) {
  const out = deps.host.outputDir(context);
  /** @type {Record<string, string>} */
  const files = {};
  for (const name of checkedDocuments(deps)) files[name] = sha256(deps.readFile(`${out}/${name}`));
  const version = JSON.parse(Buffer.from(deps.readFile(`${out}/version.json`)).toString('utf8'));
  if (version.build !== deps.build) refuse(`version.json names ${version.build}, not ${deps.build}`);
  if (version.saveEpoch !== deps.manifest.saveEpoch) refuse(`version.json save epoch ${version.saveEpoch} is not ${deps.manifest.saveEpoch}`);
  const html = Buffer.from(deps.readFile(`${out}/index.html`)).toString('utf8');
  if (!html.includes(`globalThis.__WS_BUILD_ID__=${JSON.stringify(deps.build)};`)) refuse('index.html is not stamped with this build');
  const stamp = /globalThis\.__WS_WORLD__=(\{[^;]+\});/u.exec(html)?.[1];
  if (channel.solo) {
    if (stamp !== undefined || html.includes(RELEASES_ORIGIN)) refuse(`index.html names a world, but ${channel.channel} is the solo game`);
    if (channel.channel === 'explore' && !html.includes('globalThis.__WS_EXPLORE__=true;')) refuse('index.html has no Explore stamp');
    return files;
  }
  const world = stamp === undefined ? undefined : JSON.parse(stamp);
  if (world?.release !== channel.release) refuse(`index.html release file is ${world?.release}, not ${channel.release}`);
  if (world?.key !== (deps.releaseKey ?? RELEASE_PUBLIC_KEY)) refuse('index.html release key is not E7_RELEASE_PUBLIC_KEY');
  if (html.includes(`${RELEASES_ORIGIN}/${channel.other}.json`)) refuse(`index.html names the ${channel.other} release file`);
  return files;
}

/** @param {Deps} deps @param {HostContext & {deployment: Deployment}} deployed @param {(message: string) => void} refuse */
async function checkDeployed(deps, deployed, refuse) {
  const remote = await deps.host.deployedDigests(deployed, checkedDocuments(deps));
  const out = deps.host.outputDir(deployed);
  for (const name of checkedDocuments(deps)) {
    const found = remote.get(name);
    const local = found === undefined ? '' : createHash(found.algorithm).update(deps.readFile(`${out}/${name}`)).digest('hex');
    if (found === undefined || found.digest !== local) refuse(`deployed ${name} of ${deployed.deployment.id} differs from the local build`);
  }
}

/**
 * Production comes after staging. The version tag and staging proof must name this build. Staging can move on
 * after it has qualified the build, so a saved live verdict and J451 proof can stand in for its current page.
 * @param {Phase} phase @param {Deps} deps @param {(message: string) => void} refuse
 */
async function productionGates(phase, deps, refuse) {
  const tag = `v${deps.manifest.version}`;
  const tagged = deps.git.remoteTag(tag);
  if (tagged !== deps.build) refuse(`origin tag ${tag} is ${tagged ?? 'missing'}, not ${deps.build} (release.sh ${tag} --finish first)`);
  const staging = /** @type {{build?: string}} */ (await deps.fetchJSON(`${CHANNELS.staging.origin}/version.json`).catch(() => ({})));
  const exactProof = qaGap(deps.qa, deps.build) ?? zoneEntryGap(deps.qa?.deploy?.zoneEntry, deps.build);
  if (staging.build !== deps.build) {
    if (deps.qa?.kind !== 'staging' || exactProof !== undefined) {
      refuse(`staging serves ${staging.build ?? 'nothing'}, not ${deps.build}: staging goes live first or provide its exact live verdict`);
    } else {
      deps.log(`production uses the saved live staging and J451 verdict for ${deps.build}`);
    }
  }
  const qa = phase === 'go-live' ? exactProof : undefined;
  if (qa !== undefined) refuse(`production go-live needs the staging QA verdict from staging go-live for this build: ${qa}`);
  // FR-A17 (QA 11-25 row 35): play never moves to a build some advertised zone has no packs for (a reload loop before ee1bef52a).
  if ((phase === 'check' || phase === 'go-live') && deps.dryRun !== true && deps.productionPacks !== undefined) {
    const missing = await deps.productionPacks(deps.build);
    if (missing.length === 0) deps.log(`PASS production packs ${phase}: every advertised head has index/${deps.build}`);
    else if (deps.allowMissingPacks === true) deps.log(`NOTE production packs ${phase}: ${missing.join(', ')} (ALLOW_MISSING_PACKS=1)`);
    else refuse(`production packs for ${deps.build} missing on ${missing.length} head(s): ${missing.slice(0, 8).join(', ')} (FR-A17: let the cook finish; ALLOW_MISSING_PACKS=1 only with Jake's word)`);
  }
}

/**
 * QA 11-25 row 131 (v0.1.92, rows 121 and 123): production's page named 357 content paths its set never held. Before the
 * alias moves the local build is read; after it, the live page; a miss stops the release (after the move: fix the set
 * forward, the alias stays).
 * @param {'before' | 'after'} when @param {Deps} deps @param {(message: string) => void} refuse
 */
async function contentGate(when, deps, refuse) {
  if (deps.contentReach === undefined) return;
  const label = when === 'before' ? 'before the alias move' : 'after the alias move';
  const staging = deps.qa?.contentBase;
  if (staging === undefined) deps.log(`NOTE production content ${label}: the staging verdict names no content set (verdicts before QA 11-25 row 131), so staging's bytes are not compared`);
  /** @type {{summary: string, problems: string[]}} */
  let reach;
  try { reach = await deps.contentReach(when, staging); }
  catch (error) { reach = {summary: '', problems: [`the page or its set could not be read: ${error instanceof Error ? error.message : String(error)}`]}; }
  if (reach.problems.length === 0) { deps.log(`PASS production content ${label}: ${reach.summary}`); return; }
  if (deps.allowContentGaps === true) { deps.log(`NOTE production content ${label}: ${reach.problems.join('; ')} (ALLOW_CONTENT_GAPS=1)`); return; }
  refuse(`production content ${label}: ${reach.problems.join('; ')}${when === 'after' ? ' (the alias has moved: fix the set forward)' : ''} (QA 11-25 row 131; ALLOW_CONTENT_GAPS=1 under J381)`);
}

/**
 * @typedef {{ qa?: boolean, kind?: string, full?: boolean, build?: string, release?: string, url?: string, hold?: boolean,
 *   roomsSerial?: number, deploymentId?: string, proofs?: readonly { id?: string, pass?: boolean }[],
 *   scenarios?: readonly { id?: string, status?: string }[],
 *   findings?: readonly { scenario?: string, severity?: string, text?: string }[], problem?: string,
 *   deploy?: {zoneEntry?: ZoneEntryProof}, contentBase?: string }} QaVerdict  `contentBase`: the content set staging QA
 *   played (staging-deploy.mjs, QA 11-25 row 131).
 */

/** @typedef {{build?:string,engine?:string,profile?:string,mode?:string,pass?:boolean,expected?:number,arrivals?:readonly {from:string,to:string}[],
 *   failure?:{from:string,to:string,reason:string}}} ZoneEntryProof */

/** J476 binds the post-deploy WebKit smoke to the staging build. J451 full-route proofs remain readable.
 * @param {ZoneEntryProof | undefined} proof @param {string} build */
export function zoneEntryGap(proof, build) {
  if (proof === undefined || proof.build !== build) return 'no J451 zone-entry smoke for this build';
  if (proof.failure !== undefined) return `${proof.failure.from} -> ${proof.failure.to}: ${proof.failure.reason}`;
  if (proof.engine !== 'webkit' || proof.profile !== 'phone') return 'J451 zone-entry smoke needs phone-profile WebKit';
  if (proof.mode === 'smoke') return smokeGap(proof);
  const {arrivals, expected} = proof, first = arrivals?.[0];
  if (proof.pass !== true || !Array.isArray(arrivals) || !Number.isSafeInteger(expected) ||
      expected !== arrivals.length || first?.from !== 'driftwood-isle' || first.to !== 'far-reach') {
    return 'J451 zone-entry smoke did not complete every live neighbour pair';
  }
  const seen = new Set();
  for (const [index, pair] of arrivals.entries()) {
    const id = `${pair.from}/${pair.to}`;
    if (seen.has(id) || (index > 0 && arrivals[index-1]?.to !== pair.from)) return 'J451 zone-entry smoke did not follow one continuous tour';
    seen.add(id);
  }
  if (arrivals.at(-1)?.to !== first.from || arrivals.some(pair => !seen.has(`${pair.to}/${pair.from}`))) {
    return 'J451 zone-entry smoke is missing a return crossing';
  }
  return undefined;
}

/** The staging smoke's five kept scenarios (meta STAGING-SMOKE SM0); staging-qa.mjs adds K6. */
export const SMOKE_SCENARIOS = Object.freeze(['K1', 'K2', 'K3', 'K4', 'K5']);

/** STAGING-QA SQ15: the legs production reads, and the scenarios each must have run (staging-qa-budget.mjs LEGS). */
export const QA_LEGS = Object.freeze({candidate: LEGS.candidate, staging: LEGS.staging});

/** @param {QaVerdict | undefined} qa @param {string | undefined} source @param {string} release */
export function localQaGap(qa, source, release) {
  if (qa === undefined) return 'no local verdict';
  if (qa.problem !== undefined) return qa.problem;
  if (qa.qa !== true || qa.kind !== 'local' || qa.full !== true) return 'a full local staging-qa.mjs verdict is required';
  if (typeof source !== 'string' || !/^[a-f0-9]{40}$/u.test(source) || qa.build !== source || qa.release !== release) {
    return 'the local verdict must name the exact release source and version';
  }
  if (qa.hold !== false) return 'local QA holds the release';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/u.test(qa.url ?? '')) return 'local QA must use the loopback rig';
  const ran = new Set([...(qa.scenarios ?? []).filter(row => row.status === 'ran').map(row => row.id),
    ...(qa.proofs ?? []).filter(row => row.pass === true).map(row => row.id)]);
  const missing = LEGS.local.filter(id => id !== 'build' && !ran.has(id));
  return missing.length === 0 ? undefined : `local QA is missing ${missing.join(', ')}`;
}

/** @param {QaVerdict | undefined} qa @param {string} build @param {string} release @param {string} deploymentId @param {number | undefined} serial */
function candidateQaGap(qa, build, release, deploymentId, serial) {
  const gap = qaGap(qa, build);
  if (gap !== undefined) return gap;
  if (qa?.kind !== 'candidate' || qa.release !== release) return 'the candidate verdict must name the release being deployed';
  if (qa.deploymentId !== deploymentId) return 'the candidate verdict names a different Worker deployment';
  if (serial === undefined || qa.roomsSerial !== serial) return 'the candidate verdict names a different signed rooms serial';
  return undefined;
}

/**
 * SQ15 (J398's hold, J426): why a staging-qa verdict does not let `build` go live, or undefined. It must be the full default
 * leg of the candidate or of live staging, on this build and on the staging origin, every scenario run (K1 and K2 may skip:
 * they seed the old cache on a first run), and not held.
 * @param {QaVerdict | undefined} qa @param {string} build @returns {string | undefined}
 */
export function qaGap(qa, build) {
  if (qa === undefined) return 'no --qa verdict';
  if (qa.problem !== undefined) return qa.problem;
  if (qa.qa !== true) return 'not a staging-qa.mjs verdict';
  if (qa.build !== build) return `the verdict is for ${qa.build?.slice(0, 8) ?? 'no build'}, not ${build.slice(0, 8)}`;
  const steps = qa.kind === 'candidate' || qa.kind === 'staging' ? QA_LEGS[qa.kind] : undefined;
  if (steps === undefined) return `a ${qa.kind ?? 'unnamed'} leg: production reads the candidate's or live staging's`;
  if (qa.full !== true) return 'a partial run (--only): run the whole leg';
  if (qa.url !== CHANNELS.staging.origin) return `the verdict ran on ${qa.url ?? 'no url'}, not ${CHANNELS.staging.origin}`;
  const ran = new Map((qa.scenarios ?? []).map(s => [s.id, s.status]));
  const missing = steps.filter(id => ran.get(id) !== 'ran' && !(ran.get(id) === 'skip' && (id === 'K1' || id === 'K2')));
  if (missing.length > 0) return `scenarios not run cleanly: ${missing.map(id => `${id} ${ran.get(id) ?? 'missing'}`).join(', ')}`;
  if (qa.hold !== false) {
    const held = (qa.findings ?? []).filter(f => f.severity === 'P0' || f.severity === 'P1').map(f => `${f.severity ?? ''} ${f.scenario ?? ''} ${f.text ?? ''}`.trim());
    return `it holds: ${held.join('; ') || 'hold is not false'}`;
  }
  return undefined;
}

/**
 * The signed file names this exact build. This check can pass while rooms are still switching.
 * @param {ChannelConfig} channel @param {Deps} deps
 * @returns {Promise<{serial?: number, problem?: string}>}
 */
async function readSignedGate(channel, deps) {
  /** @type {any} */
  let signed;
  try { signed = await deps.fetchJSON(channel.release); } catch { return {problem: `${channel.release} unreadable`}; }
  let valid = false;
  try {
    valid = typeof signed?.body === 'string' && typeof signed?.signature === 'string' && verify(null, Buffer.from(signed.body),
      createPublicKey({key: Buffer.from(deps.releaseKey ?? RELEASE_PUBLIC_KEY, 'hex'), format: 'der', type: 'spki'}), Buffer.from(signed.signature, 'hex'));
  } catch { valid = false; }
  if (!valid) return {problem: `${channel.release} signature does not verify`};
  let release;
  try { release = JSON.parse(signed.body); } catch { return {problem: `${channel.release} body is not JSON`}; }
  if (release === null || typeof release !== 'object' || !Number.isSafeInteger(release.serial) || release.serial < 1) return {problem: `${channel.release} has an invalid serial`};
  const expectedChannel = channel.channel === 'explore' ? 'staging' : channel.channel;
  if (release.channel !== expectedChannel) return {problem: `${channel.release} is channel ${release.channel}`};
  if (release.engineBuild !== deps.build) return {problem: `${channel.release} serial ${release.serial} signs ${release.engineBuild}, not ${deps.build}`};
  if (release.saveEpoch !== deps.manifest.saveEpoch) return {problem: `${channel.release} save epoch ${release.saveEpoch} is not ${deps.manifest.saveEpoch}`};
  if (channel.channel === 'explore') return {serial: release.serial};
  if (channel.solo) return release.socket === undefined && release.bundle === undefined
    ? {serial: release.serial} : {problem: `${channel.release} must be solo (no socket or server bundle)`};
  if (String(release.socket).replace(/\/$/u, '') !== channel.socket) return {problem: `${channel.release} socket ${release.socket} is not ${channel.socket}`};
  return {serial: release.serial};
}

/** PV13: preview signs and reads no release file of its own; every other channel waits on its signed gate.
 * @param {ChannelConfig} channel */
export const ownGate = channel => channel.channel !== 'preview';

/** @param {ChannelConfig} channel @param {Deps} deps */
export async function readGate(channel, deps) {
  const signed = await readSignedGate(channel, deps);
  if (signed.problem !== undefined) return signed;
  if (channel.channel === 'explore') {
    const versionURL = `${CHANNELS.staging.origin}/version.json`;
    try {
      const page = await deps.fetchJSON(versionURL);
      if (page?.build !== deps.build) return {problem: `${versionURL} names ${page?.build}, not ${deps.build}`};
    } catch { return {problem: `${versionURL} unreadable`}; }
    return signed;
  }
  if (channel.solo) return signed;
  /** @type {any} */
  let health;
  try { health = await deps.fetchJSON(channel.health); } catch { return {problem: `${channel.health} unreadable`}; }
  if (health?.build !== deps.build || health?.serial !== signed.serial) return {problem: `${channel.health} shows ${health?.build} serial ${health?.serial}, not ${deps.build} serial ${signed.serial}`};
  return signed;
}

/** @param {ChannelConfig} channel @param {Deps} deps @param {(message: string) => void} refuse */
async function waitForGate(channel, deps, refuse, signedOnly = false) {
  const deadline = deps.now() + (deps.dryRun ? 0 : deps.waitMs ?? 45 * 60_000);
  for (let last = '';;) {
    const gate = signedOnly ? await readSignedGate(channel, deps) : await readGate(channel, deps);
    if (gate.problem === undefined) return gate;
    if (deps.now() >= deadline) { refuse(`gave up waiting: ${gate.problem}`); return gate; }
    if (gate.problem !== last) deps.log(`waiting: ${gate.problem}`);
    last = gate.problem;
    await deps.sleep(deps.pollMs ?? (signedOnly ? 5000 : 30_000));
  }
}

/**
 * After the alias move the channel's own domain serves this build and this channel's release file.
 * @param {ChannelConfig} channel @param {Deps} deps */
async function domainGap(channel, deps) {
  const version = /** @type {{build?: string, saveEpoch?: number}|null} */ (await deps.fetchJSON(`${channel.origin}/version.json`).catch(() => null));
  if (version?.build !== deps.build || version.saveEpoch !== deps.manifest.saveEpoch) return `${channel.origin} still serves ${version?.build} after the alias move`;
  const html = await deps.fetchText(`${channel.origin}/`).catch(() => undefined);
  if (html === undefined) return `${channel.origin} page is unreadable after the alias move`;
  if (!html.includes(`globalThis.__WS_BUILD_ID__=${JSON.stringify(deps.build)};`)) return `${channel.origin} page is not stamped with ${deps.build} yet`;
  if (channel.solo) return html.includes(RELEASES_ORIGIN) ? `${channel.origin} page names a release file, but the channel is solo` : undefined;
  if (!html.includes(channel.release) || html.includes(`${RELEASES_ORIGIN}/${channel.other}.json`)) return `${channel.origin} page does not name only ${channel.release}`;
  return undefined;
}

/** @param {ChannelConfig} channel @param {Deps} deps @param {(message: string) => void} refuse */
async function waitForDomain(channel, deps, refuse) {
  for (let attempt = 0;; attempt++) {
    // QA59: version.json and HTML can propagate separately across the edge.
    const problem = await domainGap(channel, deps);
    if (problem === undefined) return;
    if (attempt >= 12) { refuse(problem); return; }
    await deps.sleep(10_000);
  }
}
