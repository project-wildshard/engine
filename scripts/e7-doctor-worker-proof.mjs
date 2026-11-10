// Outside hooks: the real installed worker must leave the Doctor to its host.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve as resolvePath } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { KEYCHAIN_ARGS } from "./chromium-keychain.mjs";

const baseline = process.argv.find((value) => value.startsWith("--baseline="))?.slice(11);
if (baseline !== undefined) assert.match(baseline, /^[a-f0-9]{40}$/u);
const root = resolvePath(import.meta.dirname, ".."),
  file = resolvePath(root, "src/client/engine/pwa/sw.js"),
  started = performance.now();
const watchdog = setTimeout(() => {
  console.error("Doctor worker proof exceeded 9.5 s");
  process.kill(process.pid, "SIGTERM");
}, 9500);
watchdog.unref();
const unclassified = process.argv.includes("--unclassified-doctor");
assert.ok(baseline === undefined || !unclassified);
let overrides = 0;
const builder = await rolldown({
  input: file,
  platform: "browser",
  transform: { target: "es2022" },
  plugins:
    baseline === undefined && !unclassified
      ? []
      : [
          {
            name: "old-actual-worker",
            load(id) {
              if (id !== file) return null;
              overrides++;
              const code =
                baseline === undefined
                  ? readFileSync(file, "utf8")
                  : execFileSync("git", ["show", `${baseline}:src/client/engine/pwa/sw.js`], {
                      cwd: root,
                      encoding: "utf8",
                    });
              if (!unclassified) return code;
              const faulty = code.replace(
                "|| client?.type === 'window' && isDoctorDocument(new URL(client.url))",
                "",
              );
              assert.notEqual(
                faulty,
                code,
                "the control must restore the old worker-only classification",
              );
              return faulty;
            },
          },
        ],
});
let source;
try {
  const output = (await builder.generate({ format: "iife" })).output.find(
    (row) => row.type === "chunk",
  );
  assert.ok(output !== undefined);
  source = output.code;
} finally {
  await builder.close();
}
assert.equal(overrides, baseline === undefined && !unclassified ? 0 : 1);
// These are declarative fixture build inputs; the worker logic is unchanged.
const worker = source
  .replaceAll("__BUILD_ID__", "native-doctor-route")
  .replaceAll("__ASSET_CACHE__", "native-doctor-assets")
  .replace(/['"]__FILES__['"]/u, () => JSON.stringify(JSON.stringify(["/held-chunk.js"])))
  .replace(/['"]__SHELL_FILES__['"]/u, () => JSON.stringify("[]"))
  .replace(/['"]__DOCUMENT__['"]/u, () =>
    JSON.stringify("<!doctype html><title>cached game fixture</title>"),
  );
/** @type {string[]} */ const network = [];
/** @type {import('node:http').ServerResponse|undefined} */ let held;
let cancelled = 0;
/** @type {() => void} */ let heldStarted = () => undefined;
/** @type {Promise<void>} */ const heldReady = new Promise((resolve) => {
  heldStarted = resolve;
});
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  network.push(url.pathname + url.search);
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/held-chunk.js") {
    held = response;
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.flushHeaders();
    response.on("close", () => {
      if (!response.writableEnded) cancelled++;
    });
    heldStarted();
    return;
  }
  if (url.pathname === "/doctor/module.js") {
    response
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(
        "fetch('/version.json').then(r=>r.text()).then(()=>fetch('/version.json?second')).then(r=>r.text()).then(()=>{Reflect.set(globalThis,'doctorMetadataRead',true);});",
      );
    return;
  }
  if ((url.pathname === "/" || url.pathname === "/index.html") && url.searchParams.has("doctor")) {
    const target = new URL("/doctor/", url);
    target.search = url.search;
    target.searchParams.set("sw", "0");
    response.writeHead(307, { Location: target.pathname + target.search }).end();
    return;
  }
  if (url.pathname === "/sw.js") {
    response
      .writeHead(200, { "Content-Type": "text/javascript", "Service-Worker-Allowed": "/" })
      .end(worker);
    return;
  }
  response
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      `<!doctype html><title>${url.pathname === "/doctor/" ? "Doctor fixture" : "network fixture"}</title>${url.pathname === "/doctor/" ? '<script src="/doctor/module.js"></script>' : ""}`,
    );
});
/** @type {import('playwright').Browser|undefined} */ let browser;
try {
  /** @type {Promise<void>} */ const listening = new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  await listening;
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, "--mute-audio"] });
  const page = await browser.newPage();
  /** @type {string[]} */ const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) =>
    failures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`),
  );
  await page.goto(`${origin}/seed`, { waitUntil: "load", timeout: 3000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  // The production worker deliberately does not claim an already-open page.
  await page.reload({ waitUntil: "load", timeout: 3000 });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    {},
    { timeout: 3000 },
  );
  await page.goto(`${origin}/ordinary`, { waitUntil: "load", timeout: 3000 });
  assert.equal(
    await page.title(),
    "cached game fixture",
    "ordinary app navigation still uses its shell",
  );
  // The public cache-adoption protocol, not a simulated game event.
  await page.evaluate(() => {
    const controller = navigator.serviceWorker.controller;
    if (controller === null) throw new Error("No controller");
    controller.postMessage({ type: "PRECACHE" }, []);
  });
  await heldReady;
  await page.goto(`${origin}/?doctor&chunk=fixture&from=link`, {
    waitUntil: "load",
    timeout: 3000,
  });
  assert.equal(new URL(page.url()).pathname, "/doctor/");
  assert.equal(await page.title(), "Doctor fixture");
  assert.equal(new URL(page.url()).searchParams.get("chunk"), "fixture");
  assert.equal(new URL(page.url()).searchParams.get("from"), "link");
  assert.ok(network.includes("/?doctor&chunk=fixture&from=link"));
  await page.waitForFunction(
    () => Reflect.get(globalThis, "doctorMetadataRead") === true,
    {},
    { timeout: 3000 },
  );
  console.log(JSON.stringify({ cancelled, unclassified, network }));
  assert.equal(cancelled, 0, "Doctor subrequests cannot abort the active precache");
  assert.ok(held !== undefined);
  held.end("/*held*/");
  await page.waitForFunction(
    async () => {
      const cache = await caches.open("native-doctor-assets");
      const row = await cache.match("/held-chunk.js");
      return row !== undefined && (await row.text()) === "/*held*/";
    },
    {},
    { timeout: 3000 },
  );
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
  clearTimeout(watchdog);
}
assert.ok(performance.now() - started < 9500);
console.log(
  JSON.stringify({
    pass: true,
    ms: Math.round(performance.now() - started),
    network,
    baseline: baseline ?? null,
    unclassified,
    actualWorker: true,
    liveSockets: 0,
  }),
);
