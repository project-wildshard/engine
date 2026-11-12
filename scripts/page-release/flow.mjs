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
// Preview (the solo build of green main, J274: hourly) has no world: no release file, no packs and no gate. Its check
// and go-live compare bytes and move the alias.
//
// The flow owns order and gates; the host (hosts/vercel.mjs or hosts/workers.mjs, page-release.mjs --host) owns how a
// page is packaged, uploaded, read back and aliased. Every dependency comes in through `deps`, so the tests drive a fake host.
// J205: the flow opens no socket. Nothing here ever joins a channel; production proofs are static.
import {createHash, createPublicKey, verify} from 'node:crypto';

export const PACKS_ORIGIN = 'https://packs.wildshard.io';
/** E7_RELEASE_PUBLIC_KEY (engine variable), SPKI DER as hex: the box's RELEASE_PUBLIC_KEY and the pages' key. */
export const RELEASE_PUBLIC_KEY = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
export const PHASES = /** @type {const} */ (['build', 'upload', 'check', 'go-live']);
/** The static documents whose deployed bytes must equal the local build before the alias moves (OV4). The import map
 * is inline in index.html (scripts/app-build/importMap.mjs), so there is no importmap.json to compare. */
export const CHECKED_DOCUMENTS = /** @type {const} */ (['version.json', 'index.html', 'sw.js', 'deploy-chunks.json']);

/** @typedef {'staging'|'production'} WorldChannel */
/** @typedef {WorldChannel|'preview'} Channel */
/** @typedef {typeof PHASES[number]} Phase */
/** @typedef {{channel: WorldChannel, solo: false, other: WorldChannel, origin: string, release: string, socket: string, health: string}} WorldChannelConfig */
/** @typedef {{channel: 'preview', solo: true, origin: string}} SoloChannelConfig */
/** @typedef {WorldChannelConfig|SoloChannelConfig} ChannelConfig */

/** @type {{staging: WorldChannelConfig, production: WorldChannelConfig, preview: SoloChannelConfig}} */
export const CHANNELS = {
  // SHELL-CUTOVER SC1: the solo build of the newest green main, no world stamp, so the in-page server runs.
  preview: {channel: 'preview', solo: true, origin: 'https://preview.wildshard.io'},
  staging: {
    channel: 'staging', solo: false, other: 'production', origin: 'https://staging.wildshard.io',
    release: `${PACKS_ORIGIN}/releases/staging.json`, socket: 'wss://rooms-staging.wildshard.io',
    // D7: rooms' public /health is private; the tailnet one is the build's proof.
    health: 'https://wildshard.tailb41b20.ts.net:8443/health',
  },
  production: {
    channel: 'production', solo: false, other: 'staging', origin: 'https://play.wildshard.io',
    release: `${PACKS_ORIGIN}/releases/production.json`, socket: 'wss://rooms.wildshard.io',
    health: 'https://wildshard.tailb41b20.ts.net/health',
  },
};

