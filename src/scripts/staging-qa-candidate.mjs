// SQ6: serve the checked candidate under the staging origin, including service-worker requests.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createProxy, request } from 'node:http';
import { createServer as createTls } from 'node:https';
import { connect } from 'node:net';
import { join } from 'node:path';
import { API_ORIGIN, CHANNELS, CHECKED_DOCUMENTS, PACKS_ORIGIN, RELEASE_PUBLIC_KEY } from './page-release/flow.mjs';
import { isVersionUrl, WORKERS } from './page-release/hosts/workers.mjs';
import { childListener, listenLoopback } from './rig-listeners.mjs';
import { readPublication } from './server-release/sign.mjs';
import { certificateSpki } from './staging-qa-browser.mjs';

const { origin, release, socket } = CHANNELS.staging;
const staging = new URL(origin).hostname;
const rooms = new URL(socket).hostname;
const passThrough = new Set([
  rooms, new URL(release).hostname, new URL(API_ORIGIN).hostname, new URL(PACKS_ORIGIN).hostname,
  'cooked.wildshard.io', // PV25: the checked staging page reads versioned zone packs here.
]);
const loopback = '127.0.0.1';
const fetchUnrouted = globalThis.fetch.bind(globalThis);

/** Route the checked staging origin to the preview and allow its public dependencies over TLS.
 * @param {string} authority @param {number} tlsPort */
export function candidateTunnelTarget(authority, tlsPort) {
  const host = authority.replace(/:443$/u, '');
  if (authority !== `${host}:443` || (host !== staging && !passThrough.has(host))) return undefined;
  return host === staging ? { host: loopback, port: tlsPort } : { host, port: 443 };
}

