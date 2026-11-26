// oxlint-disable-next-line import/no-unassigned-import -- Production entries install simulation Math before loading any engine module.
import "../../shared/engine/core/portableMathFirst";
// Ring 2 EG26: real WebKit worker vs Node; no rendering, cook, external network or baseline update.
import type { ServerPack } from "../../shared/game/shardfile/serverPack";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { build } from "vite";
import { webkit, chromium, type Browser } from "../browser-playwright.mjs";
import { rapierAlias } from "../../../vite/rapier.ts";
import { KEYCHAIN_ARGS } from "../.kit/chromium-keychain.mjs";
import { homedir } from "node:os";
import { readTar } from "@wildshard/format/tar";
import * as v from "valibot";
import { loadHeadlessFolder } from "../../server/host/headlessFolder.ts";
import { serverReadsFile } from "@wildshard/format/serverReads";
import { outputDescriptor } from "../../shared/game/shardfile/outputDescriptor.ts";
import { playTape, type TapeRequest, type TapeWitness } from "./runtime.ts";

const option = (name: string, fallback: string): string =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = resolvePath(option("out", "tmp/worker-determinism"));
assert.ok(
  out.startsWith(resolvePath("tmp") + sep),
  "Report output must stay under this repo's tmp/",
);
const engine = option("engine", "webkit");
assert.ok(["webkit", "chromium"].includes(engine));
const sha = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const buildId = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const dirty = dirtyPaths.length > 0;
assert.equal(process.env.WILDSHARD_RING, "1", "Use the installed Ring 1 pin graph");
const ring = v.parse(
  v.object({ "1": v.object({ products: v.array(v.string()), slices: v.array(v.string()) }) }),
  JSON.parse(readFileSync("test/pins/rings.json", "utf8")),
)["1"];
const allSlugs = [...ring.products, ...ring.slices];
const slugs = option("shards", allSlugs.join(",")).split(",");
assert.equal(new Set(slugs).size, slugs.length, "Duplicate parity shard");
assert.ok(
  slugs.every((slug) => /^[a-z0-9_-]+$/u.test(slug) && allSlugs.includes(slug)),
  "Parity shards must belong to Ring 1",
);
const pinRows = v.parse(
  v.object({ shards: v.array(v.object({ slug: v.string(), hash: v.string() })) }),
  JSON.parse(readFileSync("test/pins/shardfiles.json", "utf8")),
).shards;
const sliceRows = v.parse(
  v.object({ slices: v.array(v.object({ slug: v.string(), from: v.string(), hash: v.string() })) }),
  JSON.parse(readFileSync("test/pins/slices.json", "utf8")),
).slices;
const cache = process.env.WILDSHARD_PIN_CACHE ?? join(homedir(), ".cache/wildshard/pins");
const tape = Array.from({ length: 48 }, (_, tick) => ({
  seq: tick + 1,
  viewTick: tick,
  steer: { keyX: 0, keyY: 0, stickX: tick < 24 ? 0.2 : -0.2, stickY: 1 },
  yaw: 0,
  pitch: 0,
  buttons: tick === 3 ? 1 : 0,
}));
const require = createRequire(import.meta.url);
const files = new Map<string, Uint8Array>([
  ["/rapier.wasm", readFileSync(require.resolve("@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm"))],
]);
const shards: Record<string, ServerPack> = {};
const inputs: Record<string, { header: string; transport: string; bytes: number; pin: string }> =
  {};
