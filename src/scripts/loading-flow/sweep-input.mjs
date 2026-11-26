// Resuming a sweep must never relabel earlier readings with a different target.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as v from "valibot";

const inputSchema = v.object({
  url: v.string(),
  build: v.pipe(v.string(), v.regex(/^[a-f0-9]{7,40}-[a-zA-Z0-9._-]+$/u)),
  workerRow: v.union([v.literal(0), v.literal(1)]),
});
/** @param {string} out @param {string} url @param {string} build @param {number} workerRow */
export function recordSweepInput(out, url, build, workerRow) {
  const parsed = v.safeParse(inputSchema, { url, build, workerRow });
  if (!parsed.success) throw new Error("Invalid sweep target identity");
  const address = new URL(url);
  if (
    !["https:", "http:"].includes(address.protocol) ||
    address.username ||
    address.password ||
    address.search ||
    address.hash
  )
    throw new Error("Invalid sweep target URL");
  // Compare the exact URL Bash uses, including its path spelling. Canonical
  // URL spelling could equate distinct paths or refuse an unchanged old label.
  const expected = parsed.output,
    directory = resolve(out),
    file = join(directory, "sweep.json");
  if (
    existsSync(directory) &&
    (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
  )
    throw new Error("Refuse linked sweep output");
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
      throw new Error("Refuse nonregular sweep identity");
    const previous = v.safeParse(inputSchema, JSON.parse(readFileSync(file, "utf8")));
    if (
      !previous.success ||
      previous.output.url !== expected.url ||
      previous.output.build !== expected.build ||
      previous.output.workerRow !== expected.workerRow
    )
      throw new Error("Refuse a different target over existing sweep readings");
    return;
  }
  if (existsSync(directory) && readdirSync(directory).length > 0)
    throw new Error("Refuse existing sweep output without target identity");
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, `${JSON.stringify(expected)}\n`, { flag: "wx" });
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [out, url, build, worker] = process.argv.slice(2);
    if (out === undefined || url === undefined || build === undefined || worker === undefined)
      throw new Error("Missing sweep target");
    recordSweepInput(out, url, build, Number(worker));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Sweep identity refused");
    process.exitCode = 2;
  }
}
