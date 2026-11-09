#!/usr/bin/env node
// Own the public loopback target until its first verified game release starts.
import { createServer } from 'node:http';

const channel = process.argv[2], port = Number(process.env.PORT);
if (!['production', 'staging'].includes(channel ?? '') || port !== (channel === 'production' ? 8790 : 8791)) throw new Error('Invalid health stub channel or port');
createServer((request, response) => {
  const health = request.method === 'GET' && request.url === '/health';
  response.writeHead(health ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(health ? JSON.stringify({ stub: true, channel, waiting: 'signed release' }) : '{}');
}).listen(port, '127.0.0.1');
