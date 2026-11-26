/** A capture-only compiled-program loan. No camera, clock, render policy or
 * uniform values are changed. Validate the whole loan before touching a material.
 * @param {readonly import('./material-program-loan.mjs').ProgramMaterial[]} materials
 * @param {readonly import('./material-program-loan.mjs').MaterialProgramLoan[]} programs
 */
export async function loanMaterialPrograms(materials, programs) {
  /** @param {string} source */
  const hash = async source => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(n => n.toString(16).padStart(2, '0')).join('');
  /** @param {string} source @param {string} qualifier */
  const declarations = (source, qualifier) => [...source.matchAll(new RegExp(`\\b${qualifier}\\s+(?:(?:lowp|mediump|highp)\\s+)?(\\w+)\\s+(\\w+)\\s*(\\[[^\\]]+\\])?\\s*;`, 'gu'))].map(match => `${match[1]}:${match[2]}:${match[3] ?? ''}`).sort();
  /** @param {import('./material-program-loan.mjs').ProgramSource} program @param {string} qualifier */
  const contract = (program, qualifier) => [...new Set([...declarations(program.vertex, qualifier), ...declarations(program.fragment, qualifier)])].sort().join('\n');
  /** @type {Set<import('./material-program-loan.mjs').ProgramMaterial>} */
  const seen = new Set();
  /** @type {{material:import('./material-program-loan.mjs').ProgramMaterial,vertex:string,fragment:string}[]} */
  const changes = [];
  /** @type {import('./material-program-loan.mjs').ProgramLoanReceipt[]} */
  const receipts = [];
  for (const program of programs) {
    if (program.aliases.length === 0 || new Set(program.aliases).size !== program.aliases.length) throw new Error('Program loan needs unique material aliases');
    for (const source of [program.before, program.after]) {
      if (typeof source.vertex !== 'string' || typeof source.fragment !== 'string' || source.vertex.length === 0 || source.fragment.length === 0
        || !/^[a-f0-9]{64}$/u.test(source.vertexHash) || !/^[a-f0-9]{64}$/u.test(source.fragmentHash)
        || await hash(source.vertex) !== source.vertexHash || await hash(source.fragment) !== source.fragmentHash) throw new Error('Program loan source identity differs');
    }
    if(program.before.vertexHash===program.after.vertexHash&&program.before.fragmentHash===program.after.fragmentHash)throw new Error('Program loan has no compiled change');
    if (contract(program.before, 'attribute') !== contract(program.after, 'attribute')) throw new Error('Program loan changes vertex attributes');
    if (contract(program.before, 'uniform') !== contract(program.after, 'uniform')) throw new Error('Program loan changes uniform declarations');
    const matches = materials.filter(material => program.aliases.includes(material.name));
    if (matches.length === 0) throw new Error('Program loan has no actual material');
    for (const material of matches) {
      if (seen.has(material)) throw new Error('Program loan overlaps an actual material');
      if (material.vertexShader !== program.before.vertex || material.fragmentShader !== program.before.fragment) throw new Error('Actual material source differs from program loan');
      if (program.uniforms.some(name => !Object.hasOwn(material.uniforms, name))) throw new Error('Program loan needs absent native uniforms');
      seen.add(material);
      changes.push({material, vertex: material.vertexShader, fragment: material.fragmentShader});
    }
    receipts.push({aliases:program.aliases, materials:matches.length, targets:matches.map(material=>({uuid:material.uuid,name:material.name})), before:{vertexHash:program.before.vertexHash,fragmentHash:program.before.fragmentHash}, after:{vertexHash:program.after.vertexHash,fragmentHash:program.after.fragmentHash}});
  }
  if (changes.length === 0) throw new Error('Program loan is empty');
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const change of changes) {
      change.material.vertexShader = change.vertex; change.material.fragmentShader = change.fragment; change.material.needsUpdate = true;
    }
  };
  try {
    for (const change of changes) {
      const program = programs.find(row => row.aliases.includes(change.material.name));
      if (program === undefined) throw new Error('Program loan lost its source');
      change.material.vertexShader = program.after.vertex; change.material.fragmentShader = program.after.fragment; change.material.needsUpdate = true;
    }
  } catch (error) { restore(); throw error; }
  return {receipts, restore};
}

/** Observe actual native submissions, preserving arguments and receiver.
 * @param {import('./material-program-loan.mjs').ProgramDrawRenderer} renderer
 * @param {readonly import('./material-program-loan.mjs').ProgramLoanReceipt[]} receipts */
export function trackMaterialProgramDraws(renderer,receipts){
  const original=renderer.renderBufferDirect;
  /** @type {Map<string,string>} */
  const targets=new Map();
  /** @type {Map<string,number>} */
  const counts=new Map();
  for(const receipt of receipts)for(const target of receipt.targets){
    if(typeof target.uuid!=='string'||target.uuid.length===0||targets.has(target.uuid))throw new Error('Program draw target identity differs');
    targets.set(target.uuid,target.name);counts.set(target.name,0);
  }
  if(targets.size===0)throw new Error('Program draw tracking has no actual targets');
  /** @this {import('./material-program-loan.mjs').ProgramDrawRenderer} @param {...unknown} args */
  function draw(...args){
    const material=args[3];
    if(typeof material==='object'&&material!==null&&'uuid'in material&&typeof material.uuid==='string'){
      const name=targets.get(material.uuid);if(name!==undefined)counts.set(name,(counts.get(name)??0)+1);
    }
    return original.apply(this,args);
  }
  renderer.renderBufferDirect=draw;
  let restored=false;
  return {read:()=>Object.fromEntries(counts),restore:()=>{
    if(restored)return;
    if(renderer.renderBufferDirect!==draw)throw new Error('Program draw tracking lost its native owner');
    renderer.renderBufferDirect=original;restored=true;
  }};
}
