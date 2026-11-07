#!/usr/bin/env node
// check-model-sources.mjs — every Blender-built model keeps a source (M10, E315; docs/design/blender-practice.md §5).
// The rule: Blender scripts are the source, the exported GLB is committed, a .blend never is.
//
//   node scripts/check-model-sources.mjs          (test/model-sources.test.ts runs it in `pnpm test`: < 1 s, no Blender)
//
// It refuses:
//   1. a target in scripts/blender/targets.json that names a file that isn't there: its script, sources, post, inputs,
//      outputs, or the repo side of a meshopt / copy pair;
//   2. a GLB in a folder a Blender target writes that no target lists as an output: a Blender-built GLB with no source
//      script (NOT_BLENDER lists the GLBs from other pipelines that share such a folder);
//   3. an orphan under scripts/blender/: a file that isn't a target's script, source or post, and isn't lib/, build.sh,
//      targets.json or a README;
//   4. a tracked .blend / .blend1 (and, outside git, any .blend in the tree).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = 'scripts/blender/targets.json';
/** GLBs from other pipelines that share a folder with a Blender target's outputs: path → where they come from */
const NOT_BLENDER = {
  'public/assets/nine-dragon/lab/grapple/dragon-hook.glb': 'TRELLIS.2 (lab P9 grapple, art/nine-dragon-stack/round-9-lab-grapple)',
};
/** files under scripts/blender/ that belong to no single target */
const SHARED = new Set(['scripts/blender/build.sh', 'scripts/blender/targets.json']);

const errors = [];
const at = (p) => join(ROOT, p.replace(/\/$/, ''));
const manifest = JSON.parse(readFileSync(at(MANIFEST), 'utf8'));

/** the repo's files: git's list when this is a checkout, else a walk (the Vercel gate's export has no .git) */
function listFiles(dir) {
  try {
    return execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter((f) => f !== '');
  } catch {
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(at(d), { withFileTypes: true })) {
        const p = d === '.' ? e.name : `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (!['node_modules', '.git', 'dist', '__pycache__'].includes(e.name)) walk(p);
        } else {
          out.push(p);
        }
      }
    };
    if (existsSync(at(dir))) walk(dir);
    return out;
  }
}

// ── 1. every file a target names exists ──
const claimed = new Set();
const outputs = new Set();
const outDirs = new Set();
for (const [id, t] of Object.entries(manifest.targets)) {
  const need = (p, what) => { if (!existsSync(at(p))) errors.push(`${id}: its ${what} ${p} does not exist`); };
  if (t.script !== null && t.script !== undefined) { need(t.script, 'script'); claimed.add(t.script); }
  for (const s of t.sources ?? []) { need(s, 'source'); claimed.add(s); }
  if (t.post !== undefined) { need(t.post, 'post step'); claimed.add(t.post); }
  for (const p of t.inputs ?? []) need(p, 'input');
  const outs = [...(t.outputs ?? []), ...(t.meshopt ?? []).map((pair) => pair[1]), ...(t.copy ?? []).map((pair) => pair[1])];
  for (const o of outs) {
    need(o, 'output');
    if (o.endsWith('.glb')) { outputs.add(o); outDirs.add(dirname(o)); }
  }
  if (t.manual === undefined && (t.script === null || t.script === undefined) && outs.length > 0) {
    errors.push(`${id}: it lists outputs but has no script and is not manual`);
  }
}

// ── 2. no GLB without a source in a Blender output folder ──
for (const d of outDirs) {
  for (const f of listFiles(d)) {
    if (!f.endsWith('.glb') || dirname(f) !== d || outputs.has(f) || f in NOT_BLENDER) continue;
    errors.push(`${f}: a GLB in a Blender target's folder that no target in ${MANIFEST} builds (add its target, or NOT_BLENDER if another pipeline made it)`);
  }
}

// ── 3. no orphan under shared or shard-owned Blender sources ──
const shardRoot = at('src/shards');
const sourceRoots = ['scripts/blender', ...(existsSync(shardRoot) ? readdirSync(shardRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.endsWith('-legacy') && existsSync(at(`src/shards/${entry.name}/blender`)))
  .map(entry => `src/shards/${entry.name}/blender`) : [])];
for (const f of sourceRoots.flatMap(dir => listFiles(dir))) {
  if (f.startsWith('scripts/blender/lib/') || SHARED.has(f) || /(^|\/)README\.md$/.test(f) || f.includes('/__pycache__/')) continue;
  if (!claimed.has(f)) errors.push(`${f}: an orphan (no target in ${MANIFEST} names it as its script, a source or its post step)`);
}

// ── 4. no .blend in git ──
for (const f of listFiles('.')) {
  if (/\.blend\d*$/i.test(f)) {
    errors.push(`${f}: a .blend is never committed (the script is the source; save inspection files into ~/.cache/wildshard-blender/)`);
  }
}

const targets = Object.keys(manifest.targets).length;
if (errors.length > 0) {
  console.error(`check-model-sources: ${errors.length} problem(s) in ${targets} Blender targets:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exitCode = 1;
} else {
  console.log(`check-model-sources: ${targets} Blender targets, ${outputs.size} GLBs, ${claimed.size} source files: every GLB has a script, no orphans, no .blend (${relative(ROOT, at(MANIFEST))})`);
}
