#!/usr/bin/env node
// The normal CLI and J233 watcher share the exact admitted app pipeline.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { newBuildId } from "./app-build/buildIdentity.mjs";
import { builtAtOf } from "./app-build/builtAt.mjs";
import { deferredPublicCopy } from "./app-build/outputProducts.mjs";
import { prepareAppBuild, finishAppBuild, AppBuildFailureError } from "./app-build-pipeline.mjs";

const args = process.argv.slice(2);
/** a `--name value` or `--name=value` argument's value
 * @param {string} name */
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  if (at !== -1) return args[at + 1];
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
};
// the folder the config builds into: dist, unless the caller names one
const mode = option("mode") ?? "production",
  outDir = resolve(option("outDir") ?? "dist");

try {
  prepareAppBuild();

  const vite = resolve(import.meta.dirname, "../node_modules/vite/bin/vite.js");
  const buildId = newBuildId();
  // STALE-BUILD SB1 (J321): one build time for every step's stamp (version.json, the documents, the entry, sw.js);
  // a caller may pass its own, as with WS_BUILD_ID
  process.env.WS_BUILT_AT = builtAtOf(process.env.WS_BUILT_AT);
  const deferPublic = deferredPublicCopy(process.cwd(), outDir, args);
  // vite.config.ts bundles to one module whose static imports reach @wildshard/format, so the hook comes first (J82).
  const build = spawnSync(
    process.execPath,
    ["--import", resolve(import.meta.dirname, "./format-hook.mjs"), vite, "build", ...args],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        WS_APP_DEFER_PUBLIC_COPY: deferPublic ? "1" : "0",
        WS_BUILD_ID: buildId,
      },
    },
  );
  if (build.error !== undefined) throw build.error;
  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
    process.exit();
  }
  await finishAppBuild({ outDir, buildId, mode, deferPublic });
} catch (error) {
  if (!(error instanceof AppBuildFailureError)) throw error;
  process.exitCode = error.exitCode;
}
