import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// E7.3d: a folder as an origin on loopback, stored `.br` and all, as a bucket answers. `node packProof.mjs <folder> <port>`.
const [folder = '.', port = '18791'] = process.argv.slice(2);
createServer((request, response) => {
  readFile(join(folder, new URL(request.url ?? '/', 'http://origin').pathname)).then(bytes => { response.writeHead(200).end(bytes); }, () => { response.writeHead(404).end(); });
}).listen(Number(port), '127.0.0.1', () => { console.info(JSON.stringify({ at: 'origin.listening', port })); });