export class RefusedError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = 'RefusedError'; }
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
 * @property {(step: 'prepare'|'package'|'upload'|'deployedDigests'|'goLive', context: HostContext) => string[]} describe
 *   What a step would run, for --dry-run. Never includes a credential.
 *
 * @typedef {{parts: number, uploaded: number, held: number, book: string, cors: string}} PacksSummary
 * @typedef {object} PackStore
 * @property {(context: {root: string, build: string, cors: string, dryRun: boolean}) => Promise<PacksSummary>} publish
 *   Parts first, the book last; an existing object must already have the same bytes.
 * @property {(context: {root: string, build: string, cors: string}) => Promise<PacksSummary>} verify  Read-only.
 *
 * @typedef {{set: string, base: string, files: number, bytes: number, uploaded: number, uploadedBytes: number, held: number, cors: string}} ContentSummary
 * @typedef {object} ContentPublisher
 * @property {(context: {dir: string, cors: string, dryRun: boolean}) => Promise<ContentSummary>} publish
 *   PAGE-SIZE PZ2: the page's shard content and engine art to the packs bucket, read back with CORS (content.mjs).
 *
 * @typedef {object} Deps
 * @property {string} root
 * @property {Channel} channel
 * @property {string} build  The full source SHA.
 * @property {PageHost} host
 * @property {PackStore} packs
 * @property {ContentPublisher} [content]  PZ2: publish the page's content set before the page goes up (page-release.mjs
 *   --content). Nothing stamps its base into the page yet: PZ4 and PZ6 do.
 * @property {(file: string, args: string[], env: Record<string, string>) => void} run
 * @property {(url: string) => Promise<unknown>} fetchJSON  200 only, no cache, no redirects.
 * @property {(url: string) => Promise<string>} fetchText
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
 * @property {boolean} [afterStagingProofs]  Production go-live: the strict staging proofs passed on this build.
 * @property {string} [releaseKey]  Defaults to RELEASE_PUBLIC_KEY; tests sign with their own.
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
  if (channel === undefined) throw new RefusedError(`unknown channel ${deps.channel}: preview, staging or production`);
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
  /** @type {HostContext} */
  const context = {root: deps.root, channel, build: deps.build, saveEpoch: deps.manifest.saveEpoch, version: deps.manifest.version};

  if (!/^[0-9a-f]{40}$/u.test(deps.build)) refuse(`build ${deps.build} is not a full SHA`);
  if (deps.git.head() !== deps.build) refuse(`HEAD ${deps.git.head()} is not build ${deps.build}`);
  if (!deps.git.clean()) refuse('the release tree is not clean (one clean clone per channel)');
  if (!(deps.manifest.saveEpoch >= 1)) refuse('save-epoch.json must be at least 1');
  deps.log(`${channel.channel} ${phase} ${deps.build} v${deps.manifest.version} epoch ${deps.manifest.saveEpoch} on ${deps.host.name}${dry ? ' (dry run)' : ''}`);

  if (phase === 'build') {
    const env = buildEnv(channel, deps);
    for (const line of deps.host.describe('prepare', context)) plan(line);
    if (!dry) await deps.host.prepare(context);
    plan(`run pnpm build:game with ${channel.solo ? 'no release file (solo)' : `WILDSHARD_RELEASE_URL=${env.WILDSHARD_RELEASE_URL}`} WS_BUILD_ID=${deps.build} WS_CHANNEL=${channel.channel}`);
    if (!dry) deps.run('pnpm', ['build:game'], {...env, ...deps.host.buildEnv(context)});
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
    /** @type {ContentSummary|undefined} */
    let content;
    if (deps.content !== undefined) {
      plan(`publish the page's content (S1 to S7, E1) from ${deps.host.outputDir(context)} to ${PACKS_ORIGIN}/content/<set>/ with CORS ${channel.origin} (PZ2, before the page)`);
      content = await deps.content.publish({dir: deps.host.outputDir(context), cors: channel.origin, dryRun: dry});
      if (!dry && content.held + content.uploaded !== content.files) refuse(`content: ${content.held} held + ${content.uploaded} uploaded is not ${content.files}`);
    }
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
    deps.state.write('upload', {build: deps.build, channel: channel.channel, deployment, ...(packs === undefined ? {} : {packs}), ...(content === undefined ? {} : {content})});
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
    for (const line of deps.host.describe('deployedDigests', deployed)) plan(line);
    if (!dry) await checkDeployed(deps, deployed, refuse);
    if (channel.solo) {
      // Preview has no gate (J274): no release file, no packs, no rooms.
      if (dry) return {refusals};
      deps.state.write('check', {build: deps.build, channel: channel.channel, deployment});
      deps.log(`PASS ${channel.channel} check ${deployment.id}: deployed bytes equal; solo, no gate; alias not moved`);
      return {refusals};
    }
    plan(`verify the server book and parts on ${PACKS_ORIGIN} answer with CORS ${channel.origin}`);
    if (!dry) await deps.packs.verify({root: deps.root, build: deps.build, cors: channel.origin});
    plan(`wait for ${channel.release} to sign ${deps.build} and ${channel.health} to match its serial`);
    const gate = await waitForGate(channel, deps, refuse);
    if (dry) return {refusals};
    deps.state.write('check', {build: deps.build, channel: channel.channel, deployment, serial: gate.serial});
    deps.log(`PASS ${channel.channel} check ${deployment.id}: deployed bytes equal, packs public, serial ${gate.serial} signed and healthy; alias not moved`);
    return {refusals};
  }

  // go-live: the alias move, last, on a fresh gate. Everything before it must still hold now.
  const checked = deps.state.read('check');
  if (checked?.build !== deps.build || checked?.channel !== channel.channel || checked?.deployment?.id !== deployment.id) refuse(`no ${channel.channel} check of ${deployment.id}: run the check phase first`);
  for (const line of deps.host.describe('deployedDigests', deployed)) plan(line);
  if (!dry) await checkDeployed(deps, deployed, refuse);
  /** @type {{serial?: number, problem?: string}} */
  let gate = {};
  if (!channel.solo) {
    plan(`re-read ${channel.release} and ${channel.health}: both must name ${deps.build} and one serial`);
    gate = await readGate(channel, deps);
    if (gate.problem !== undefined) refuse(gate.problem);
    else if (checked !== undefined && gate.serial !== checked.serial) deps.log(`note: serial moved ${checked.serial} -> ${gate.serial} since check, still ${deps.build}`);
  }
  for (const line of deps.host.describe('goLive', deployed)) plan(line);
  if (dry) return {refusals};
  await deps.host.goLive(deployed);
  deps.log(`ALIAS MOVED ${channel.origin} -> ${deployment.id}; checking the domain`);
  await waitForDomain(channel, deps, refuse);
  deps.state.write('go-live', {build: deps.build, channel: channel.channel, deployment, ...(gate.serial === undefined ? {} : {serial: gate.serial})});
  deps.log(`PASS ${channel.origin} -> ${deps.build} ${deployment.id} ${channel.solo ? 'solo, no gate' : `after matching serial ${gate.serial}`} (alias last)`);
  deps.log(channel.solo ? `next: node scripts/e7-doctor-proof.mjs ${channel.origin} ${deps.build} --human-static`
    : channel.channel === 'staging'
    ? `next: strict staging proofs, then production. node scripts/e7-doctor-proof.mjs ${channel.origin} ${deps.build} ${RELEASE_PUBLIC_KEY}; node scripts/e7-live-staging-proof.mjs ${channel.origin} ${deps.build} ${RELEASE_PUBLIC_KEY} chromium|webkit`
    : `next: static proof only (J205). node scripts/e7-doctor-proof.mjs ${channel.origin} ${deps.build} ${RELEASE_PUBLIC_KEY} --human-static`);
  return {refusals};
}

