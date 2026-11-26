// PZ24d1: reproduce the existing procedural surface maps, then encode phone ASTC 6x6.
// Run through src/scripts/browser-lane.sh; scratch and output paths are explicit.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {chromium, devices} from "./browser-playwright.mjs";
import {KEYCHAIN_ARGS} from './.kit/chromium-keychain.mjs';

const {values} = parseArgs({options: {scratch: {type: 'string'}, out: {type: 'string'}}});
if (values.scratch === undefined || values.out === undefined) throw new Error('Use --scratch=<owned lane folder> --out=<asset folder>');
const scratch = resolve(values.scratch), out = resolve(values.out);
mkdirSync(scratch, {recursive: true}); mkdirSync(out, {recursive: true});
const bundle = join(scratch, 'road-painters.js');
execFileSync('node_modules/.bin/rolldown', ['src/scripts/bake-road-surfaces.entry.ts', '--file', bundle, '--format', 'iife'], {stdio: 'ignore'});
const browser = await chromium.launch({headless: true, args: [...KEYCHAIN_ARGS]});
/** @type {{kind: string, width: number, height: number, png: number[]}[]} */
let images;
try {
  const context = await browser.newContext({...devices['iPhone 16 Pro']});
  const page = await context.newPage();
  await page.addScriptTag({content: readFileSync(bundle, 'utf8')});
  images = await page.evaluate('globalThis.__bakeRoadSurfaces()');
} finally { await browser.close(); }
const hash = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const encoderVersion = execFileSync('basisu', ['-version'], {encoding: 'utf8'}).split('\n')[0].trim();
const encoderOptions = ['-ktx2', '-ldr_6x6', '-effort', '4', '-srgb', '-mipmap'];
const sourcePaths = ['src/client/game/grid/roadSurfaceMaps.ts', 'src/client/game/grid/roadGrain.ts',
  'src/shared/game/grid/roadLayout.ts', 'src/scripts/bake-road-surfaces.entry.ts', 'src/scripts/bake-road-surfaces.mjs'];
const assets = [];
for (const image of images) {
  const source = join(scratch, `${image.kind}.png`), target = join(out, `road-${image.kind}-phone.ktx2`);
  writeFileSync(source, Buffer.from(image.png));
  execFileSync('basisu', [...encoderOptions, source, '-output_file', target], {stdio: 'ignore'});
  const bytes = readFileSync(target), levels = bytes.readUInt32LE(40);
  let gpuBytes = 0;
  for (let level = 0; level < levels; level++) gpuBytes += Number(bytes.readBigUInt64LE(80 + level * 24 + 16));
  assets.push({kind: image.kind, file: `road-${image.kind}-phone.ktx2`, width: image.width, height: image.height, levels, bytes: bytes.length, gpuBytes, sha256: hash(bytes)});
  console.log(`${image.kind}: ${image.width}x${image.height}, ${bytes.length} bytes, ${gpuBytes} GPU bytes`);
}
writeFileSync(join(out, 'road-surfaces.json'), `${JSON.stringify({format: 2, vkFormat: 166,
  sourcesSHA256: Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(path))])),
  encoder: {version: encoderVersion, options: encoderOptions}, assets}, null, 2)}\n`);
