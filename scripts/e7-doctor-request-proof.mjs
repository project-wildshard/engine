// Outside hooks: the actual public Doctor against signed loopback HTTP data.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";
import { execFileSync } from "node:child_process";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { KEYCHAIN_ARGS } from "./chromium-keychain.mjs";

const started = performance.now();
const watchdog = setTimeout(() => {
  console.error("Doctor HTTP proof exceeded 9.5 s");
  process.kill(process.pid, "SIGTERM");
}, 9500);
watchdog.unref();
const baseline = process.argv.find((value) => value.startsWith("--baseline="))?.slice(11);
if (baseline !== undefined) assert.match(baseline, /^[a-f0-9]{40}$/u);
const scratch = process.argv.find((value) => value.startsWith("--scratch="))?.slice(10);
assert.ok(scratch !== undefined);
mkdirSync(scratch, { recursive: true });
const temporary = mkdtempSync(join(scratch, "doctor-request-"));
const root = resolvePath(import.meta.dirname, ".."),
  doctor = join(root, "src/client/host/online/doctor.ts");
const build = "a".repeat(40),
  pair = generateKeyPairSync("ed25519");
const key = pair.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const body = JSON.stringify({
  channel: "staging",
  serial: 1,
  engineBuild: build,
  saveEpoch: 1,
  shards: [{ slug: "fixture", revision: 1 }],
});
const release = JSON.stringify({
  body,
  signature: sign(null, Buffer.from(body), pair.privateKey).toString("hex"),
});
/** @type {string[]} */ const methods = [];
let bundle = "",
  address = "";
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", address || "http://127.0.0.1").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/part") {
    methods.push(request.method ?? "");
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": "100000",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.flushHeaders();
    response.write(Buffer.alloc(32768));
    const timer = setInterval(() => {
      response.write(Buffer.alloc(1));
    }, 25);
    response.on("close", () => clearInterval(timer));
    return;
  }
  const content =
    path === "/entry.js"
      ? bundle
      : path === "/version.json"
        ? JSON.stringify({ build, saveEpoch: 1 })
        : path === "/release.json"
          ? release
          : path === `/assets/spawn/server-${build}.json`
            ? JSON.stringify({ shards: { fixture: { url: "/part" } } })
            : path === "/"
              ? '<meta charset="utf-8"><script type="module" src="/entry.js"></script>'
              : null;
  response.writeHead(content === null ? 404 : 200, {
    "Content-Type":
      path === "/entry.js" ? "text/javascript" : path === "/" ? "text/html" : "application/json",
  });
  response.end(content ?? "missing");
});
/** @type {import('playwright').Browser|undefined} */ let browser;
try {
  /** @type {Promise<void>} */ const listening = new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  await listening;
  const port = server.address();
  assert.ok(port !== null && typeof port !== "string");
  address = `http://127.0.0.1:${port.port}`;
  const entry = join(temporary, "entry.ts");
  writeFileSync(
    entry,
    `import {runDoctor} from ${JSON.stringify(doctor)};import {Scope} from ${JSON.stringify(join(root, "src/shared/engine/app/scope.ts"))};const owner=new Scope('native doctor HTTP');runDoctor(${JSON.stringify({ build, origin: address, world: { release: `${address}/release.json`, key } })},owner,()=>{}).then(rows=>{Reflect.set(globalThis,'doctorRows',rows);owner.dispose();});`,
  );
  let overrides = 0;
  const builder = await rolldown({
    input: entry,
    platform: "browser",
    transform: { target: "es2022", define: { "import.meta.env.DEV": "false" } },
    plugins:
      baseline === undefined
        ? []
        : [
            {
              name: "actual-old-doctor",
              load(id) {
                if (id !== doctor) return null;
                overrides++;
                return execFileSync(
                  "git",
                  ["show", `${baseline}:src/client/host/online/doctor.ts`],
                  { cwd: root, encoding: "utf8" },
                );
              },
            },
          ],
  });
  try {
    const output = await builder.generate({ format: "esm" });
    const chunk = output.output.find((row) => row.type === "chunk");
    assert.ok(chunk !== undefined);
    bundle = chunk.code;
  } finally {
    await builder.close();
  }
  assert.equal(overrides, baseline === undefined ? 0 : 1);
  browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, "--mute-audio"] });
  const page = await browser.newPage();
  /** @type {string[]} */ const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) =>
    failures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`),
  );
  const part = page.waitForResponse((response) => response.url() === `${address}/part`);
  await page.goto(address, { waitUntil: "load", timeout: 4000 });
  const response = await part;
  await page.waitForFunction(
    () => Array.isArray(Reflect.get(globalThis, "doctorRows")),
    {},
    { timeout: 4000 },
  );
  const packRow = await page.evaluate(() => {
    const rows = Reflect.get(globalThis, "doctorRows");
    if (!Array.isArray(rows)) throw new Error("No Doctor rows");
    return rows.find(
      (row) => typeof row === "object" && row !== null && Reflect.get(row, "id") === "packs",
    );
  });
  assert.equal(packRow?.state, "pass");
  console.log(JSON.stringify({ methods, failures, baseline: baseline ?? null, row: packRow }));
  assert.deepEqual(methods, ["HEAD"]);
  const finished = await response.finished();
  assert.equal(finished, null, "a passing headers probe must complete its native request");
  assert.deepEqual(failures, []);
  await browser.close();
  browser = undefined;
} finally {
  await browser?.close();
  if (server.listening) {
    server.closeAllConnections();
    /** @type {Promise<void>} */ const closed = new Promise((resolve) => {
      server.close(() => resolve());
    });
    await closed;
  }
  rmSync(temporary, { recursive: true, force: true });
  clearTimeout(watchdog);
}
assert.ok(performance.now() - started < 9500);
console.log(
  JSON.stringify({
    pass: true,
    ms: Math.round(performance.now() - started),
    realDoctor: true,
    realSignedHttp: true,
    liveSockets: 0,
  }),
);
