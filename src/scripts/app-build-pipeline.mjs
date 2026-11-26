#!/usr/bin/env node
// D24 phase 2 (G799: no Vite plugins): the app build as a plain script. Its own steps run around `vite build` (each
// former Vite plugin is one of them), so every caller builds the app through this file, never a bare `vite build`.
//
//   node src/scripts/build-app.mjs [vite build arguments…]       e.g. --config <file>, --outDir <dir>
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { bakeAssetTables, writeAssetTables } from "./app-build/assetTables.mjs";
import { writeChunkReport } from "./app-build/chunkReport.mjs";
import { writeTitlePreloads } from "./app-build/titlePreloads.mjs";
import { writeIsolationRule } from "./app-build/isolation.mjs";
import { bakeGridSeams, writeGridSeams } from "./app-build/gridSeams.mjs";
import { checkNoTopLevelAwait } from "./app-build/noTopLevelAwait.mjs";
import { checkImportMaps } from "./app-build/importMap.mjs";
import { checkOneThree } from "./app-build/oneThree.mjs";
import { checkNoJunk } from "./app-build/noJunk.mjs";
import { checkCodeLayout } from "./app-build/codeLayout.mjs";
import { nameChunksByFinalBytes } from "./app-build/finalChunkNames.mjs";
import { writeTitleAssets } from "./title-assets.mjs";
import {
  copyOutputFolders,
  checkPublishedMounts,
  copyDeferredPublic,
  pruneLooseCopies,
} from "./app-build/outputFolders.mjs";
import { buildLabelOf, stampBuildDocuments } from "./app-build/buildIdentity.mjs";
import { engineRelease } from "./changelog.mjs";
import { homeIconChannel, writeHomeIcons } from "./app-build/homeIcons.mjs";
import { carryPreviousDeploy, channelOrigin, previousDeployOptional } from "./app-build/previousDeploy.mjs";
import { PAGE_LIMITS, pageSize, shardNames } from "./page-size.mjs";
import { assertAssetLimits, describeAssetLimits } from "./app-build/assetLimits.mjs";
import { shardfileValidationRevision } from "./shardfile-validation-revision.mjs";
import { checkBakedTextures } from "./app-build/bakedTextures.mjs";
import { checkZoneless, dropZoneFiles, isZoneFile } from "./app-build/zoneless.mjs";

import { assertHeavyLease } from "./heavy-lane-lease.mjs";

/** PAGE-SIZE D1: what the kept builds may add, D1's limits less this build's own page (its content and maps go elsewhere).
 * @param {string} outDir @returns {{files: number, bytes: number} | undefined} */
function carryBudget(outDir) {
  if (!existsSync(resolve(outDir, "index.html"))) return undefined;
  const report = pageSize(outDir), zero = { files: 0, bytes: 0 };
  const off = ["maps", "shard content", "engine art"].map((kind) => report.kinds[kind] ?? zero);
  const files = report.total.files - off.reduce((sum, row) => sum + row.files, 0), bytes = report.total.bytes - off.reduce((sum, row) => sum + row.bytes, 0);
  return { files: Math.max(0, PAGE_LIMITS.files - files), bytes: Math.max(0, PAGE_LIMITS.bytes - bytes) };
}

/** SHARD-SOURCE AP5: the dev hook's version (`DEV_HOOK_VERSION` in src/client/game/devScene/hook.ts), for a devserver build's flags. */
function devHookVersion() {
  const version = /export const DEV_HOOK_VERSION = (\d+);/u.exec(readFileSync(resolve(import.meta.dirname, "../client/game/devScene/hook.ts"), "utf8"))?.[1];
  if (version === undefined) throw new Error("app-build: src/client/game/devScene/hook.ts names no DEV_HOOK_VERSION");
  return Number(version);
}

/** A refused child step; the CLI preserves its code, library callers can clean up. */
export class AppBuildFailureError extends Error {
  /** @param {number} exitCode */
  constructor(exitCode) {
    super(`App build step exited ${String(exitCode)}`);
    this.name = "AppBuildFailureError";
    this.exitCode = exitCode;
  }
}

/** a node step that must pass (the build stops with its exit code)
 * @param {string[]} nodeArgs */
const step = (nodeArgs) => {
  const run = spawnSync(process.execPath, nodeArgs, { stdio: "inherit" });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new AppBuildFailureError(run.status ?? 1);
};

