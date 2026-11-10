// Manual outer-edge failure proof; run under heavy-lane.py build, outside hooks.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const started = performance.now(),
  root = resolve(import.meta.dirname, "..");
const scratch = process.argv.find((value) => value.startsWith("--scratch="))?.slice(10);
const baseline = process.argv.find((value) => value.startsWith("--baseline="))?.slice(11);
assert.ok(scratch !== undefined && baseline !== undefined && /^[a-f0-9]{40}$/u.test(baseline));
const temporary = mkdtempSync(join(scratch, "app-pipeline-failure-"));
try {
  const original = execFileSync("git", ["show", `${baseline}:scripts/build-app.mjs`], {
    cwd: root,
    encoding: "utf8",
  });
  const importsEnd = original.indexOf("const args = process.argv.slice(2);");
  const stepAt = original.indexOf("/** a node step that must pass");
  const prepareAt = original.indexOf("// before the bundle (was vite/genShards.ts)");
  const viteAt = original.indexOf("const vite = resolve(import.meta.dirname,");
  assert.ok(importsEnd > 0 && stepAt > importsEnd && prepareAt > stepAt && viteAt > prepareAt);
  const base = pathToFileURL(join(root, "scripts/")).href;
  const oldModule = `${original.slice(0, importsEnd).replaceAll("from './", `from '${base}`)}import {assertHeavyLease} from ${JSON.stringify(`${base}heavy-lane-lease.mjs`)};\n${original.slice(stepAt, prepareAt)}export function prepareAppBuild(){assertHeavyLease('build');\n${original.slice(prepareAt, viteAt)}\n}\n`;
  const oldFile = join(temporary, "old.mjs");
  writeFileSync(oldFile, oldModule, { flag: "wx" });
  const current = pathToFileURL(join(root, "scripts/app-build-pipeline.mjs")).href;
  /** @type {{name:string,status:number|null,cleanup:boolean}[]} */ const results = [];
  /** @type {{name:string,module:string,expected:number,cleanup:boolean}[]} */
  const cases = [
    { name: "original-api", module: pathToFileURL(oldFile).href, expected: 7, cleanup: false },
    { name: "current-api", module: current, expected: 0, cleanup: true },
    { name: "current-cli", module: "", expected: 7, cleanup: false },
  ];
  for (const { name, module, expected, cleanup } of cases) {
    const directory = join(temporary, name);
    mkdirSync(join(directory, "scripts"), { recursive: true });
    writeFileSync(join(directory, "scripts/bake-loader.mjs"), "process.exit(7);\n", { flag: "wx" });
    const runner = join(directory, "run.mjs");
    if (module !== "")
      writeFileSync(
        runner,
        `import{prepareAppBuild}from${JSON.stringify(module)};import{writeFileSync}from'node:fs';import assert from'node:assert/strict';try{prepareAppBuild();assert.fail('Expected actual child exit7');}catch(error){assert.equal(error.exitCode,7);}finally{writeFileSync('cleaned','yes',{flag:'wx'});}\n`,
        { flag: "wx" },
      );
    const remaining = Math.floor(9400 - (performance.now() - started));
    assert.ok(remaining > 0);
    const result = spawnSync(
      process.execPath,
      [module === "" ? join(root, "scripts/build-app.mjs") : runner],
      { cwd: directory, encoding: "utf8", timeout: Math.min(3000, remaining) },
    );
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, expected, result.stderr);
    const cleaned = existsSync(join(directory, "cleaned"));
    assert.equal(cleaned, cleanup);
    if (cleaned) assert.equal(readFileSync(join(directory, "cleaned"), "utf8"), "yes");
    results.push({ name, status: result.status, cleanup: cleaned });
  }
  console.log(JSON.stringify({ results, actualChildExit: 7, normalBuildAdmission: true }));
} finally {
  rmSync(temporary, { recursive: true });
}
const ms = performance.now() - started;
assert.ok(ms < 9500);
console.log(JSON.stringify({ pass: true, ms, baseline }));
