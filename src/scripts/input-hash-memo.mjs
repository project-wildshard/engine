// Exact input hashing and immutable phase evidence; no recorded-bake execution.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,realpathSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,resolve,sep} from 'node:path';

/** A run-scoped digest memo. Every hit checks nanosecond timestamps, inode,
 * device and size; restoring mtime alone cannot conceal an input edit.
 * The optional disk memo is only an optimization and malformed entries miss. */
export class InputHashMemo {
  /** @type {Map<string,{stamp:string,digest:string}>} */
  entries = new Map();
  /** @type {Map<string,string>} */
  frozen = new Map();
  /** @type {Map<string,string[]>} */
  trees = new Map();
  /** @type {((file:string)=>boolean)|undefined} */
  ignored;
  reads = 0;
  /** @param {string} root @param {string} [file] */
  constructor(root, file) {
    this.root = realpathSync.native(root); this.file = file;
    if (file !== undefined) try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved?.schema === 'input-hashes/1' && Array.isArray(saved.entries)) for (const row of saved.entries) {
        if (Array.isArray(row) && row.length === 3 && row.every(value => typeof value === 'string') && /^[a-f0-9]{64}$/u.test(row[2])) this.entries.set(row[0], {stamp:row[1],digest:row[2]});
      }
    } catch { /* Missing or malformed memo hashes the real input. */ }
  }
  get snapshot() { return this.ignored !== undefined; }
  /** Freeze authored inputs for one phase. Generated files remain live. A cold
   * producer verifies its exact inputs before publication; the whole phase
   * verifies every frozen byte and inventory before allowing a build.
   * @param {(file:string)=>boolean} ignore */
  enableSnapshot(ignore) { this.ignored=ignore; }
  /** @param {string} path @param {boolean} [fresh] */
  hash(path, fresh = false) {
    if (isAbsolute(path) || path.includes('\\') || path.split('/').some(part=>part==='' || part==='.' || part==='..')) throw new Error(`Invalid bake input path ${path}`);
    const frozen=this.frozen.get(path);
    if(!fresh && frozen!==undefined) return frozen;
    const at = resolve(this.root, path), stat = lstatSync(at, {bigint:true});
    if (!stat.isFile() || !realpathSync.native(at).startsWith(this.root+sep)) throw new Error(`Invalid bake input ${path}`);
    const stamp = [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
    const seen = this.entries.get(path);
    const digest = seen?.stamp === stamp ? seen.digest : createHash('sha256').update(readFileSync(at)).digest('hex');
    if(seen?.stamp !== stamp) {
      this.reads++;
      // Fence actual reads against concurrent writes. A memo hit has already
      // checked the current file identity and performs no content read.
      const after = lstatSync(at, {bigint:true});
      if (!after.isFile() || [after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':') !== stamp) throw new Error(`Bake input changed while hashing: ${path}`);
    }
    this.entries.set(path, {stamp,digest});
    if(!fresh && this.ignored!==undefined && !this.ignored(path))this.frozen.set(path,digest);
    return digest;
  }
  /** Cache source inventories, omitting known generated files from folder
   * traversal. An explicit generated-file root is still a live input.
   * @param {string} path @param {boolean} [fresh] @param {boolean} [nested] @returns {string[]} */
  paths(path,fresh=false,nested=false) {
    if(isAbsolute(path)||path.includes('\\')||path.split('/').some(part=>part===''||part==='.'||part==='..'))throw new Error(`Invalid bake input path ${path}`);
    if(nested && this.ignored?.(path))return [];
    const cached=this.trees.get(path);if(!fresh && cached!==undefined)return cached;
    const at=resolve(this.root,path),stat=lstatSync(at);
    if(stat.isSymbolicLink() || !realpathSync.native(at).startsWith(this.root+sep))throw new Error(`Invalid bake input ${path}`);
    if(stat.isFile())return [path];
    if(!stat.isDirectory())throw new Error(`Invalid bake input ${path}`);
    const files=readdirSync(at).sort().filter(name=>name!=='node_modules'&&name!=='.git').flatMap(name=>this.paths(`${path}/${name}`,fresh,true));
    if(!fresh)this.trees.set(path,files);return files;
  }
  /** @param {Record<string,string>} inputs */
  verifyInputs(inputs) {
    for(const [path,expected] of Object.entries(inputs))if(this.hash(path,true)!==expected)throw new Error(`Generation input changed: ${path}`);
  }
  verifySnapshot() {
    if(!this.snapshot)return;
    this.verifyInputs(Object.fromEntries(this.frozen));
    /** @type {string[]} */
    const roots=[];
    for(const path of [...this.trees.keys()].sort((a,b)=>a.length-b.length||a.localeCompare(b))) {
      if(roots.some(parent=>path.startsWith(`${parent}/`)))continue;
      if(JSON.stringify(this.paths(path,true))!==JSON.stringify(this.trees.get(path)))throw new Error(`Generation source inventory changed: ${path}`);
      roots.push(path);
    }
  }
  /** Exact source evidence for a completed immutable phase. */
  snapshotData() {
    if(!this.snapshot)throw new Error('Generation source snapshot is not enabled');
    this.verifySnapshot();
    /** @type {Record<string,string[]>} */
    const trees={};
    for(const path of [...this.trees.keys()].sort((a,b)=>a.length-b.length||a.localeCompare(b))) {
      if(Object.keys(trees).some(parent=>path.startsWith(`${parent}/`)))continue;
      trees[path]=this.trees.get(path) ?? [];
    }
    return {inputs:Object.fromEntries(this.frozen),trees};
  }
  flush() {
    if (this.file === undefined) return;
    try { mkdirSync(dirname(this.file), {recursive:true}); writeFileSync(this.file, JSON.stringify({schema:'input-hashes/1',entries:[...this.entries].map(([path,row])=>[path,row.stamp,row.digest])})); }
    catch { /* A failed optimization never changes the generation verdict. */ }
  }
}

/** Exact regular-file SHA256 input map shared by asset jobs and recorded bakes. Missing files refuse generation.
 * @param {string} root @param {Iterable<string>} paths @param {InputHashMemo} [memo] @returns {Record<string,string>} */
export function bakeInputHashes(root, paths, memo = new InputHashMemo(root)) {
  if (memo.root !== realpathSync.native(root)) throw new Error('Crossed input hash memo root');
  return Object.fromEntries([...new Set(paths)].sort().map(path => [path,memo.hash(path)]));
}
