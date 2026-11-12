#!/usr/bin/env node
// D24 phase 2 (G799: no Vite plugins): the app build as a plain script. Its own steps run around `vite build` (each
// former Vite plugin is one of them), so every caller builds the app through this file, never a bare `vite build`.
//
//   node scripts/build-app.mjs [vite build arguments…]       e.g. --config <file>, --outDir <dir>
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { bakeAssetTables, writeAssetTables } from "./app-build/assetTables.mjs";
import { writeChunkReport } from "./app-build/chunkReport.mjs";
import { bakeGridSeams, writeGridSeams } from "./app-build/gridSeams.mjs";
import { checkNoTopLevelAwait } from "./app-build/noTopLevelAwait.mjs";
import { checkImportMaps } from "./app-build/importMap.mjs";
import { nameChunksByFinalBytes } from "./app-build/finalChunkNames.mjs";
import { writeTitleAssets } from "./title-assets.mjs";
import {
  copyOutputProducts,
  copyDeferredPublic,
  pruneLooseCopies,
} from "./app-build/outputProducts.mjs";
import { stampBuildDocuments } from "./app-build/buildIdentity.mjs";
import { homeIconChannel, writeHomeIcons } from "./app-build/homeIcons.mjs";
import { carryPreviousDeploy, channelOrigin, previousDeployOptional } from "./app-build/previousDeploy.mjs";
import { assertAssetLimits, describeAssetLimits } from "./app-build/assetLimits.mjs";
import { buildValidationReceipts } from "./app-build/validationReceipts.mjs";
import { shardfileValidationRevision } from "./shardfile-validation-revision.mjs";
import { checkBakedTextures } from "./app-build/bakedTextures.mjs";

import { assertHeavyLease } from "./heavy-lane-lease.mjs";

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
  if (shardSource) {
    step(["scripts/gen-shards.mjs"]);
    for (const baker of ["bake-chunk", "bake-sky"]) {
      const run = spawnSync(
        process.execPath,
        ["--import", "./scripts/bake-loader.mjs", `scripts/${baker}.mjs`],
        { stdio: "inherit" },
      );
      if (run.status !== 0)
        console.warn(`[bake] ${baker} failed — launch retains its analytic fallback`);
    }
  }
  step([
    "--import",
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./scripts/app-build/gen.ts')).generateBootTables();",
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
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "await (await import('./scripts/app-build/worldMapAtlas.ts')).writeWorldMapAtlas(process.cwd());",
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
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./scripts/app-build/versionFiles.ts')).writeVersionFiles(process.argv[1], process.argv[2]);",
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
    writeChunkReport(outDir, process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    throw new AppBuildFailureError(1);
  }
  step([
    "--import",
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./scripts/app-build/bootModules.ts')).writeBootModules(process.argv[1], process.cwd()); const started = Date.now(); await (await import('./scripts/app-build/appCook.ts')).writeEntryBootstrap(process.argv[1], process.cwd(), parts => { console.log('[spawn parts] ' + parts.parts + ' parts, ' + (parts.rawBytes / 1e6).toFixed(1) + ' MB raw, ' + (parts.wireBytes / 1e6).toFixed(1) + ' MB q11 (' + parts.encoded + ' encoded) in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s'); });",
    outDir,
  ]);
  // C3 (D7): the catalogue this build runs, as a file and inlined in the document, before the service worker hashes it.
  step([
    "--import",
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "await (await import('./scripts/app-build/catalogue.ts')).bakeCatalogue(process.argv[1], process.cwd());",
    outDir,
  ]);

  // HTML owns the deploy identity; hashed runtime code stays reusable across builds.
  // Calibration documents need it too. The worker must see these final bytes.
  const validator = shardfileValidationRevision();
  // E7.2d: a build with a release file is a build of the one world. Every other build stays standalone.
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
  stampBuildDocuments(outDir, {
    validator,
    verdicts: buildValidationReceipts(validator),
    ...(world === undefined ? {} : { world }),
  });
  // J236: production plain, staging the S, the solo build the P; before the worker reads the final document.
  writeHomeIcons(outDir, homeIconChannel(world));

  writeTitleAssets(process.cwd(), outDir);

  // the standalone shell and its server worker under the build's folder, before the service worker, which precaches them (J130)
  await (
    await import("./app-build/standaloneOutput.mjs")
  ).writeStandaloneOutput(outDir, buildId, process.cwd());

  // the crossroads phone rig beside the bundle (was vite/crossroadsRig.ts); before the worker, which counts its files
  step([
    "--import",
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "(await import('./scripts/app-build/crossroadsRig.ts')).writeCrossroadsRig(process.argv[1], process.cwd(), (await import('./scripts/api-origin.mjs')).apiOriginSet());",
    outDir,
  ]);
  // J217 (LD6b): chunks name each other through each document's import map; with every document and bundle written,
  // refuse a document without its map, or a request that resolves nowhere
  checkImportMaps(outDir);
  // the service worker over the bundle as written (was vite/pwa-plugin.ts): sw.js and its content-named core
  step([
    "--import",
    "./scripts/bake-loader.mjs",
    "--input-type=module",
    "-e",
    "await (await import('./scripts/app-build/serviceWorker.ts')).writeServiceWorker(process.argv[1], process.cwd());",
    outDir,
  ]);

  // the compiled DEVSERVER mode, as a machine-readable artifact beside the bundle (scripts/check-devserver.mjs, sharddev/dev.ts);
  // the bundle itself takes it from the __DEVSERVER__ define (was vite/devserver.ts)
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "build-flags.json"),
    JSON.stringify({ devserver: mode === "devserver" }),
  );

  // the data products beside the app (was vite/outputProducts.ts)
  copyOutputProducts(process.cwd(), outDir);
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
      "scripts/shard-size-gate.mjs",
      outDir,
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
  console.log(
    "Previous deploy chunks:",
    await carryPreviousDeploy(outDir, {
      ...(previousDirectory === undefined ? {} : { previousDirectory }),
      ...(previousOrigin === undefined ? {} : { previousOrigin }),
      optional,
      contentBase,
    }),
  );

  // OFF-VERCEL OV3: dist/ is the Workers asset directory. Refuse what Workers static assets would refuse.
  if (outDir === resolve("dist")) console.log(`Asset limits: ${describeAssetLimits(assertAssetLimits(outDir))}`);
}
