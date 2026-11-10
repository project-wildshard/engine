// Outside-hook actual promoted-artifact/Git binding, not a game reading.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import { sweepMapBinding, readSweepSource } from "./source-maps.mjs";

const { values } = parseArgs({
  options: {
    dist: { type: "string" },
    build: { type: "string" },
    source: { type: "string" },
    shell: { type: "string" },
    equivalent: { type: "string" },
    scratch: { type: "string" },
  },
});
const { dist, build, source, shell, equivalent, scratch } = values;
assert.ok(
  dist !== undefined &&
    build !== undefined &&
    source !== undefined &&
    shell !== undefined &&
    equivalent !== undefined &&
    scratch !== undefined,
  "Supply an actual artifact and its source identities",
);
const file = "src/client/game/grid/session.ts",
  started = performance.now();
assert.throws(() => readSweepSource(shell, file), "the shell revision is not the engine source");
assert.equal(sweepMapBinding(dist, build, source, [file]), null);
assert.notEqual(sweepMapBinding(dist, `${build}-different`, source, [file]), null);
assert.equal(
  sweepMapBinding(dist, build, equivalent, [file]),
  null,
  "an unchanged older file is not a negative control",
);
const index = v.parse(
  v.record(v.string(), v.object({ moduleIds: v.array(v.string()) })),
  JSON.parse(readFileSync(join(dist, ".vite/chunk-modules.json"), "utf8")),
);
const chunk = Object.entries(index).find(([, row]) => row.moduleIds.includes(file))?.[0];
assert.ok(chunk !== undefined);
assert.match(chunk, /^b\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\.js$/u);
mkdirSync(scratch, { recursive: true });
const out = mkdtempSync(join(scratch, "sweep-map-proof-"));
try {
  mkdirSync(join(out, ".vite"), { recursive: true });
  writeFileSync(join(out, "version.json"), JSON.stringify({ build }));
  writeFileSync(
    join(out, ".vite/chunk-modules.json"),
    JSON.stringify({ [chunk]: { moduleIds: [file] } }),
  );
  const path = join(out, `${chunk}.map`);
  mkdirSync(join(out, chunk.split("/").slice(0, -1).join("/")), { recursive: true });
  const map = v.parse(
    v.object({ sources: v.array(v.string()), sourcesContent: v.array(v.nullable(v.string())) }),
    JSON.parse(readFileSync(join(dist, `${chunk}.map`), "utf8")),
  );
  const at = map.sources.findIndex((name) => name.endsWith(file));
  assert.ok(at !== -1);
  const original = map.sourcesContent[at];
  assert.ok(typeof original === "string");
  map.sourcesContent[at] = `${original}\n// owned integrity-negative control\n`;
  writeFileSync(path, JSON.stringify(map));
  assert.notEqual(sweepMapBinding(out, build, source, [file]), null);
  map.sourcesContent[at] = original;
  writeFileSync(path, JSON.stringify(map));
  assert.equal(sweepMapBinding(out, build, source, [file]), null);
  writeFileSync(join(out, ".vite/chunk-modules.json"), "{}");
  assert.notEqual(sweepMapBinding(out, build, source, [file]), null);
  assert.ok(performance.now() - started < 10000);
  console.log(
    JSON.stringify({
      cases: 7,
      ms: Math.round(performance.now() - started),
      build,
      source,
      realArtifact: true,
      noGameReading: true,
    }),
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
