// Shared byte comparisons for the E357 bakers. Checks never mutate the output tree.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertJsonRows, jsonOutputGuard } from './json-output-guard.mjs';

export const outputHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = (value, indent = 2) => { assertJsonRows(value); return Buffer.from(`${JSON.stringify(value, null, indent)}\n`); };
export function toolVersion(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; }
  catch { return null; }
}
export function byteWriter(check, label, root = process.cwd()) {
  const guard = jsonOutputGuard(root);
  let changed = 0;
  const mismatch = (path) => {
    changed++;
    console.log(`${label}: ${check ? 'STALE' : 'changed'} ${relative(process.cwd(), path)}`);
  };
  return {
    put(path, bytes) {
      const buf = Buffer.from(bytes); guard(path, buf);
      if (existsSync(path) && readFileSync(path).equals(buf)) return;
      mismatch(path);
      if (!check) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buf); }
    },
    remove(path) {
      if (!existsSync(path)) return;
      mismatch(path);
      if (!check) rmSync(path);
    },
    finish() {
      if (changed > 0) {
        console.log(`${label}: tools node ${process.version}; ${['magick', 'cwebp', 'basisu'].map((cmd) => `${cmd} ${toolVersion(cmd, ['-version']) ?? 'unavailable'}`).join('; ')}`);
        if (check) process.exitCode = 1;
      }
      return changed;
    },
  };
}

/** @typedef {{request():{method():string,url():string,postDataBuffer():Uint8Array|null},fulfill(response:{status:number,headers:Record<string,string>,body?:string}):Promise<void>}} ByteRoute */
/** @typedef {{route(pattern:string,handler:(route:ByteRoute)=>Promise<void>):Promise<void>,unroute(pattern:string,handler:(route:ByteRoute)=>Promise<void>):Promise<void>}} ByteSinkPage */
/** Native authoring pages send bounded request bodies, never encoded JSON.
 * @param {ByteSinkPage} page
 * @param {{maxBytes?:number,maxFiles?:number}} [options] */
export async function browserBakeBytes(page, { maxBytes = 64_000_000, maxFiles = 64 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1)
    throw new Error('Invalid browser bake byte limits');
  const url = `https://binary-bake.invalid/${randomUUID()}/`, pattern = `${url}*`;
  /** @type {Map<string,Uint8Array>} */
  const files = new Map();
  const received = new Set();
  let total = 0, closed = false;
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };
  /** @param {ByteRoute} route */
  const handler = async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    const id = request.url().slice(url.length), bytes = request.postDataBuffer();
    if (closed || request.method() !== 'POST' || !request.url().startsWith(url)
      || !/^[a-z0-9][a-z0-9._-]{0,80}$/u.test(id) || received.has(id)
      || bytes === null || bytes.byteLength === 0 || total + bytes.byteLength > maxBytes || received.size >= maxFiles) {
      await route.fulfill({ status: 400, headers, body: 'Invalid or over-budget bake bytes' }); return;
    }
    files.set(id, new Uint8Array(bytes)); received.add(id); total += bytes.byteLength;
    await route.fulfill({ status: 204, headers });
  };
  await page.route(pattern, handler);
  return {
    url,
    /** @param {string} id */
    take(id) {
      const bytes = files.get(id);
      if (closed || bytes === undefined) throw new Error(`Missing browser bake bytes: ${id}`);
      files.delete(id); return bytes;
    },
    async dispose() {
      closed = true; files.clear(); received.clear();
      await page.unroute(pattern, handler);
    },
  };
}
