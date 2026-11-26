// Downloads CC0 assets from Poly Haven into public/assets.
// Run: pnpm assets   (idempotent — skips files that already exist)
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OUT = 'public/assets';
const API = 'https://api.polyhaven.com/files/';

// id -> { res, maps, dir }
const TEXTURES = {
  // ground splat layers
  forest_ground_04:   { res: '2k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  forest_leaves_02:   { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  leafy_grass:        { res: '2k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  rock_ground:        { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  stony_dirt_path:    { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  // trees
  pine_bark:          { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  // cabins
  wood_trunk_wall:    { res: '2k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  roof_planks:        { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  wood_planks_dirt:   { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  rough_pine_door:    { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  stone_wall:         { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  // the Ridge's granite (PH-B2, src/shards/pine-hollow/world/crags.ts): re-encoded q85 + phone WebP by hand (scripts/tex-tiers.mjs' settings)
  mossy_rock:         { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
  wood_planks_grey:   { res: '1k', maps: ['Diffuse', 'nor_gl', 'arm'] },
};

// model texture atlases pulled from heavy photoscans (we only take the maps)
const MODEL_MAPS = {
  pine_tree_01: { res: '1k', maps: ['twig_nor_gl', 'twig_arm'] },
};

const MODELS = ['rock_moss_set_01', 'tree_stump_01', 'dead_tree_trunk', 'stone_fire_pit',
  // cabin props (cabins agent)
  'Lantern_01', 'wooden_crate_02', 'wine_barrel_01', 'wooden_bucket_01', 'hatchet'];
const HDRIS = { kloofendal_48d_partly_cloudy_puresky: '2k', qwantani_late_afternoon_puresky: '2k', qwantani_sunset_puresky: '2k' };

/** @param {string} p */
async function exists(p) { try { await access(p); return true; } catch { return false; } }
/** @param {string} url @param {string} dest */
async function dl(url, dest) {
  if (await exists(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log('  ✓', dest);
}
/** @param {string} id */
async function files(id) { return (await fetch(API + id)).json(); }

for (const [id, cfg] of Object.entries({ ...TEXTURES, ...MODEL_MAPS })) {
  console.log('texture', id);
  const f = await files(id);
  for (const m of cfg.maps) {
    const e = f[m]?.[cfg.res]?.jpg ?? f[m]?.[cfg.res]?.png;
    if (!e) { console.warn('  missing map', m); continue; }
    const ext = e.url.split('.').pop();
    await dl(e.url, join(OUT, 'tex', id, `${m.toLowerCase()}.${ext}`));
  }
}
for (const id of MODELS) {
  console.log('model', id);
  const f = await files(id);
  const g = f.gltf['1k'].gltf;
  await dl(g.url, join(OUT, 'models', id, `${id}.gltf`));
  for (const [rel, e] of Object.entries(g.include)) await dl(e.url, join(OUT, 'models', id, rel));
}
for (const [id, res] of Object.entries(HDRIS)) {
  console.log('hdri', id);
  const f = await files(id);
  await dl(f.hdri[res].hdr.url, join(OUT, 'hdri', `${id}_${res}.hdr`));
}
console.log('done');
