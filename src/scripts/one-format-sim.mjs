import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

const [engine, folder, receipt] = process.argv.slice(2).map(value => resolve(value));
if (!receipt?.startsWith(`${resolve('tmp')}${sep}`)) throw new Error('Receipt must be in this checkout\'s owned scratch');
const root = pathToFileURL(`${engine}/`), loaded = new Set();
registerHooks({ load(url, context, next) { if (url.startsWith(root.href) && url.includes('/src/')) loaded.add(url); return next(url, context); } });
/** @param {string} path */
const imp = path => import(new URL(path, root).href);
const { installAppIdentity } = await imp('src/shared/engine/app/identity.ts');
const { WILDSHARD_IDENTITY } = await imp('src/client/game/identity.ts'); installAppIdentity(WILDSHARD_IDENTITY);
const { installPortableMath } = await imp('src/shared/engine/core/portableMath.ts'); installPortableMath();
const { loadHeadlessFolder } = await imp('src/server/host/headlessFolder.ts');
const { outputDescriptor } = await imp('src/shared/game/shardfile/outputDescriptor.ts');
const { loadRapier } = await imp('src/shared/engine/physics/rapier.ts');
const { openWorld } = await imp('src/server/host/openWorld.ts');
const product = await loadHeadlessFolder(folder), shard = product.shardfile;
const descriptor = outputDescriptor(shard);
if (!descriptor) throw new Error('Missing admitted output');
const assets = new Map(descriptor.index.files.map(/** @param {{ commons?: boolean, hash: string, path: string }} file */ file => [file.commons === true ? `commons:${file.hash}` : file.hash,
  Uint8Array.from(readFileSync(resolve(folder, file.path)))]));
const rapier = await loadRapier(readFileSync(new URL('../../public/assets/physics/rapier.wasm', import.meta.url)));
const world = await openWorld({ shard, assets, rapier, product }, { room: true });
const digest = createHash('sha256'), start = new Map(), sources = [], seen = new Set();
/** @type {{tick: number, count: number, digest: string}[]} */
const frames = [];
/** @param {number} tick */
const sample = tick => {
  if (world.host.state.tick !== tick) throw new Error(`Host stopped at ${world.host.state.tick}, expected ${tick}`);
  const bodies = [...world.host.entities.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
  const frame = [];
  for (const body of bodies) {
    const position = [body.position.x, body.position.y, body.position.z];
    if (!position.every(Number.isFinite)) throw new Error(`Nonfinite body ${body.entityId}`);
    if (!start.has(body.entityId)) start.set(body.entityId, position);
    seen.add(body.entityId);
    frame.push([body.entityId, ...position, body.yaw, body.state, body.hp, body.alive]);
  }
  digest.update(JSON.stringify([tick, frame])).update('\n');
  if (tick % 600 === 0) frames.push({ tick, count: frame.length, digest: createHash('sha256').update(JSON.stringify(frame)).digest('hex') });
};
const before = performance.now();
try {
  sample(0);
  const player = world.host.players.keys().next().value;
  if (typeof player !== 'string') throw new Error('Missing player');
  for (let tick = 1; tick <= 3600; tick++) {
    const phase = Math.floor((tick - 1) / 900), steer = { keyX: phase === 1 ? 1 : phase === 3 ? -1 : 0,
      keyY: phase === 0 ? 1 : phase === 2 ? -1 : 0, stickX: 0, stickY: 0 };
    world.step([{ client: 1, player, command: { seq: tick, viewTick: 0, steer, yaw: 0, pitch: 0, buttons: 0 }, extra: null, still: false, acts: [] }]);
    sample(tick);
  }
  let moved = 0;
  for (const body of world.host.entities.values()) {
    const from = start.get(body.entityId);
    if (from && Math.hypot(body.position.x - from[0], body.position.z - from[2]) > 0.1) moved++;
  }
  for (const path of [...loaded].sort((a, b) => a.localeCompare(b))) {
    if (/\/(?:huntPattern|creatureLayers|layerHunts|brainRuntime|simulation)\.ts$/.test(path)) {
      sources.push({ path: path.slice(root.href.length), hash: createHash('sha256').update(readFileSync(new URL(path))).digest('hex') });
    }
  }
  const result = { engine, folder, slug: shard.identity.slug, ticks: world.host.state.tick, simulatedSeconds: world.host.state.tick / 60,
    product: createHash('sha256').update(readFileSync(resolve(folder, 'shard.json'))).digest('hex'),
    history: digest.digest('hex'), frames, seen: seen.size, moved, seconds: (performance.now() - before) / 1000, sources };
  writeFileSync(receipt, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ slug: result.slug, history: result.history, seen: result.seen, moved, seconds: result.seconds }));
} finally { world.dispose(); }