mkdirSync(out, { recursive: true });
const scratch = join(out, "bundle");
let browser: Browser | undefined;
let server: Server | undefined;
interface Result {
  slug: string;
  ms: number;
  node: TapeWitness;
  worker: TapeWitness;
  same: boolean;
  workerAgent: string;
}
interface Report {
  source: string;
  dirty: boolean;
  dirtyPaths: string[];
  engine: string;
  tape: string;
  inputs: typeof inputs;
  results: Result[];
  negativeControl: {
    slug: string;
    detected: boolean;
    firstDifferentTick: number;
    changed: TapeWitness;
  } | null;
  ok: boolean;
  workerBundle?: string;
  browserVersion?: string;
  nodeVersion: string;
  completeRing: boolean;
  error?: string;
}
const report: Report = {
  source: buildId,
  nodeVersion: process.version,
  completeRing: slugs.length === allSlugs.length,
  dirty,
  dirtyPaths,
  engine,
  tape: sha(JSON.stringify(tape)),
  inputs,
  results: [],
  negativeControl: null,
  ok: false,
};
try {
  assert.equal(dirty, false, "Parity requires committed source and ordinary generated tables");
  // Transport the pin's exact admitted files in a server book. This does not cook/re-encode a product:
  // book offsets only frame immutable bytes; readServerFolder performs ordinary admission on both sides.
  for (const slug of slugs) {
    const name = slug;
    const slice = `out/.slices/${name}`;
    const directory = ring.slices.includes(slug) ? slice : join("out", name);
    assert.ok(
      existsSync(join(directory, "shard.json")),
      "Install the selected Ring 1 inputs first",
    );
    const header = readFileSync(join(directory, "shard.json"));
    const pin = pinRows.find((row) => row.slug === slug);
    assert.ok(pin, `Not pinned: ${slug}`);
    const sliced = sliceRows.find((row) => row.slug === slug);
    if (ring.slices.includes(slug))
      assert.equal(sliced?.from, pin.hash, "Slice does not match the selected head");
    const pinHash = ring.slices.includes(slug) ? sliced?.hash : pin.hash;
    assert.ok(pinHash, "Missing pinned archive identity");
    const archive = readFileSync(join(cache, `${pinHash}.tar`));
    assert.equal(sha(archive), pinHash, "Pinned archive hash differs");
    const pinnedHeader = readTar(archive).get("shard.json");
    assert.ok(pinnedHeader, "Pinned archive has no output index");
    assert.equal(
      sha(header),
      sha(pinnedHeader),
      "Installed output header differs from its immutable pin",
    );
    const product = await loadHeadlessFolder(directory);
    const index = outputDescriptor(product.shardfile)?.index;
    if (index === undefined) {
      throw new Error("Missing verified product index");
    }
    const paths = [
      ...new Set([
        "shard.json",
        ...index.sections.map((row) => row.path),
        ...index.files
          .filter((file) => serverReadsFile(file, product.shardfile.terrain?.collider))
          .map((row) => row.path),
        ...(index.admission.server ?? []).map((row) => row.path),
      ]),
    ];
    let offset = 0;
    const rows: [string, number, number][] = [],
      bodies: Uint8Array[] = [];
    for (const path of paths) {
      const body = readFileSync(join(directory, path));
      rows.push([path, offset, body.length]);
      bodies.push(body);
      offset += body.length;
    }
    const body = Buffer.concat(bodies),
      hash = sha(body),
      url = `/assets/spawn/server/${hash.slice(0, 16)}.pack.br`;
    files.set(url, body);
    shards[slug] = { url, bytes: body.length, wireBytes: body.length, hash, files: rows };
    inputs[slug] = { header: sha(header), transport: hash, bytes: body.length, pin: pinHash };
  }
  files.set(
    `/assets/spawn/server-${buildId}.json`,
    Buffer.from(JSON.stringify({ book: "server", build: buildId, shards })),
  );
  await build({
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: rapierAlias },
    build: {
      outDir: scratch,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: resolvePath("src/scripts/determinism/worker.ts"),
        formats: ["es"],
        fileName: () => "worker.js",
      },
    },
  });
  for (const entry of readdirSync(scratch, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      assert.ok(entry.name.endsWith(".js"), "Worker build emitted a non-code file");
      const file = join(entry.parentPath, entry.name);
      files.set(`/${relative(scratch, file)}`, readFileSync(file));
    }
  }
  const workerBytes = files.get("/worker.js");
  if (workerBytes === undefined) {
    throw new Error("Missing worker bundle");
  }
  report.workerBundle = sha(workerBytes);
  files.set("/", Buffer.from("<!doctype html><title>Non-rendering worker determinism</title>"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const body = files.get(path);
    response.writeHead(body === undefined ? 404 : 200, {
      "Content-Type":
        path === "/"
          ? "text/html"
          : path.endsWith(".js")
            ? "application/javascript"
            : "application/octet-stream",
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("No server address");
  }
  const base = `http://127.0.0.1:${address.port}`;
  browser =
    engine === "webkit"
      ? await webkit.launch({ headless: true, timeout: 30_000 })
      : await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS] });
  report.browserVersion = browser.version();
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(message.text());
    }
  });
  page.on("pageerror", (error) => {
    console.error(error.stack);
  });
  await page.goto(base);
  const inWorker = (request: TapeRequest): Promise<{ witness: TapeWitness; agent: string }> =>
    page.evaluate(async (input: TapeRequest): Promise<{ witness: TapeWitness; agent: string }> => {
      const worker = new Worker("/worker.js", { type: "module" });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<{ witness: TapeWitness; agent: string }>((resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error("Worker tape exceeded 60 s"));
          }, 60_000);
          worker.onerror = (event) => {
            clearTimeout(timeout);
            reject(new Error(`${event.message} ${event.filename}:${event.lineno}`));
          };
          worker.onmessage = (
            event: MessageEvent<{ error?: string; witness: TapeWitness; agent: string }>,
          ) => {
            clearTimeout(timeout);
            if (event.data.error === undefined) {
              resolve({ witness: event.data.witness, agent: event.data.agent });
            } else {
              reject(new Error(event.data.error));
            }
          };
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A dedicated worker can only receive messages from its creating page.
          worker.postMessage(input);
        });
      } finally {
        clearTimeout(timeout);
        worker.terminate();
      }
    }, request);
  for (const slug of slugs) {
    const request = { base: `${base}/shardfiles/${slug}/`, build: buildId, tape };
    const started = performance.now();
    const node = await playTape(request),
      answer = await inWorker(request);
    const worker = answer.witness;
    assert.ok(
      Math.hypot(node.end[0] - node.start[0], node.end[2] - node.start[2]) > 0.05,
      `${slug}: tape did not move`,
    );
    report.results.push({
      slug,
      ms: Math.round(performance.now() - started),
      node,
      worker,
      workerAgent: answer.agent,
      same: JSON.stringify(node) === JSON.stringify(worker),
    });
    console.log(
      `${slug}: ${report.results.at(-1)?.same === true ? "SAME" : "DIFFERS"} (Node, ${engine} worker, ${tape.length} ticks)`,
    );
    assert.deepEqual(worker, node, `${slug}: durable play differs between engines`);
    if (report.negativeControl === null) {
      const changedTape = structuredClone(tape);
      for (const command of changedTape) command.steer.stickY = -1;
      const changed = (
        await inWorker({
          ...request,
          tape: changedTape,
        })
      ).witness;
      assert.throws(
        () => {
          assert.deepEqual(changed, node);
        },
        assert.AssertionError,
        "Different real inputs were not detected by the same comparator",
      );
      const firstDifferentTick = changed.hashes.findIndex(
        (hash, tick) => hash !== node.hashes[tick],
      );
      assert.ok(firstDifferentTick !== -1, "Reversed tape changed no durable save hash");
      report.negativeControl = {
        slug,
        detected: true,
        firstDifferentTick: firstDifferentTick + 1,
        changed,
      };
    }
  }
  report.ok = report.completeRing;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      if (server?.listening === true) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        });
      }
    } finally {
      try {
        writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  }
}
