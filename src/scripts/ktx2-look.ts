#!/usr/bin/env node
/** SF15 (J525): the look check before a zone's hand-made KTX2 sets are deleted. For every texture row of a product's own
 * KTX2 table whose source is a JPG or PNG, it encodes the cook's KTX2 from that source with the cook's settings
 * (`desktopKtx2`'s role and flip rules, `loadBasisuImageKtx2`) and draws the same texture three ways on one board: the
 * source, the hand-made KTX2 and the cooked one, each decoded as a GPU would read it. Each pair gets its PSNR against the
 * source, so the board sorts the worst first and flags a flip the cook got wrong (the cooked copy far from the source while
 * the hand-made is near).
 *
 * The in-game views (fixed cameras over the zone, hand-made pin against the local cook of the re-pack) are the re-pack lanes'
 * board; this one is texture by texture, the input those views can't separate.
 *
 *   node --import ./src/scripts/bake-loader.mjs src/scripts/ktx2-look.ts --product out/<slug> --out tmp/<lane>/look [--tier desktop|phone] [--only <substr>] [--limit <n>] [--engine]
 *
 * Writes `<out>/board.html`, `<out>/look.json` and one PNG per drawing; prints the worst ten. Sources and targets are read
 * from the product's mounts, then from engine `public/` (the art not yet in its shardfile). */
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {createRequire} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import {flipsImage, roleOfImage} from '../cook/game/cookedKtx2';
import {imageHead, loadBasisuImageKtx2} from '../cook/game/imageKtx2Wasm';
import {cookedKtx2TableOf} from '../shared/game/shardfile/cookedKtx2Table';
import {GPU_FILES} from '../client/engine/boot/ktx2.generated';

const {values} = parseArgs({options: {product: {type: 'string'}, out: {type: 'string'}, tier: {type: 'string', default: 'desktop'}, only: {type: 'string', default: ''}, limit: {type: 'string', default: '400'}, size: {type: 'string', default: '512'}, engine: {type: 'boolean', default: false}}});
if (values.product === undefined || values.out === undefined) throw new Error('usage: ktx2-look.ts --product out/<slug> --out tmp/<lane>/look [--tier desktop|phone]');
const product = resolve(values.product), out = resolve(values.out), tier = values.tier === 'phone' ? 'phone' : 'desktop', draw = Number(values.size);
const engineRoot = resolve(import.meta.dirname, '../..');
mkdirSync(out, {recursive: true});

