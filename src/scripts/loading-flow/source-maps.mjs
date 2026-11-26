// A shell build stamp and its pinned engine source are distinct identities.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as v from "valibot";

const mapSchema = v.object({
  sources: v.array(v.string()),
  sourcesContent: v.array(v.nullable(v.string())),
});
const indexSchema = v.record(v.string(), v.object({ moduleIds: v.array(v.string()) }));
/** @param {string} revision @param {string} file @returns {string} */
export function readSweepSource(revision, file) {
  if (
    !/^[a-f0-9]{7,40}$/u.test(revision) ||
    !/^src\/[a-zA-Z0-9_/-]+\.ts$/u.test(file) ||
    file.includes("..")
  )
    throw new Error("Invalid sweep source identity");
  return execFileSync("git", ["show", `${revision}:${file}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
/** Exact document build plus exact engine source content, not a rebuild or prefix.
 * @param {string|undefined} dist @param {string} build @param {string} revision @param {readonly string[]} files @returns {string|null} */
export function sweepMapBinding(dist, build, revision, files) {
  if (dist === undefined) return "no --dist";
  const stamp = resolve(dist, "version.json");
  const version = v.parse(v.object({ build: v.string() }), JSON.parse(readFileSync(stamp, "utf8")));
  if (version.build !== build) return `--dist serves ${version.build}, not ${build}`;
  const indexFile = resolve(dist, ".vite/chunk-modules.json");
  /** @type {string[]} */
  let maps;
  if (existsSync(indexFile)) {
    const chunks = v.parse(indexSchema, JSON.parse(readFileSync(indexFile, "utf8")));
    maps = Object.entries(chunks)
      .filter(([, row]) =>
        row.moduleIds.some((module) => files.some((file) => module.endsWith(file))),
      )
      .map(([chunk]) => {
        if (
          !/^(?:b\/[a-zA-Z0-9._-]+|assets)\/[a-zA-Z0-9._-]+\.js$/u.test(chunk) ||
          chunk.split("/").includes("..")
        )
          throw new Error("Invalid sweep chunk identity");
        return resolve(dist, `${chunk}.map`);
      });
  } else {
    const code = resolve(dist, "b", build),
      assets = existsSync(code) ? code : resolve(dist, "assets");
    maps = readdirSync(assets)
      .filter((name) => name.endsWith(".js.map"))
      .map((name) => resolve(assets, name));
  }
  for (const file of new Set(files)) {
    const want = readSweepSource(revision, file);
    let carried = 0;
    for (const name of maps) {
      const text = readFileSync(name, "utf8");
      if (!text.includes(file)) continue;
      const map = v.parse(mapSchema, JSON.parse(text));
      for (const [index, source] of map.sources.entries()) {
        if (!source.endsWith(file)) continue;
        if (map.sourcesContent[index] !== want)
          return `${name} maps a ${file} that is not ${revision}'s`;
        carried++;
      }
    }
    if (carried === 0) return `no map in --dist carries ${file}`;
  }
  return null;
}
