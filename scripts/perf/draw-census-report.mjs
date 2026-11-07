/** Aggregate matched native frame rows without dividing unrelated percentiles.
 * @param {Array<{calls:number,renderMs:number,workMs:number,triangles:number}>} frames */
export function nativeSummary(frames) {
  if (frames.length === 0) throw new Error('No completed census frames');
  const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  };
  for (const row of frames) if (![row.calls, row.renderMs, row.workMs, row.triangles].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid native frame counters');
  const costs = frames.filter(row => row.calls > 0).map(row => row.renderMs * 1000 / row.calls);
  return { frames: frames.length, drawsP50: quantile(frames.map(row => row.calls), .5), drawsMax: Math.max(...frames.map(row => row.calls)),
    workMsP50: quantile(frames.map(row => row.workMs), .5), renderMsP50: quantile(frames.map(row => row.renderMs), .5),
    renderUsPerDrawP50: costs.length > 0 ? quantile(costs, .5) : null, zeroDrawFrames: frames.length - costs.length,
    trianglesP50: quantile(frames.map(row => row.triangles), .5) };
}

/** Source-mapped sampled CPU. Attribute samples once to each category even if
 * recursive/nested wrappers occur. Wrapper overhead is the part of an engine
 * renderBufferDirect stack outside the stock three renderBufferDirect stack.
 * @param {object} profile @param {(frame: object)=>{source:string,name:string,line?:number|null,column?:number|null}} locate @param {number} frames */
export function sampledCpu(profile, locate, frames) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const totals = { renderWorld: 0, stockDraw: 0, drawWrappers: 0, propertyHooks: 0 }, mapped = new Set(), identified = new Set(), locations = new Map(), functions = new Map();
  for (const node of profile.nodes) locations.set(node.id, locate(node.callFrame));
  for (let index = 0; index < (profile.samples ?? []).length; index++) {
    const categories = new Set(), seen = new Set(), leaf = profile.samples[index];
    const elapsed = (profile.timeDeltas[index] ?? 0) / 1000; let id = leaf;
    while (id !== undefined) {
      const node = nodes.get(id); if (!node) throw new Error('CPU profile references a missing node');
      const location = locations.get(id), { source, name } = location; if (source) mapped.add(source);
      if (/\/src\/(?:client|cook|server|shared)\/(?:engine|game)\//u.test(source)) {
        const line = location.line ?? null, column = location.column ?? null;
        const key = JSON.stringify([source, name, line, column]);
        let row = functions.get(key);
        if (row === undefined) { row = { source, name, line, column, selfMs: 0, inclusiveMs: 0 }; functions.set(key, row); }
        if (!seen.has(key)) { row.inclusiveMs += elapsed; seen.add(key); }
        if (id === leaf) row.selfMs += elapsed;
      }
      if (/renderWorld/u.test(name) && source.includes('/core/worldDepth')) categories.add('renderWorld');
      if (/\/three\/(?:src\/renderers\/WebGLRenderer|build\/three(?:\.module)?\.js)/u.test(source) && /renderBufferDirect/u.test(name)) categories.add('stockDraw');
      if (/src\/(?:client|cook|server|shared)\/engine\/render\//u.test(source) && (/renderBufferDirect/u.test(name)
        || (source.endsWith('/drawHooks.ts') && /(?:^|\s)submit(?:\s|$)/u.test(name)))) categories.add('drawWrappers');
      if (/src\/(?:client|cook|server|shared)\/engine\/render\//u.test(source) && /properties\.get/u.test(name)) categories.add('propertyHooks');
      id = parents.get(id);
    }
    for (const category of categories) identified.add(category);
    if (categories.has('stockDraw')) categories.delete('drawWrappers');
    for (const category of categories) totals[category] += elapsed;
  }
  const present = mapped.size > 0;
  return { frames, mappedSources: mapped.size, msPerFrame: Object.fromEntries(Object.entries(totals).map(([name, ms]) => [name, present && identified.has(name) && frames > 0 ? ms / frames : null])),
    functions: [...functions.values()].sort((a, b) => b.selfMs - a.selfMs || b.inclusiveMs - a.inclusiveMs).map(row => Object.assign(row, { selfMsPerFrame: frames > 0 ? row.selfMs / frames : null, inclusiveMsPerFrame: frames > 0 ? row.inclusiveMs / frames : null })),
    qualifier: 'CDP sampled inclusive renderWorld/stock draw; exclusive engine draw-wrapper stack; not GPU time or an uninstrumented acceptance reading' };
}

/** @param {object[]} frames */
export function attributionSummary(frames) {
  const passes = new Map(), owners = new Map(), materials = new Set(), geometries = new Set(), programs = new Set();
  let draws = 0, nodeDraws = 0, singleCopyMain = 0;
  for (const frame of frames) for (const row of frame.draws) {
    draws += row.count;
    const pass = passes.get(row.pass) ?? 0; passes.set(row.pass, pass + row.count);
    const key = `${row.pass}|${row.owner}`, owner = owners.get(key) ?? 0; owners.set(key, owner + row.count);
    if (row.program !== null) programs.add(row.program);
    if (row.materialId) materials.add(row.materialId); if (row.geometryId) geometries.add(row.geometryId);
    if (row.nodeMaterial) nodeDraws += row.count;
    if (row.pass !== 'shadow' && row.instances === 1 && !row.skinned) singleCopyMain += row.count;
  }
  const propertyKinds = new Map();
  let propertyTotal = 0;
  const countedProperties = frames.length > 0 && frames.every(frame => frame.propertyReads !== undefined && frame.propertyReads !== null);
  if (countedProperties) for (const frame of frames) {
    const { total, byKind } = frame.propertyReads;
    const counts = Object.values(byKind);
    if (!Number.isSafeInteger(total) || total < 0 || counts.some(value => !Number.isSafeInteger(value) || value < 0)
      || counts.reduce((sum, value) => sum + value, 0) !== total) throw new Error('Invalid property read census');
    propertyTotal += total;
    for (const [kind, count] of Object.entries(byKind)) propertyKinds.set(kind, (propertyKinds.get(kind) ?? 0) + count);
  }
  const mean = value => value / frames.length;
  return { frames: frames.length, propertyReads: countedProperties ? { totalPerFrame: mean(propertyTotal), byKind: Object.fromEntries([...propertyKinds].map(([kind, count]) => [kind, mean(count)])) } : null, draws: mean(draws), passes: Object.fromEntries([...passes].map(([key, value]) => [key, mean(value)])),
    byOwner: [...owners].map(([owner, count]) => ({ owner, drawsPerFrame: mean(count) })).sort((a, b) => b.drawsPerFrame - a.drawsPerFrame),
    programs: programs.size, programsPerFrame: mean(frames.reduce((sum, frame) => sum + new Set(frame.draws.map(row => row.program).filter(program => program !== null)).size, 0)),
    treeDraws: Object.fromEntries(['shadow', 'main'].map(pass => [pass, mean(frames.reduce((sum, frame) => sum + frame.draws.filter(row => row.owner.includes('/forest-tree') && (pass === 'shadow' ? row.pass === 'shadow' : row.pass !== 'shadow')).reduce((count, row) => count + row.count, 0), 0))])), materials: materials.size, geometries: geometries.size, nodeDraws: mean(nodeDraws), singleCopyMain: mean(singleCopyMain),
    useProgram: mean(frames.reduce((sum, frame) => sum + frame.useProgram, 0)), uniforms: mean(frames.reduce((sum, frame) => sum + frame.uniforms, 0)) };
}