interface Mount {readonly url: string; readonly path: string}
const cook = JSON.parse(readFileSync(join(product, 'cook.json'), 'utf8')) as {mounts: Mount[]};
const mounts = new Map(cook.mounts.map(row => [row.url, row.path]));
const read = (url: string): Uint8Array | undefined => {
  const clean = url.replace(/#.*$/u, ''), mounted = mounts.get(clean);
  const file = mounted === undefined ? join(engineRoot, 'public', clean) : join(product, mounted);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
};
const discovery = [...mounts].find(([url]) => url.endsWith('/discovery.json'));
if (discovery === undefined) throw new Error(`${product}: no discovery document`);
// `--engine`: the engine-wide rows too (the shared ground sets and skies a zone reads from engine `public/` today).
const table = {...(values.engine ? GPU_FILES[tier] : {}), ...cookedKtx2TableOf(JSON.parse(readFileSync(join(product, discovery[1]), 'utf8')))[tier]};
const gltfFolders = new Set([...mounts.keys()].filter(url => url.endsWith('.gltf')).map(url => url.slice(0, url.lastIndexOf('/'))));

// The transcoder: basisu's own (the vendored build), every KTX2 decoded to RGBA as a GPU would sample its top level.
interface Ktx2File {isValid(): boolean; startTranscoding(): boolean; getLevels(): number; getImageLevelInfo(level: number, layer: number, face: number): {origWidth: number; origHeight: number}; getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number; transcodeImage(out: Uint8Array, level: number, layer: number, face: number, format: number, alpha: number, c0: number, c1: number): number; close(): void; delete(): void}
const require = createRequire(import.meta.url);
const factory = require('./vendor/basisu/basis_encoder.cjs') as (options: object) => Promise<{initializeBasis(): void; KTX2File: new (bytes: Uint8Array) => Ktx2File; transcoder_texture_format: {cTFRGBA32: {value: number}}}>;
const basis = await factory({wasmBinary: new Uint8Array(readFileSync(join(engineRoot, 'src/scripts/vendor/basisu/basis_encoder.wasm'))), print: () => undefined, printErr: () => undefined});
basis.initializeBasis();
const rgba32 = basis.transcoder_texture_format.cTFRGBA32.value;
/** The level nearest `draw` on its larger side, as RGBA. */
function decodeKtx2(bytes: Uint8Array): {rgba: Uint8Array; width: number; height: number} | undefined {
  const file = new basis.KTX2File(bytes);
  try {
    if (!file.isValid() || !file.startTranscoding()) return undefined;
    let level = 0;
    while (level + 1 < file.getLevels()) { const {origWidth, origHeight} = file.getImageLevelInfo(level + 1, 0, 0); if (Math.max(origWidth, origHeight) < draw) break; level++; }
    const {origWidth: width, origHeight: height} = file.getImageLevelInfo(level, 0, 0);
    const rgba = new Uint8Array(file.getImageTranscodedSizeInBytes(level, 0, 0, rgba32));
    return file.transcodeImage(rgba, level, 0, 0, rgba32, 0, -1, -1) === 0 ? undefined : {rgba, width, height};
  } finally { file.close(); file.delete(); }
}
/** A drawing at `draw`'s size, so the three compare texel for texel. */
const fit = async (image: {rgba: Uint8Array; width: number; height: number}, width: number, height: number): Promise<Uint8Array> =>
  new Uint8Array(await sharp(Buffer.from(image.rgba), {raw: {width: image.width, height: image.height, channels: 4}}).resize(width, height, {fit: 'fill'}).raw().toBuffer());
const psnr = (left: Uint8Array, right: Uint8Array): number => {
  let sum = 0, count = 0;
  for (let at = 0; at < left.length; at += 4) for (let channel = 0; channel < 3; channel++) { const d = (left[at + channel] ?? 0) - (right[at + channel] ?? 0); sum += d * d; count++; }
  return sum === 0 ? 99 : 10 * Math.log10((255 * 255) / (sum / count));
};
const png = async (rgba: Uint8Array, width: number, height: number, name: string): Promise<string> => { await sharp(Buffer.from(rgba), {raw: {width, height, channels: 4}}).png().toFile(join(out, name)); return name; };

const encode = await loadBasisuImageKtx2();
interface Row {readonly source: string; readonly role: string; readonly flip: boolean; readonly handBytes: number; readonly cookedBytes: number; readonly hand: number; readonly cooked: number; readonly between: number; readonly files: readonly string[]}
const rows: Row[] = [], skipped: string[] = [];
const wanted = Object.entries(table).filter(([source, target]) => target.endsWith('.ktx2') && /\.(?:jpe?g|png)(?:#layer)?$/iu.test(source) && source.includes(values.only)).slice(0, Number(values.limit));
for (const [at, [source, target]] of wanted.entries()) {
  const image = read(source), hand = read(target), layer = source.endsWith('#layer');
  if (image === undefined || hand === undefined || imageHead(image) === undefined) { skipped.push(`${source}: ${image === undefined ? 'no source' : hand === undefined ? 'no hand-made file' : 'not a PNG or JPEG'}`); continue; }
  const url = source.replace(/#layer$/u, ''), role = roleOfImage(url), flip = !layer && flipsImage(url, gltfFolders);
  const cooked = encode(image, {role, flip}), handImage = decodeKtx2(hand), cookedImage = cooked === undefined ? undefined : decodeKtx2(cooked);
  if (handImage === undefined || cookedImage === undefined) { skipped.push(`${source}: ${handImage === undefined ? 'hand-made file did not decode' : 'cook encode failed'}`); continue; }
  const scale = Math.min(1, draw / Math.max(handImage.width, handImage.height)), width = Math.max(4, Math.round(handImage.width * scale)), height = Math.max(4, Math.round(handImage.height * scale));
  // The source as the cook's loader would see it: flipped when the cook flips it, so a right flip compares near.
  const raw = await sharp(Buffer.from(image)).ensureAlpha().resize(width, height, {fit: 'fill'}).flip(flip).raw().toBuffer();
  const sourceRgba = new Uint8Array(raw), handRgba = await fit(handImage, width, height), cookedRgba = await fit(cookedImage, width, height);
  const name = `${String(at).padStart(4, '0')}`;
  const files = [await png(sourceRgba, width, height, `${name}-source.png`), await png(handRgba, width, height, `${name}-hand.png`), await png(cookedRgba, width, height, `${name}-cooked.png`)];
  rows.push({source, role, flip, handBytes: hand.length, cookedBytes: cooked?.length ?? 0, hand: psnr(sourceRgba, handRgba), cooked: psnr(sourceRgba, cookedRgba), between: psnr(handRgba, cookedRgba), files});
  process.stdout.write(`\rktx2-look: ${rows.length}/${wanted.length}`);
  // The board after every texture, so a run cut short still shows what it drew.
  writeBoard();
}
process.stdout.write('\n');
writeBoard();
function writeBoard(): void {
// Worst first: the cooked copy's loss against the hand-made one's.
rows.sort((left, right) => (left.cooked - left.hand) - (right.cooked - right.hand));
writeFileSync(join(out, 'look.json'), `${JSON.stringify({product: values.product, tier, rows, skipped}, null, 1)}\n`);
const esc = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const card = (row: Row): string => `<figure class="${row.cooked < row.hand - 3 || row.between < 25 ? 'bad' : ''}"><figcaption>${esc(row.source)}<br>${row.role}${row.flip ? ', flipped' : ''} · hand ${row.hand.toFixed(1)} dB (${(row.handBytes / 1024).toFixed(0)} KB) · cooked ${row.cooked.toFixed(1)} dB (${(row.cookedBytes / 1024).toFixed(0)} KB) · between ${row.between.toFixed(1)} dB</figcaption><div>${row.files.map((file, at) => `<label><img src="${file}" loading="lazy"><span>${['source', 'hand-made', 'cooked'][at] ?? ''}</span></label>`).join('')}</div></figure>`;
writeFileSync(join(out, 'board.html'), `<!doctype html><meta charset="utf-8"><title>KTX2 look: ${esc(values.product ?? '')}</title><style>body{font:13px system-ui;background:#111;color:#ddd;margin:16px}figure{margin:0 0 20px}figure.bad figcaption{color:#f77}div{display:flex;gap:6px;flex-wrap:wrap}label{display:flex;flex-direction:column}img{max-width:min(32vw,512px);image-rendering:pixelated}</style><h1>Hand-made against cooked KTX2, ${tier}: ${esc(values.product ?? '')}</h1><p>${rows.length} textures, worst first (PSNR against the source image); ${skipped.length} skipped.</p>${rows.map(card).join('')}<pre>${esc(skipped.join('\n'))}</pre>`);
}
for (const row of rows.slice(0, 10)) console.log(`${(row.cooked - row.hand).toFixed(1).padStart(6)} dB  hand ${row.hand.toFixed(1)} cooked ${row.cooked.toFixed(1)} between ${row.between.toFixed(1)}  ${row.source}`);
console.log(`ktx2-look: ${rows.length} textures, ${skipped.length} skipped -> ${join(out, 'board.html')}`);