/** Prepare the same certified inputs before either a normal or watched bundle. */
export function prepareAppBuild() {
  assertHeavyLease("build");
  // before the bundle (was vite/genShards.ts): the shard list and discovery, the two optional bakes (a failed one keeps its
  // analytic fallback), the boot tables, then the shard list again (the tables can add static imports to a manifest's closure)
  // C3: a tree with no shard source (the lifted engine) has no list or bake to run; it builds from a catalogue and its packs.
  const shardSource = existsSync("src/shards");
  checkBakedTextures(process.cwd(), resolve("public"));
  // A shard-source tree rebuilds out/ from public/ below; only a tree that builds from placed products can hold a stale copy.
  if (!shardSource) checkPublishedMounts(process.cwd());
  if (shardSource) {
    step(["scripts/gen-shards.mjs"]);
    for (const baker of ["bake-chunk", "bake-sky"]) {
      const run = spawnSync(
        process.execPath,
        ["--import", "./src/scripts/bake-loader.mjs", `src/scripts/${baker}.mjs`],
        { stdio: "inherit" },
      );
      if (run.status !== 0)
        console.warn(`[bake] ${baker} failed — launch retains its analytic fallback`);
    }
  }
  step([
    "--import",
    "./src/scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./src/scripts/app-build/gen.ts')).generateBootTables();",
  ]);
  if (shardSource) step(["scripts/gen-shards.mjs"]);
  // the certified grid seams over the generated catalogue (was vite/gridSeamPlans.ts): the config defines their address
  try {
    bakeGridSeams(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    throw new AppBuildFailureError(1);
  }
  // the boot table banks (was vite/assetTables.ts) and the world map atlas over the built products (was
  // vite/worldMapAtlas.ts): the config defines their addresses
  try {
    bakeAssetTables(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    throw new AppBuildFailureError(1);
  }
  step([
    "--import",
    "./src/scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "await (await import('./src/scripts/app-build/worldMapAtlas.ts')).writeWorldMapAtlas(process.cwd());",
  ]);
}

/** Publish and validate a finished app bundle through the production path.
 * @param {{outDir:string,buildId:string,mode:string,deferPublic:boolean}} options */
export async function finishAppBuild({ outDir, buildId, mode, deferPublic }) {
  assertHeavyLease("build");
  // Vite writes a dynamic import's preload list after the importer's hash: name those chunks after their final bytes,
  // before anything reads the file names (main ci 43076662972, app-build/finalChunkNames.mjs)
  const renamed = nameChunksByFinalBytes(outDir);
  if (renamed.length > 0) console.log(`final chunk names: ${renamed.length} chunks renamed after their preload lists`);
  if (deferPublic) copyDeferredPublic(process.cwd(), outDir);
  // E7.5 prep: the Connection doctor's page, in its own small module graph (app-build/doctorOutput.mjs)
  await (
    await import("./app-build/doctorOutput.mjs")
  ).writeDoctorOutput(outDir, buildId, process.cwd());

  // version.json (the build id the documents are stamped with), asset-index.json and asset-manifest.json
  step([
    "--import",
    "./src/scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./src/scripts/app-build/versionFiles.ts')).writeVersionFiles(process.argv[1], process.argv[2]);",
    outDir,
    buildId,
  ]);
  // the seams', boot tables' and world map's exact bytes as their hashed assets, beside the bundle that names them
  writeGridSeams(outDir, process.cwd());
  writeAssetTables(outDir, process.cwd());
  const atlas = JSON.parse(readFileSync("out/.app/world-map.json", "utf8")).fileName;
  mkdirSync(dirname(resolve(outDir, atlas)), { recursive: true });
  copyFileSync("out/.app/world-map.webp", resolve(outDir, atlas));

  // no emitted app JavaScript may suspend its module's evaluation (was vite/noTopLevelAwait.ts); inline workers are iife,
  // where the bundler refuses top-level await itself
  checkNoTopLevelAwait(outDir, resolve("public"));

  // which modules land in which chunk, and the title and grid session budgets over the bytes as written (was
  // vite/chunkReport.ts); then the boot module bank into index.html and each home's extra file table (was
  // vite/bootModules.ts), and the spawn parts' q11 Brotli bodies (DL15, cached by content).
  try {
    const report = writeChunkReport(outDir, process.cwd());
    // PZ18: the title's static closure is preloaded with the entry's own chunks, so the title costs no round trip after it
    const preloads = writeTitlePreloads(outDir, report);
    console.log(`title preloads: ${preloads.length} chunks (${preloads.map((file) => file.split("/").pop()).join(", ")})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    throw new AppBuildFailureError(1);
  }
  step([
    "--import",
    "./src/scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./src/scripts/app-build/bootModules.ts')).writeBootModules(process.argv[1], process.cwd()); const started = Date.now(); await (await import('./src/scripts/app-build/appCook.ts')).writeEntryBootstrap(process.argv[1], process.cwd(), parts => { console.log('[spawn parts] ' + parts.parts + ' parts, ' + (parts.rawBytes / 1e6).toFixed(1) + ' MB raw, ' + (parts.wireBytes / 1e6).toFixed(1) + ' MB q11 (' + parts.encoded + ' encoded) in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s'); });",
    outDir,
  ]);
  // C3 (D7): the catalogue this build runs, as a file and inlined in the document, before the service worker hashes it.
  step([
    "--import",
    "./src/scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "await (await import('./src/scripts/app-build/catalogue.ts')).bakeCatalogue(process.argv[1], process.cwd()); (await import('./src/scripts/app-build/zoneTable.mjs')).bakeZoneTable(process.argv[1], process.env.WS_ZONE_TABLE);",
    outDir,
  ]);

  // HTML owns the deploy identity; hashed runtime code stays reusable across builds.
  // Calibration documents need it too. The worker must see these final bytes.
  const validator = shardfileValidationRevision();
  // STR7 and EX2: only preview and Explore can run an in-page server.
  const {
    WILDSHARD_RELEASE_URL: worldFile,
    WILDSHARD_RELEASE_KEY: worldKey,
    WILDSHARD_RECORD_TAG: recordTag,
  } = process.env;
  if (recordTag !== undefined && !/^[\w.-]{1,64}$/u.test(recordTag))
    throw new Error("WILDSHARD_RECORD_TAG must be a bounded sitting label");
  const world =
    worldFile === undefined || worldKey === undefined
      ? undefined
      : {
          release: worldFile,
          key: worldKey,
          ...(recordTag === undefined ? {} : { recordTag }),
        };
  const preview = mode === "preview" || process.env.WS_CHANNEL === "preview";
  const explore = mode === "explore" || process.env.WS_CHANNEL === "explore";
  const solo = preview || explore;
  if (solo && (preview && explore || worldFile !== undefined || mode === "devserver" ||
    (process.env.WS_CHANNEL !== undefined && process.env.WS_CHANNEL !== (explore ? "explore" : "preview"))))
    throw new Error("A solo build requires one solo channel and cannot name a world or run as devserver");
  const verdicts = /** @type {unknown} */ (JSON.parse(execFileSync(process.execPath, [
    "--import", "./src/scripts/bake-loader.mjs", "./src/scripts/app-build/cookedEntryExclusions.ts", validator,
  ], { encoding: "utf8", maxBuffer: 8 << 20 })));
  if (!Array.isArray(verdicts)) throw new Error("Invalid compiled validation verdicts");
  stampBuildDocuments(outDir, {
    validator,
    verdicts,
    ...(world === undefined ? {} : { world }),
    ...(preview ? { preview: true } : {}),
    ...(explore ? { explore: true } : {}),
    // QA 11-13: the static title's build pill, before any bundle (index.html data-launch-progress)
    label: buildLabelOf(buildId, engineRelease(process.cwd())),
  });
  // J236: production plain, staging the S, the solo build the P; before the worker reads the final document.
  writeHomeIcons(outDir, homeIconChannel(world));

  writeTitleAssets(process.cwd(), outDir);

  // Preview adds its worker beside the common server, storage and identity modules.
  const { checkServerOutput, standaloneServerFile, writeStandaloneOutput } = await import("./app-build/standaloneOutput.mjs");
  await writeStandaloneOutput(outDir, buildId, process.cwd(), { preview: solo, devserver: mode === "devserver" });

  // J217 (LD6b): chunks name each other through each document's import map; with every document and bundle written,
  // refuse a document without its map, or a request that resolves nowhere
  checkImportMaps(outDir);
  // QA 11-25 row 137: the page bundle and the online shell it imports hold one three.js between them
  checkOneThree(outDir, buildId);
  // PZ12 (J274): an isolated channel's page origin sends COOP and COEP on every path; the worker reads the same rule
  if (writeIsolationRule(outDir, process.env.WS_CHANNEL)) console.log(`cross-origin isolated: ${process.env.WS_CHANNEL}`);
  // Fix preview PV3: a page with a zone table reads every zone from the cook (PV4), so the zone files the engine's public/ copy and the
  // entry bake wrote leave before the service worker lists the bundle, and no product folder is copied in below
  const zoneless = (process.env.WS_ZONE_TABLE ?? "") !== "";
  const keep = process.env.WS_ZONE_FILES_OUT;
  if (zoneless) console.log(`zoneless page: ${dropZoneFiles(outDir, keep === undefined || keep === "" ? {} : { keep: resolve(keep) }).length} zone files ${keep ? `moved to ${keep}` : "dropped"}`);
  // the service worker over the bundle as written (was vite/pwa-plugin.ts): sw.js and its content-named core
  step([
    "--import",
    "./src/scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "await (await import('./src/scripts/app-build/serviceWorker.ts')).writeServiceWorker(process.argv[1], process.cwd());",
    outDir,
  ]);

  // the compiled DEVSERVER mode, as a machine-readable artifact beside the bundle (src/scripts/check-devserver.mjs, sharddev/dev.ts);
  // the bundle itself takes it from the __DEVSERVER__ define (was vite/devserver.ts)
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "build-flags.json"),
    // SHARD-SOURCE AP5: a devserver client names its dev hook's version, which sharddev's `watch` checks against its own
    JSON.stringify(mode === "devserver" ? { devserver: true, devHook: devHookVersion() } : { devserver: false }),
  );

  // the data products beside the app (was vite/outputFolders.ts)
  if (!zoneless) copyOutputFolders(process.cwd(), outDir);
  // DL20: the deploy drops the loose copies nothing reads by URL
  const dropped = pruneLooseCopies(outDir);
  checkBakedTextures(process.cwd(), outDir);
  console.log(
    `Loose copies dropped: ${dropped.files} files, ${(dropped.bytes / 1e6).toFixed(1)} MB`,
  );

  // SHARD-SIZE row 1: refuse a shard whose phone download grew. Only the default web output holds the whole book.
  // A deploy with a catalogue cooks after this build, and gates again on what the cook wrote.
  if (outDir === resolve("dist"))
    step([
      "src/scripts/shard-size-gate.mjs",
      outDir,
      // BUDGET-CAPS BC9: a build (ci, a release) refuses only past a hard cap; budgets.yml runs the 10% check after ci.
      "--hard-only",
      ...(process.env.WILDSHARD_CATALOGUE === undefined ? [] : ["--cooks-after"]),
    ]);

  // Carry the kept builds' graphs. The worker precache above deliberately names this
  // graph only; old pages demand their old files as needed. A release build carries from
  // its channel's live origin.
  const previousDirectory = process.env.WS_PREVIOUS_DEPLOY_DIR;
  // OFF-VERCEL OV3: a release says so with WS_RELEASE=1, and its channel (WS_CHANNEL) names the origin
  // it carries from: its own domain, never the old host.
  const release =
    process.env.WS_RELEASE === "1" ||
    (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main");
  const previousOrigin =
    process.env.WS_PREVIOUS_DEPLOY_ORIGIN ??
    (release ? channelOrigin(process.env.WS_CHANNEL) : undefined);
  // ci.yml's test build and the solo preview may meet an unreachable origin; a staging or production release refuses.
  const optional = previousDeployOptional(process.env);
  // PAGE-SIZE PZ5: a build that reads its content from a content base (WS_CONTENT_BASE, stamped by PZ8) names its code
  // only, so a later release carries its code only. A kept build without that mark still carries its content.
  const contentBase = (process.env.WS_CONTENT_BASE ?? "") !== "";
  const budget = carryBudget(outDir);
  console.log(
    "Previous deploy chunks:",
    await carryPreviousDeploy(outDir, {
      ...(previousDirectory === undefined ? {} : { previousDirectory }),
      ...(previousOrigin === undefined ? {} : { previousOrigin }),
      optional,
      contentBase,
      ...(solo ? {} : { keepFile: path => !standaloneServerFile(path) }),
      // PV3: a zoneless page carries no earlier build's zone file either
      ...(zoneless ? { keepFile: (shards => path => !isZoneFile(path, shards))(shardNames(outDir)) } : {}),
      ...(budget === undefined ? {} : { budget }),
    }),
  );

  checkServerOutput(outDir, solo);
  if (zoneless) checkZoneless(outDir);
  // QA 11-26 row 14: no video and no measuring rig in a page build
  checkNoJunk(outDir);
  // fix-preview PV9: code under builds/<engineVersion>/<build>/ and builds/shared/, the page under 20,000 files
  const layout = checkCodeLayout(outDir);
  console.log(`Code layout: ${layout.own}/, ${layout.files} files`);

  // OFF-VERCEL OV3: dist/ is the Workers asset directory. Refuse what Workers static assets would refuse.
  if (outDir === resolve("dist")) console.log(`Asset limits: ${describeAssetLimits(assertAssetLimits(outDir))}`);
}