/** @param {ChannelConfig} channel @param {Deps} deps @returns {Record<string, string>} */
export function buildEnv(channel, deps) {
  const common = {
    WS_BUILD_ID: deps.build, WILDSHARD_CATALOGUE: 'test/pins/catalogue.json',
    WS_PREVIOUS_DEPLOY_ORIGIN: channel.origin, WS_RELEASE: '1', WS_CHANNEL: channel.channel,
  };
  // Preview is the solo game: no release file, so the build stamps no world (app-build-pipeline.mjs E7.2d).
  return channel.solo ? common
    : {...common, WILDSHARD_RELEASE_URL: channel.release, WILDSHARD_RELEASE_KEY: deps.releaseKey ?? RELEASE_PUBLIC_KEY};
}

/**
 * The packaged page names this build, this channel's release file and key, and never the other channel's file.
 * @param {ChannelConfig} channel @param {Deps} deps @param {HostContext} context @param {(message: string) => void} refuse
 * @returns {Record<string, string>} sha256 of each checked document
 */
function checkOutput(channel, deps, context, refuse) {
  const out = deps.host.outputDir(context);
  /** @type {Record<string, string>} */
  const files = {};
  for (const name of CHECKED_DOCUMENTS) files[name] = sha256(deps.readFile(`${out}/${name}`));
  const version = JSON.parse(Buffer.from(deps.readFile(`${out}/version.json`)).toString('utf8'));
  if (version.build !== deps.build) refuse(`version.json names ${version.build}, not ${deps.build}`);
  if (version.saveEpoch !== deps.manifest.saveEpoch) refuse(`version.json save epoch ${version.saveEpoch} is not ${deps.manifest.saveEpoch}`);
  const html = Buffer.from(deps.readFile(`${out}/index.html`)).toString('utf8');
  if (!html.includes(`globalThis.__WS_BUILD_ID__=${JSON.stringify(deps.build)};`)) refuse('index.html is not stamped with this build');
  const stamp = /globalThis\.__WS_WORLD__=(\{[^;]+\});/u.exec(html)?.[1];
  if (channel.solo) {
    if (stamp !== undefined || html.includes('/releases/')) refuse('index.html names a world, but preview is the solo game');
    return files;
  }
  const world = stamp === undefined ? undefined : JSON.parse(stamp);
  if (world?.release !== channel.release) refuse(`index.html release file is ${world?.release}, not ${channel.release}`);
  if (world?.key !== (deps.releaseKey ?? RELEASE_PUBLIC_KEY)) refuse('index.html release key is not E7_RELEASE_PUBLIC_KEY');
  if (html.includes(`/releases/${channel.other}.json`)) refuse(`index.html names the ${channel.other} release file`);
  return files;
}

/** @param {Deps} deps @param {HostContext & {deployment: Deployment}} deployed @param {(message: string) => void} refuse */
async function checkDeployed(deps, deployed, refuse) {
  const remote = await deps.host.deployedDigests(deployed, CHECKED_DOCUMENTS);
  const out = deps.host.outputDir(deployed);
  for (const name of CHECKED_DOCUMENTS) {
    const found = remote.get(name);
    const local = found === undefined ? '' : createHash(found.algorithm).update(deps.readFile(`${out}/${name}`)).digest('hex');
    if (found === undefined || found.digest !== local) refuse(`deployed ${name} of ${deployed.deployment.id} differs from the local build`);
  }
}

