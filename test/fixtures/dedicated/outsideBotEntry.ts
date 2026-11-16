// TC45: built against the signed staging release's own engine source.
import {writeFileSync} from 'node:fs';
import {botTarget, STAGING_SOCKET} from './mmoBotsGuard';
import {RoomBot} from './roomBot';
import {outsideJourney} from './outsideJourney';

const [url = '', build = '', bots = '', seconds = '', tag = '', result = '', addresses = 'own'] = process.argv.slice(2);
const {loopback, url: parsed} = botTarget(url, addresses, Number(bots));
if (!loopback && parsed.origin !== STAGING_SOCKET) throw new Error('Outside entry requires the public staging Tunnel');
if (Number(bots) !== 1 || addresses !== 'own' || !/^[a-f0-9]{40}$/u.test(build) || !/^[a-z0-9-]{1,16}$/u.test(tag) ||
  !Number.isFinite(Number(seconds)) || Number(seconds) < 5 || Number(seconds) > 120 || result === '')
  throw new Error('Outside proof needs one ordinary client and a bounded signed-release identity');
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => {abort.abort(new Error(signal));});
const connect = (): RoomBot => {
  if (loopback) return new RoomBot(url, build, `device:outside-${tag}`, `Agent ${tag}`);
  const Native = globalThis.WebSocket;
  globalThis.WebSocket = class extends Native {constructor(at: string | URL) {
    super(at, {headers: {origin: 'https://staging.wildshard.io'}} as unknown as string[]);
  }};
  try {return new RoomBot(url, build, `device:outside-${tag}`, `Agent ${tag}`);}
  finally {globalThis.WebSocket = Native;}
};
const started = performance.now();
try {
  const report = {...await outsideJourney(connect, Number(seconds) * 1000, abort.signal), proof: 'tc45-outside-staging', signedReleaseBuild: build, url,
    elapsedMs: Math.round(performance.now() - started), limitSeconds: Number(seconds)};
  writeFileSync(result, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} catch (error) {
  const report = {version: 1, complete: false, proof: 'tc45-outside-staging', signedReleaseBuild: build, url,
    elapsedMs: Math.round(performance.now() - started), limitSeconds: Number(seconds), error: error instanceof Error ? error.message : String(error)};
  writeFileSync(result, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report)); process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
