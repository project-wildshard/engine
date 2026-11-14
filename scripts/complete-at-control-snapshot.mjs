// DL17's in-page readings, shared by the complete-at-control gate (scripts/complete-at-control.mjs, Chromium) and the
// Simulator boost lap (scripts/sim-boost-lap.mjs): the residency snapshot the page runs, the lap's pops and the request rule.

/** In-page residency snapshot: everything that could still change what is drawn near the player. Self-contained: it also
 *  runs from the init script in the control frame. */
export function snapshot() {
  const api = window.__wildshard, grid = api?.shard?.grid, file = api?.shard?.shardfile, reachM = Number(window.__dl17Reach) || 220;
  const marks = performance.getEntriesByType('mark').filter(m => m.name.startsWith('wildshard.spawn-view')).map(m => ({ name: m.name, detail: m.detail }));
  let scene = null;
  try {
    const world = api.requireWorld(), p = world.player.position, v = world.player.velocity;
    let meshes = 0, visible = 0; const list = [], lods = [], texturesPending = [];
    // an instanced mesh's own transform says nothing of where its instances stand: it counts as within reach
    const near = o => { const e = o.matrixWorld.elements; return o.isInstancedMesh === true || Math.hypot(e[12] - p.x, e[14] - p.z) <= reachM; };
    const shown = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    world.game.scene.traverse(o => {
      // the player's own viewmodel (held weapons, arms, the board) hangs under the game's camera: not level content (any other
      // camera in the scene is level content, so a mesh under it still counts)
      for (let q = o.parent; q; q = q.parent) if (q === world.game.camera) return;
      if (o.isLOD && shown(o) && near(o) && o.getCurrentLevel() > 0) lods.push(`${o.name === '' ? o.uuid : o.name}@${o.getCurrentLevel()}`);
      if (!(o.isMesh || o.isInstancedMesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // additive blending (THREE.AdditiveBlending) is an effect: sparks, dust, glows
      if (mats.some(m => m?.blending === 2)) return;
      meshes++;
      const on = shown(o), close = on && near(o);
      if (on) visible++;
      const chain = []; for (let q = o; q && chain.length < 4; q = q.parent) chain.push(q.name === '' ? q.type : q.name);
      const g = o.geometry;
      const sig = [g?.uuid, g?.attributes?.position?.count ?? 0, g?.index?.count ?? 0,
        ...mats.map(m => `${m?.uuid}:${m?.map?.uuid ?? ''}:${m?.map?.image?.width ?? ''}`)].join('|');
      list.push([o.uuid, chain.join('<'), sig, on, close, o.isSkinnedMesh === true]);
      if (close) for (const m of mats) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
        const t = m?.[key];
        if (t?.isTexture !== true || t.isRenderTargetTexture === true) continue;
        const img = t.image;
        // a texture the renderer already holds on the GPU is decoded, even with its CPU copy released after upload (the
        // gpuOnly policy drops a compressed texture's mipmaps then: sp-o1's Nalati probe, 512 x 512 on the GPU). The witness
        // is a finished upload (sp-x8): three allocates __webglTexture before uploading and sets __version to the
        // texture's version only once the upload succeeds, so an allocated texture whose upload failed still reads empty
        const held = world.game.renderer?.properties?.get(t);
        const onGpu = held?.__webglTexture !== undefined && held.__webglTexture !== null && t.version > 0 && held.__version === t.version;
        const empty = !onGpu && (img === null || img === undefined || (t.isCompressedTexture ? !(t.mipmaps?.length > 0) : img.width === 0 || img.complete === false));
        if (empty && texturesPending.length < 50) texturesPending.push(`${chain.join('<')}.${key}`);
      }
    });
    scene = { meshes, visible, list, lods, texturesPending, player: [p.x, p.y, p.z], speed: Math.hypot(v.x, v.z), hover: world.player.hover, boost: world.player.hoverBoost,
      limit: typeof world.player.hoverSpeedLimit === 'function' ? world.player.hoverSpeedLimit() : null };
  } catch (error) { scene = { error: String(error) }; }
  let gridState = null;
  if (grid !== undefined) {
    try {
      const s = grid.state();
      gridState = { pitch: s.pitch, feet: s.feet, home: s.home, rings: s.rings, ringsReady: s.ringsReady, near: s.near,
        cells: (s.cells ?? []).map(c => ({ id: c.instance, slug: c.slug, cell: c.cell, shows: c.shows, drawn: c.drawn })) };
    } catch (error) { gridState = { error: String(error) }; }
  }
  let fine = null, residency = null;
  try { fine = file?.fine ? [...file.fine].map(String).sort((a, b) => a.localeCompare(b)) : null; } catch { fine = null; }
  try {
    const raw = api?.shard?.shardfileResidency;
    residency = raw ? JSON.parse(JSON.stringify(typeof raw === 'function' ? raw() : raw, (_key, value) => (typeof value === 'function' ? undefined : value))) : null;
  } catch (error) { residency = { error: String(error) }; }
  let textures = null;
  try { const t = api?.textures?.(); textures = t === undefined ? null : { mode: t.mode, why: t.why }; } catch (error) { textures = { error: String(error) }; }
  return { at: performance.now(), when: Date.now(), marks, scene, grid: gridState, fine, residency, textures };
}

/** A mesh signature's geometry id and texture ids (the snapshot's `geometry|positions|indices|material:map:width…`). */
function sigParts(sig) {
  const parts = sig.split('|');
  return { geometry: parts[0], maps: parts.slice(3).map(m => m.split(':')[1] ?? '').filter(map => map !== '') };
}

/** What a boost lap changed within reach of the player against the control snapshot `at`, from its samples, classified by
 *  the download plan's rule (root's ruling, G872 (A)): content that was not downloaded and loaded at control is a pop
 *  (RED): a mesh added after control, a mesh swapped to a geometry or texture no mesh held at control, a fine tile, an
 *  undecoded texture. A shard's own distance design on resident models (a mesh shown or hidden, swapped between resident
 *  geometries or textures, a THREE.LOD below level 0) is distance LOD: listed, not red. A mesh under another grid cell's
 *  region (`homeRegion` is the home cell's id) is the neighbour's; a skinned mesh (an animal, a person) is a moving
 *  actor: listed, never a pop. */
export function lapPops(at, lap, homeRegion) {
  const atList = at.scene?.list ?? [], atMeshes = new Map(atList.map(([id, , sig, on]) => [id, { sig, on }]));
  // DL5 target (root, G872): the Shardfile ring retires a tile beyond it and re-attaches the same model on return. A mesh
  // added after control is that model re-attached (listed, not a pop) only when one shown at control had its name, owner,
  // vertex and index counts and materials and textures (the whole signature but the new geometry's id), and that mesh
  // left the scene in an earlier sample (its retirement, sp-x9's review); anything else is a pop
  const model = (chain, sig) => `${chain.split('<').slice(0, 2).join('<')}|${sig.split('|').slice(1).join('|')}`;
  const atModels = new Map(), reattached = new Map(), retired = new Set();
  for (const [id, chain, sig, on] of atList) if (on) { const ids = atModels.get(model(chain, sig)) ?? []; ids.push(id); atModels.set(model(chain, sig), ids); }
  const residentGeometry = new Set(), residentMaps = new Set();
  for (const row of atList) { const parts = sigParts(row[2]); residentGeometry.add(parts.geometry); for (const map of parts.maps) residentMaps.add(map); }
  const pops = new Map(), neighbourPops = new Map(), actors = new Map(), distance = new Map();
  const fineAt = new Set(at.fine), fine = new Set(), lods = new Set(at.scene?.lods), textures = new Set();
  const neighbourChain = chain => homeRegion !== undefined && /region:[\w-]+/u.test(chain) && !chain.includes(`region:${homeRegion}`);
  for (const s of lap) {
    const present = new Set((s.scene?.list ?? []).map(([id]) => id));
    for (const [key, ids] of atModels) if (ids.some(id => !present.has(id))) retired.add(key);
    for (const key of s.fine ?? []) if (!fineAt.has(key)) fine.add(key);
    for (const lod of s.scene?.lods ?? []) lods.add(lod);
    for (const texture of s.scene?.texturesPending ?? []) textures.add(texture);
    for (const [id, chain, sig, , close, skinned] of s.scene?.list ?? []) {
      if (!close || pops.has(id) || neighbourPops.has(id) || actors.has(id) || reattached.has(id)) continue;
      if (skinned) { if (atMeshes.get(id)?.on !== true) actors.set(id, chain); continue; }
      const was = atMeshes.get(id);
      let red = null;
      if (was === undefined && retired.has(model(chain, sig))) { reattached.set(id, `re-attached ${chain}`); continue; }
      if (was === undefined) red = 'added';
      else if (was.sig !== sig) {
        const parts = sigParts(sig);
        if (!residentGeometry.has(parts.geometry) || parts.maps.some(map => !residentMaps.has(map))) red = 'swapped to non-resident data';
        else distance.set(id, `swapped ${chain}`);
      } else if (!was.on) distance.set(id, `shown ${chain}`);
      if (red !== null) (neighbourChain(chain) ? neighbourPops : pops).set(id, `${red} ${chain}`);
    }
  }
  for (const id of pops.keys()) distance.delete(id);
  return { fine: [...fine], pops: [...pops.values()], neighbourPops: [...neighbourPops.values()], actors: [...actors.values()],
    distanceLod: [...distance.values()], lods: [...lods], textures: [...textures], reattached: [...reattached.values()] };
}

/** DL17, after the flip: what only the server worker reads, and so no part of what a page must hold at control: its code and
 *  the server class of a product (`serverFolder.ts`, J91). Listed apart, as the precache is. Any other file a worker
 *  fetches is a file the page could have lent it, and stays level content: `spawnRereads` counts those. */
export const isServerRead = path => /^\/(?:b\/[^/]+\/standalone\/|assets\/spawn\/server[-/])/u.test(path);

/** DL17's request rule (root's ruling, G872 (a)): of one visit's requests (`{ url, by: 'page' | 'service-worker', start,
 *  end }`, end null while open), the level's are every level-content URL (`isLevelContent`) except the worker's offline
 *  precache: a service-worker fetch whose URL no page request is still reading or reads later (the page never requests
 *  it in the visit, lap included, or already had it before the worker's fetch began: the worker filling its cache with
 *  what the level loaded). A file the level needs shows as a page request too (also when the worker answers it from its
 *  cache), so any page request stays the level's. */
export function splitRequests(rows, isLevelContent) {
  const path = row => new URL(row.url).pathname, pageReads = new Map(), server = rows.filter(row => isServerRead(path(row)));
  for (const row of rows) if (row.by === 'page') { const reads = pageReads.get(path(row)) ?? []; reads.push(row); pageReads.set(path(row), reads); }
  const pageAfter = row => (pageReads.get(path(row)) ?? []).some(read => read.end === null || read.end === undefined || read.end > (row.start ?? 0));
  const precache = rows.filter(row => row.by === 'service-worker' && !pageAfter(row) && isLevelContent(row.url));
  const held = new Set([...precache, ...server]);
  return { level: rows.filter(row => isLevelContent(row.url) && !held.has(row)), precache, server };
}

/** DL25: the files a packs manifest delivers inside its parts, by path. */
export function spawnMembers(manifest) {
  const paths = new Set();
  for (const part of manifest?.parts ?? []) for (const [at] of part.members) { const file = manifest.files[at]; if (file !== undefined) paths.add(new URL(file.url, 'https://x.test').pathname); }
  return paths;
}
/** DL25, G828: a visit's packs manifests, by whose they are. A neighbour's files read through its own parts (DL20), whose hashed URLs
 *  name no shard, so only its manifest says those are its: `packs`, listed apart. `members` and `listedAt` are the home's, for DL25.
 *  @param {{ at: number, path: string, manifest: any }[]} rows @param {(shard: string) => boolean} neighbour */
export function splitManifests(rows, neighbour) {
  const members = new Set(), packs = new Set();
  let listedAt = null;
  for (const { at, path, manifest } of rows) {
    if (neighbour(manifest.shard)) { packs.add(path); for (const part of manifest.parts ?? []) packs.add(new URL(part.url, 'https://x.test').pathname); continue; }
    const found = spawnMembers(manifest);
    if (found.size > 0) listedAt ??= at; // the first manifest with parts: a title's read-ahead reads a default one, and its loose files are the first copy
    for (const member of found) members.add(member);
  }
  return { members, listedAt, packs };
}
/** DL25: requests that moved a part's member over the network again once its manifest had said so, whoever made them: the page
 *  has those bytes. What the title read before the tap came first, so the part is the second copy, not the read. A service
 *  worker's answer moved none. A failed part is read again, which is a real fetch: `failed` says so. */
export function spawnRereads(rows, members, listedAt, failed = false) {
  if (failed || listedAt === null) return { files: 0, bytes: 0, first: [] };
  const moved = rows.filter(row => row.start >= listedAt && members.has(new URL(row.url).pathname) && (row.bytes ?? 1) > 0);
  return { files: moved.length, bytes: moved.reduce((sum, row) => sum + (row.bytes ?? 0), 0), first: moved.slice(0, 3).map(row => (row.by === undefined ? new URL(row.url).pathname : `${new URL(row.url).pathname} by ${row.by}`)) };
}

/** Root's ruling (G872, wildshard-new 11-04): neighbour and outer-road work, as source spans of the grid session. A span runs
 *  from its `from` line up to its `to` line, both found once in the served build's own source of `file`. */
export const NEIGHBOUR_WORK = [
  { file: 'src/client/game/grid/session.ts', what: 'outer-ring strips', from: /^\s*const outerStrips = async /u, to: /^\s*const roadInput = /u },
  { file: 'src/client/game/grid/session.ts', what: 'outer-ring road', from: /^\s*const outer = async \(\): Promise<PlatformRoad>/u, to: /^\s*const completed = await /u },
  { file: 'src/client/game/grid/session.ts', what: 'outer-ring start', from: /this\.startOuterRoad = \(\) => \{/u, to: /^\s*const given = preparedRoad/u },
  { file: 'src/client/game/grid/session.ts', what: 'outer-ring platform', from: /^\s*prepareOuterStrips\(\): Promise<void> \{/u, to: /^\s*\/\*\* Step 2: the live crossing/u },
  // the cell the player is in admits no tile copy of itself (ce0ac0fa3c): these views are the cells round it
  { file: 'src/client/game/grid/session.ts', what: 'neighbour tile views', from: /^\s*private tileAdmission\(/u, to: /^\s*private refuse\(/u },
];
/** Each span's lines in `read(file)`'s source; an anchor missing or found twice refuses (the spans must follow edits). */
export function neighbourSpans(read, spans = NEIGHBOUR_WORK) {
  return spans.map(span => {
    const lines = read(span.file).split('\n'), at = re => lines.flatMap((line, i) => (re.test(line) ? [i + 1] : []));
    const [from, to] = [at(span.from), at(span.to)];
    if (from.length !== 1 || to.length !== 1 || to[0] <= from[0]) throw new Error(`neighbour span '${span.what}' has no single ${span.file} anchor pair`);
    return { file: span.file, what: span.what, from: from[0], to: to[0] };
  });
}
/** The neighbour span a source-mapped stack passes through (frames' `src` "path:line [name]"), else null. */
export function neighbourFrame(frames, spans) {
  for (const frame of frames) {
    const at = /^(.*):(\d+)(?: |$)/u.exec(frame.src ?? '');
    if (at === null) continue;
    const line = Number(at[2]), span = spans.find(s => at[1].endsWith(s.file) && line >= s.from && line < s.to);
    if (span !== undefined) return span.what;
  }
  return null;
}
/** Post-control level requests split by who asked (root's ruling, G872): a URL naming no level whose every page request
 *  after control has its own initiator stack, each passing through neighbour work, is the neighbour's (G828). Unknown
 *  evidence vetoes (sp-x1): a request with no stack, fewer stacks than page requests, or any stack from elsewhere keeps
 *  the URL the level's. A worker script's fetch carries no stack: each fetch pairs with its own constructor in order,
 *  every constructor since control must be neighbour work, and fewer constructors than fetches vetoes. The worker's own
 *  fetch follows the URL's verdict. */
export function splitByInitiator(after, trace, spans, namesLevel) {
  const path = url => { try { return new URL(url).pathname; } catch { return url; } };
  const group = rows => {
    const byPath = new Map();
    for (const row of [...rows].sort((a, b) => (a.msAfterControl ?? 0) - (b.msAfterControl ?? 0))) {
      const list = byPath.get(path(row.url)) ?? []; list.push(row); byPath.set(path(row.url), list);
    }
    return byPath;
  };
  const fetches = group(trace.initiators), builds = group(trace.workers), verdict = new Map();
  const of = url => {
    const key = path(url);
    if (verdict.has(key)) return verdict.get(key);
    const pages = after.filter(row => row.by === 'page' && path(row.url) === key).length, observed = fetches.get(key) ?? [];
    // a worker script: every constructor since control must be neighbour work (any other vetoes), and each fetch pairs
    // with its own constructor in order, so a stackless fetch never borrows another occurrence's (sp-x1)
    const constructors = builds.get(key) ?? [];
    if (constructors.length > 0 && constructors.length < observed.length) { verdict.set(key, null); return null; }
    const stacks = [...observed.filter(row => row.frames.length > 0).map(row => row.frames), ...constructors.map(row => row.frames)];
    const found = stacks.map(frames => (frames.length === 0 ? null : neighbourFrame(frames, spans)));
    if (observed.some((row, i) => row.frames.length === 0 && constructors[i] === undefined)) found.push(null);
    const what = !namesLevel(url) && stacks.length > 0 && observed.length >= pages && found.every(work => work !== null) ? found[0] : null;
    verdict.set(key, what);
    return what;
  };
  const neighbour = [], level = [];
  for (const row of after) { const what = of(row.url); if (what === null) level.push(row); else neighbour.push({ ...row, work: what }); }
  return { level, neighbour };
}

/** The boost lap's legs: a home's walk legs (scripts/physics-route.json) moved by the cell's offset, those starting within
 *  `reach` of the player. A leg that declares `inside` is a containment test (the walls must stop the player; the physics
 *  walk judges it), never a route the board can finish: it is skipped and named, so nothing is dropped silently.
 *  @param {readonly {name: string, start: {x: number, z: number}, waypoints: readonly {x: number, z: number}[], inside?: unknown}[]} all
 *  @param {readonly [number, number]} offset @param {readonly [number, number]} player @param {number} reach */
export function lapLegs(all, offset, player, reach) {
  const [ox, oz] = offset, [px, pz] = player, legs = [], skipped = [];
  for (const leg of all) {
    const start = { ...leg.start, x: leg.start.x + ox, z: leg.start.z + oz };
    if (Math.hypot(start.x - px, start.z - pz) > reach) continue;
    if (leg.inside !== undefined) { skipped.push(leg.name); continue; }
    // `lap.boost: false` (D226): a course boost throws the board off (Far Reach's hover bridges) is driven on the board at
    // normal speed; every other leg keeps Developer boost
    legs.push({ name: leg.name, start, points: leg.waypoints.map(w => [w.x + ox, w.z + oz]), boost: leg.lap?.boost !== false });
  }
  return { legs, skipped };
}

/** G1008: the first seconds after control from rAF intervals `[msFromControl, frameMs]`: frames per second, the worst frame,
 *  how many ran over 250 ms (the bar) and over 100 ms, and the longest frames with when they began. */
export function firstSeconds(frames, seconds) {
  const fps = Array.from({ length: seconds }, (_, i) => frames.filter(([at]) => at >= i * 1000 && at < (i + 1) * 1000).length);
  const worst = frames.reduce((max, [, ms]) => Math.max(max, ms), 0);
  const long = [...frames].filter(([, ms]) => ms > 100).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([at, ms]) => ({ at, ms }));
  return { seconds, frames: frames.length, fps, worstMs: worst, over250: frames.filter(([, ms]) => ms > 250).length,
    over100: frames.filter(([, ms]) => ms > 100).length, long };
}
/** A CDP CPU profile's self time by function (source-mapped where `sourceOf` maps it) and inclusive time by source file,
 *  in ms, the top 25 of each: what the page's main thread spent its first seconds of play on. */
export function profileTop(profile, sourceOf) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const keyOf = new Map(), fileOf = new Map();
  for (const node of profile.nodes) {
    const f = node.callFrame, src = f.url === '' ? null : sourceOf({ url: f.url, line: f.lineNumber + 1, col: f.columnNumber + 1 });
    const name = f.functionName === '' ? '(anonymous)' : f.functionName;
    keyOf.set(node.id, src ?? (f.url === '' ? name : `${name} ${f.url.split('/').pop()}:${f.lineNumber + 1}`));
    fileOf.set(node.id, src === null ? null : src.split(':')[0]);
  }
  const self = new Map(), files = new Map(); let total = 0;
  profile.samples.forEach((id, i) => {
    const ms = (profile.timeDeltas[i] ?? 0) / 1000; total += ms;
    const key = keyOf.get(id) ?? '?'; self.set(key, (self.get(key) ?? 0) + ms);
    const seen = new Set();
    for (let at = id; at !== undefined; at = parent.get(at)) { const file = fileOf.get(at); if (file !== null && file !== undefined && !seen.has(file)) { seen.add(file); files.set(file, (files.get(file) ?? 0) + ms); } if (!nodes.has(at)) break; }
  });
  const top = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, ms]) => [key, Math.round(ms)]);
  return { totalMs: Math.round(total), self: top(self), files: top(files) };
}

/** D227: a V8 heap snapshot's self size by node type and constructor, in MB, the top 30 (ArrayBuffer backing stores,
 *  typed arrays, strings, the game's own classes): where a shard's JavaScript-held memory goes. */
export function heapTop(heap) {
  const meta = heap.snapshot.meta, fields = meta.node_fields, width = fields.length, types = meta.node_types[0];
  const at = name => fields.indexOf(name), [ti, ni, si] = [at('type'), at('name'), at('self_size')], nodes = heap.nodes;
  const sizes = new Map(); let total = 0;
  for (let i = 0; i < nodes.length; i += width) {
    const type = types[nodes[i + ti]], name = type === 'object' || type === 'native' ? heap.strings[nodes[i + ni]] : `(${type})`;
    const size = nodes[i + si]; total += size; const key = `${type} ${name}`; sizes.set(key, (sizes.get(key) ?? 0) + size);
  }
  return { totalMB: Math.round(total / 1e5) / 10, top: [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([key, size]) => [key, Math.round(size / 1e5) / 10]) };
}
