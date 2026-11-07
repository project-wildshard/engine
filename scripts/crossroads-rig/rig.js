// crossroads rig: SF22a's synthetic 2 × 2 crossroads (project/archive/2026-11-04-shard-platform/contracts.md §3.2, rows.md F0 SF22a).
//
// A MEASUREMENT TOOL, NOT GAME CODE. Plain three.js, nothing from src/. It stands the camera where four shards meet and
// makes everything the streaming design says is resident there, each unit sized EXACTLY at §3.2's caps:
//   · n0 L0 tiles (62.5 m; default 40 = 32 in the 150 m ring + 8 heading lookahead), n0 / 4 from each of four shards:
//     5 MB resident, ~40k tris, 8 draws (terrain, one unique mesh, six instanced draws of the shard library's props)
//   · libs shard libraries (default 4): 25 MB each (17 × 1024² material textures + six prop meshes)
//   · n1 L1 tiles (125 m; default 32): 2.5 MB, 10k tris, 2 draws, a self-contained baked atlas (no library)
//   · nf far proxies (default 9, the 3 × 3 grid): 1.6 MB, 8k tris, 1 draw, one 1024² atlas
//   · sims whole-shard sim residencies (default 4): 40 MB of written CPU arrays each (colliders, entities, scripts)
//   · decode / refinement overlap: during the measure, every `churn` s (default 2) one more L0 tile is decoded and
//     uploaded at a lookahead slot while the oldest of two streamed tiles is disposed (REPLACE), so the measure carries
//     the in-flight decode buffers, the double residency and the build hitches
// in four material styles (toon · painterly · PBR · stylized Phong), one per shard. The engine base is not in the rig:
// it is the empty template shard's reading (sf22a-memory.md adds the two).
// Colour maps use the best block format the platform has (ASTC 4×4, else BC3, both 1 byte a texel; else RGBA8 and the
// units go over cap, which the stats say). Data maps (the per-tile splat) stay RGBA8. What a unit's GPU parts don't use
// of its cap is a CPU-side array (colliders, entities), written so its pages are really resident.
//
// Phases (window.__rig.phase), for an outside sampler: empty (renderer + sky only, `empty` s) → loading → warm (one
// unculled frame uploads everything) → settle (6 s, static, frame times) → measure (`secs` s of frame times while tiles
// stream, the camera turning a full circle) → done (keeps rendering). window.__rig carries the config, the accounted bytes, the frame stats.
// Query (a tool page, so query parameters are fine here; nothing in src/ reads them):
//   n0 n1 nf libs sims  counts · churn  seconds between streamed tiles (0 = none) · cpu=drop|keep  drop the JS copies of uploaded geometry / textures (default drop) ·
//   empty secs  phase lengths · shadow=0|1 (default 1, a 2048² sun shadow over the L0 ring) · dpr (cap, default 2)
// Staged and served by scripts/crossroads-rig/stage.sh; measured by desktop-probe.mjs and sim-probe.mjs.
import { runRig } from './core.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const CFG = {
  n0: num('n0', 40), n1: num('n1', 32), nf: num('nf', 9), libs: num('libs', 4),
  sims: num('sims', 4), churn: num('churn', 2), cpu: q.get('cpu') ?? 'drop', empty: num('empty', 8), secs: num('secs', 20), shadow: num('shadow', 1), dpr: num('dpr', 2),
  capsMB: { l0: 5, l1: 2.5, far: 1.6, lib: 25, sim: 40 }, trisCap: { l0: 40000, l1: 10000, far: 8000 },
};
void runRig(CFG);
