// Outside-hook real HTTP, shell and filesystem control; no game event or reading.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { resolve as resolvePath, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolvePath(import.meta.dirname, "../.."),
  script = fileURLToPath(new URL("sweep.sh", import.meta.url));
const baseline = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice(11);
if (baseline !== undefined) assert.match(baseline, /^[a-f0-9]{40}$/u);
const source =
  baseline === undefined
    ? null
    : execFileSync("git", ["show", `${baseline}:scripts/loading-flow/sweep.sh`], {
        cwd: root,
        encoding: "utf8",
      });
const scratch =
  process.argv.find((arg) => arg.startsWith("--scratch="))?.slice(10) ?? join(root, "tmp");
mkdirSync(scratch, { recursive: true });
const out = mkdtempSync(join(scratch, "sweep-input-proof-")),
  started = performance.now();
let build = "aaaaaaa-one";
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ build, saveEpoch: 1 }));
});
/** @type {Promise<void>} */
const listening = new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve());
});
await listening;
try {
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  /** @param {string} url @param {boolean} [worker] @param {string} [directory] @returns {Promise<{code:number|null,signal:NodeJS.Signals|null,output:string}>} */
  const run = (url, worker = false, directory = out) =>
    new Promise((resolve, reject) => {
      const args = [url, "--only", "none", "--out", directory, ...(worker ? ["--worker-row"] : [])];
      const child = spawn(
        "bash",
        source === null ? [script, ...args] : ["-c", source, script, ...args],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: 2500 },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal, output }));
    });
  const first = await run(origin);
  assert.equal(first.signal, null);
  assert.equal(first.code, 1, "a fixture with no game reading cannot pass");
  const manifest = readFileSync(join(out, "sweep.json"), "utf8"),
    report = readFileSync(join(out, "report.json"), "utf8");
  const states = [...report.matchAll(/"state": "([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(states.length > 0);
  assert.deepEqual(new Set(states), new Set(["NOT READ"]));
  const opaque = "opaque earlier reading; no game result fabricated\n";
  writeFileSync(join(out, "existing-reading.log"), opaque);
  const preserved = () => {
    assert.equal(readFileSync(join(out, "sweep.json"), "utf8"), manifest);
    assert.equal(readFileSync(join(out, "report.json"), "utf8"), report);
    assert.equal(readFileSync(join(out, "existing-reading.log"), "utf8"), opaque);
  };
  build = "aaaaaaa-next";
  const changed = await run(origin);
  assert.equal(changed.signal, null);
  assert.equal(changed.code, 2, changed.output);
  preserved();
  build = "aaaaaaa-one";
  for (const [url, worker] of [
    [`${origin}/another`, false],
    [`${origin}//`, false],
    [origin, true],
  ]) {
    const refused = await run(String(url), Boolean(worker));
    assert.equal(refused.signal, null);
    assert.equal(refused.code, 2, refused.output);
    preserved();
  }
  const same = await run(origin);
  assert.equal(same.signal, null);
  assert.equal(same.code, 1, "same-target partial sweep remains NOT READ");
  preserved();
  const legacy = join(out, "legacy"),
    legacyUrl = origin.replace("http:", "HTTP:");
  mkdirSync(legacy);
  const legacyManifest = `${JSON.stringify({ url: legacyUrl, build, workerRow: 0 })}\n`;
  writeFileSync(join(legacy, "sweep.json"), legacyManifest);
  const legacyResume = await run(legacyUrl, false, legacy);
  assert.equal(legacyResume.signal, null);
  assert.equal(legacyResume.code, 1, legacyResume.output);
  assert.equal(readFileSync(join(legacy, "sweep.json"), "utf8"), legacyManifest);
  assert.doesNotMatch(
    readFileSync(join(legacy, "report.json"), "utf8"),
    /"state": "(?:PASS|FAIL)"/u,
  );
  const orphan = join(out, "unlabelled");
  mkdirSync(orphan);
  writeFileSync(join(orphan, "previous.log"), "unlabelled prior reading\n");
  const refused = await run(origin, false, orphan);
  assert.equal(refused.signal, null);
  assert.equal(refused.code, 2, refused.output);
  assert.equal(readFileSync(join(orphan, "previous.log"), "utf8"), "unlabelled prior reading\n");
  assert.ok(performance.now() - started < 10000);
  console.log(
    JSON.stringify({
      cases: 8,
      ms: Math.round(performance.now() - started),
      realCli: true,
      noGameEvents: true,
      baseline: baseline ?? null,
    }),
  );
} finally {
  server.close();
  server.closeAllConnections();
  rmSync(out, { recursive: true, force: true });
}