/** @param {string} url */
async function readPublic(url) {
  const response = await fetchUnrouted(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('The candidate or its staging inputs could not be read');
  return Buffer.from(await response.arrayBuffer());
}

/** @param {Buffer} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** @param {string} build */
async function readStagingInputs(build) {
  const [alias, signed] = await Promise.all([readPublic(`${origin}/version.json`), readPublic(release)]);
  const aliasBuild = JSON.parse(alias.toString('utf8')).build;
  const channel = readPublication(signed.toString('utf8'), RELEASE_PUBLIC_KEY);
  if (typeof aliasBuild !== 'string' || !/^[0-9a-f]{40}$/u.test(aliasBuild) || aliasBuild === build) {
    throw new Error('The public staging alias must still serve the previous build');
  }
  if (channel.channel !== 'staging' || channel.engineBuild !== build) throw new Error('Signed staging rooms do not serve the candidate build');
  return { aliasBuild, serial: channel.serial };
}

/** @param {{ root: string, out: string, candidate: string, build: string }} options */
export async function openQaCandidate({ root, out, candidate, build }) {
  const dist = join(root, 'dist');
  const { check } = JSON.parse(readFileSync(join(root, 'tmp', 'page-release', `staging-${build}.json`), 'utf8'));
  const deploymentId = check?.deployment?.id;
  if (check?.build !== build || check?.channel !== 'staging' || check?.deployment?.url !== candidate ||
      typeof deploymentId !== 'string' || !isVersionUrl(candidate, deploymentId, WORKERS.staging.worker)) {
    throw new Error('Candidate QA requires the exact Worker version URL from a completed staging check');
  }
  const before = await readStagingInputs(build);
  if (check.serial !== before.serial) throw new Error('Staging rooms moved after the candidate check');
  await Promise.all(CHECKED_DOCUMENTS.map(async name => {
    if (sha256(await readPublic(`${candidate}/${name}`)) !== sha256(readFileSync(join(dist, name)))) {
      throw new Error(`The Worker and the local candidate differ at ${name}`);
    }
  }));
  const transport = await candidateTransport(root, out, dist);
  return { ...transport, deploymentId, deploymentUrl: candidate, ...before, verify: async () => {
    const after = await readStagingInputs(build);
    if (after.aliasBuild !== before.aliasBuild || after.serial !== before.serial) throw new Error('Staging changed during candidate QA');
    if (transport.stats.pageReads === 0 || transport.stats.roomTunnels === 0) throw new Error('Candidate QA did not serve the candidate page and reach staging rooms');
  } };
}

/** @param {import('node:net').Server} server */
async function closeServer(server) {
  if (server.listening) await new Promise(resolve => { server.close(() => { resolve(undefined); }); });
}

/** @param {string} root @param {string} out @param {string} dist */
async function candidateTransport(root, out, dist) {
  const keys = mkdtempSync(join(out, 'candidate-cert-'));
  const config = join(keys, 'cert.conf'), key = join(keys, 'site.key'), pem = join(keys, 'site.pem');
  /** @type {Set<import('node:stream').Duplex>} */
  const sockets = new Set();
  /** @param {import('node:stream').Duplex} stream */
  function track(stream) {
    sockets.add(stream);
    stream.once('close', () => { sockets.delete(stream); });
    stream.on('error', () => { stream.destroy(); });
    return stream;
  }
  const stats = { pageReads: 0, roomTunnels: 0 };
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let preview;
  /** @type {import('node:https').Server | undefined} */
  let tls;
  /** @type {import('node:http').Server | undefined} */
  let proxy;

  async function close() {
    for (const stream of sockets) stream.destroy();
    try {
      if (proxy !== undefined) await closeServer(proxy);
      if (tls !== undefined) await closeServer(tls);
      if (preview?.pid !== undefined && preview.exitCode === null && preview.signalCode === null) {
        const exited = once(preview, 'exit');
        const timer = setTimeout(() => { preview?.kill('SIGKILL'); }, 5000);
        preview.kill('SIGTERM');
        try { await exited; } finally { clearTimeout(timer); }
      }
    } finally { rmSync(keys, { recursive: true, force: true }); }
  }

  try {
    writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${staging}\n[ext]\nsubjectAltName=DNS:${staging}\n`);
    const signed = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', key, '-out', pem],
      { stdio: 'ignore', timeout: 15_000 });
    if (signed.status !== 0) throw new Error('Could not create the owned candidate browser certificate');
    const cert = readFileSync(pem);
    preview = spawn(process.execPath, ['src/scripts/preview-server.mjs', '--outDir', dist, '--port', '0', '--telemetry-dir', join(out, 'telemetry')],
      { cwd: root, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const port = await childListener(preview, 'preview-ready');
    tls = createTls({ key: readFileSync(key), cert }, (incoming, response) => {
      if (incoming.headers.host !== staging || (incoming.method !== 'GET' && incoming.method !== 'HEAD')) {
        response.writeHead(405).end();
        return;
      }
      stats.pageReads++;
      const upstream = request({ hostname: loopback, port, path: incoming.url, method: incoming.method, headers: incoming.headers }, reply => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      });
      response.once('close', () => { upstream.destroy(); });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      upstream.end();
    });
    tls.on('connection', stream => { track(stream); });
    const tlsPort = await listenLoopback(tls);

    proxy = createProxy((_incoming, response) => { response.writeHead(403).end(); });
    proxy.on('connection', stream => { track(stream); });
    proxy.on('connect', (incoming, client, head) => {
      const target = candidateTunnelTarget(incoming.url ?? '', tlsPort);
      if (target === undefined) {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = track(connect(target));
      upstream.once('connect', () => {
        if (client.destroyed) { upstream.destroy(); return; }
        if (target.host === rooms) stats.roomTunnels++;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
      client.once('close', () => { upstream.destroy(); });
      upstream.once('close', () => { client.destroy(); });
    });
    const proxyPort = await listenLoopback(proxy);
    return { server: `http://${loopback}:${proxyPort}`, preview: `http://${loopback}:${port}`, chromiumSPKI: certificateSpki(cert), stats, close };
  } catch (error) {
    await close();
    throw error;
  }
}
