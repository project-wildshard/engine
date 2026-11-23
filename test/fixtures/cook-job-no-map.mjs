// MAP-NEXT MN5: a cook job that reports a good cook but drew no map (the warn path before be98df0ba7). The worker must refuse to
// publish it. Arguments as `runJob` passes them: <tarball> <out> [slug].
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [tarball = '', out = '', slug = 'sunscar-dunes'] = process.argv.slice(2);
const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
mkdirSync(join(out, 'client', 'shardfiles', slug), {recursive: true}); mkdirSync(join(out, 'server'), {recursive: true});
writeFileSync(join(out, 'client', 'shardfiles', slug, 'shard.json'), '{}');
const header = `shardfiles/${slug}/shard.json`;
console.log(JSON.stringify({slug, hash, proof: 'unmeasured', check: {pass: true}, header, seconds: 0,
  server: {url: '', index: '', wireBytes: 0, files: 0},
  cook: {slug, seconds: 0, manifests: [], loose: [], parts: {count: 0, rawBytes: 0, wireBytes: 0}, server: undefined}}));
