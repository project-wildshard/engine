// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- This proof launches owned fake CLI processes over a Unix socket.
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths for the fake executables.
import {join} from 'node:path';
import {expect, test, vi} from 'vitest';
import {ownSimulatorHid} from '../src/scripts/staging-qa-idb.mjs';

test('a dead touch companion is replaced on a fresh private socket', async () => {
  const dir = mkdtempSync('/tmp/ws-hid-fixture-');
  const trace = join(dir, 'connections');
  writeFileSync(trace, '');
  writeFileSync(join(dir, 'idb_companion'), `#!/usr/bin/env node
const {appendFileSync, readFileSync} = require('node:fs');
const {createServer} = require('node:net');
const socket = process.argv[process.argv.indexOf('--grpc-domain-sock') + 1];
const trace = process.env.WS_HID_TEST_TRACE;
const first = readFileSync(trace, 'utf8') === '';
appendFileSync(trace, socket + '\\n');
createServer(client => {
  client.once('data', () => {
    if (first) process.exit(1);
    client.end('touch received');
  });
}).listen(socket);
`, {mode: 0o700});
  writeFileSync(join(dir, 'idb'), `#!/usr/bin/env node
const {connect} = require('node:net');
const socket = process.argv[process.argv.indexOf('--companion') + 1];
const client = connect(socket, () => client.write('touch'));
let answer = '';
client.on('data', chunk => { answer += chunk; });
client.once('end', () => process.exit(answer === 'touch received' ? 0 : 1));
client.once('error', () => process.exit(1));
`, {mode: 0o700});
  vi.stubEnv('PATH', `${dir}:${process.env['PATH'] ?? ''}`);
  vi.stubEnv('WS_HID_TEST_TRACE', trace);
  const hid = ownSimulatorHid('owned-fixture-device');
  try {
    await hid.tapOrSwipe(['tap', '1', '2']);
    const sockets = readFileSync(trace, 'utf8').trim().split('\n');
    expect(sockets).toHaveLength(2);
    expect(sockets[0]).not.toBe(sockets[1]);
    await hid.close();
    expect(sockets.some(existsSync)).toBe(false);
  } finally {
    await hid.close();
    vi.unstubAllEnvs();
    rmSync(dir, {recursive: true, force: true});
  }
});