/**
 * Production comes after staging: the version tag names this build, staging serves it, and (for go-live) the strict
 * staging proofs passed. J205: those proofs ran on staging; nothing here joins production.
 * @param {Phase} phase @param {Deps} deps @param {(message: string) => void} refuse
 */
async function productionGates(phase, deps, refuse) {
  const tag = `v${deps.manifest.version}`;
  const tagged = deps.git.remoteTag(tag);
  if (tagged !== deps.build) refuse(`origin tag ${tag} is ${tagged ?? 'missing'}, not ${deps.build} (release.sh ${tag} --finish first)`);
  const staging = /** @type {{build?: string}} */ (await deps.fetchJSON(`${CHANNELS.staging.origin}/version.json`).catch(() => ({})));
  if (staging.build !== deps.build) refuse(`staging serves ${staging.build ?? 'nothing'}, not ${deps.build}: staging goes live first`);
  if (phase === 'go-live' && deps.afterStagingProofs !== true) refuse('production go-live needs --after-staging-proofs: Doctor 7/7 and the live proof on Chromium and WebKit over staging');
}

/**
 * The signed release file names this build, and the channel's /health shows this build at that serial.
 * @param {WorldChannelConfig} channel @param {Deps} deps
 * @returns {Promise<{serial?: number, problem?: string}>}
 */
export async function readGate(channel, deps) {
  /** @type {any} */
  let signed;
  try { signed = await deps.fetchJSON(channel.release); } catch { return {problem: `${channel.release} unreadable`}; }
  let valid = false;
  try {
    valid = typeof signed?.body === 'string' && typeof signed?.signature === 'string' && verify(null, Buffer.from(signed.body),
      createPublicKey({key: Buffer.from(deps.releaseKey ?? RELEASE_PUBLIC_KEY, 'hex'), format: 'der', type: 'spki'}), Buffer.from(signed.signature, 'hex'));
  } catch { valid = false; }
  if (!valid) return {problem: `${channel.release} signature does not verify`};
  const release = JSON.parse(signed.body);
  if (release.channel !== channel.channel) return {problem: `${channel.release} is channel ${release.channel}`};
  if (release.engineBuild !== deps.build) return {problem: `${channel.release} serial ${release.serial} signs ${release.engineBuild}, not ${deps.build}`};
  if (release.saveEpoch !== deps.manifest.saveEpoch) return {problem: `${channel.release} save epoch ${release.saveEpoch} is not ${deps.manifest.saveEpoch}`};
  if (String(release.socket).replace(/\/$/u, '') !== channel.socket) return {problem: `${channel.release} socket ${release.socket} is not ${channel.socket}`};
  /** @type {any} */
  let health;
  try { health = await deps.fetchJSON(channel.health); } catch { return {problem: `${channel.health} unreadable`}; }
  if (health?.build !== deps.build || health?.serial !== release.serial) return {problem: `${channel.health} shows ${health?.build} serial ${health?.serial}, not ${deps.build} serial ${release.serial}`};
  return {serial: release.serial};
}

/** @param {WorldChannelConfig} channel @param {Deps} deps @param {(message: string) => void} refuse */
async function waitForGate(channel, deps, refuse) {
  const deadline = deps.now() + (deps.dryRun ? 0 : deps.waitMs ?? 45 * 60_000);
  for (let last = '';;) {
    const gate = await readGate(channel, deps);
    if (gate.problem === undefined) return gate;
    if (deps.now() >= deadline) { refuse(`gave up waiting: ${gate.problem}`); return gate; }
    if (gate.problem !== last) deps.log(`waiting: ${gate.problem}`);
    last = gate.problem;
    await deps.sleep(deps.pollMs ?? 30_000);
  }
}

/**
 * After the alias move the channel's own domain serves this build and this channel's release file.
 * @param {ChannelConfig} channel @param {Deps} deps @param {(message: string) => void} refuse */
async function waitForDomain(channel, deps, refuse) {
  for (let attempt = 0;; attempt++) {
    const version = /** @type {{build?: string, saveEpoch?: number}} */ (await deps.fetchJSON(`${channel.origin}/version.json`).catch(() => ({})));
    if (version.build === deps.build && version.saveEpoch === deps.manifest.saveEpoch) break;
    if (attempt >= 12) { refuse(`${channel.origin} still serves ${version.build} after the alias move`); return; }
    await deps.sleep(10_000);
  }
  const html = await deps.fetchText(`${channel.origin}/`);
  if (channel.solo) { if (html.includes('/releases/')) refuse(`${channel.origin} page names a release file, but preview is solo`); return; }
  if (!html.includes(channel.release) || html.includes(`/releases/${channel.other}.json`)) refuse(`${channel.origin} page does not name only ${channel.release}`);
}
