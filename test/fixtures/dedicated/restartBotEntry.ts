// Meta MACBOOK-WAITS MW5 (J504): built against the signed staging release's own engine source by `mmo-bots.mjs staging
// --restart-proof`. Prints `restart.ready` once every bot sits, so the parent asks for the restart only then.
import {writeFileSync} from 'node:fs';
import {botTarget, STAGING_SOCKET} from './mmoBotsGuard';
import {RoomBot} from './roomBot';
import {RestartRider} from './restartJourney';

const [url = '', build = '', bots = '', seconds = '', tag = '', result = '', addresses = 'own'] = process.argv.slice(2);
const {loopback, url: parsed} = botTarget(url, addresses, Number(bots));
if (!loopback && parsed.origin !== STAGING_SOCKET) throw new Error('Restart proof requires the public staging Tunnel');
if (!Number.isInteger(Number(bots)) || Number(bots) < 1 || Number(bots) > 4 || addresses !== 'own' || !/^[a-f0-9]{40}$/u.test(build)
  || !/^[a-z0-9-]{1,16}$/u.test(tag) || !Number.isFinite(Number(seconds)) || Number(seconds) < 60 || Number(seconds) > 900 || result === '')
  throw new Error('Restart proof needs 1 to 4 ordinary clients, 60 to 900 seconds and a signed-release identity');
const connect = (index: number) => (): RoomBot => {
  const device = `device:restart-${tag}-${String(index)}`, name = `Agent ${tag}-${String(index)}`;
  if (loopback) return new RoomBot(url, build, device, name);
  const Native = globalThis.WebSocket;
  globalThis.WebSocket = class extends Native {constructor(at: string | URL) {
    super(at, {headers: {origin: 'https://staging.wildshard.io'}} as unknown as string[]);
  }};
  try {return new RoomBot(url, build, device, name);}
  finally {globalThis.WebSocket = Native;}
};
const started = performance.now(), deadline = started + Number(seconds) * 1000;
const riders = Array.from({length: Number(bots)}, (_, index) => new RestartRider(connect(index), index, index === 0));
let report: Record<string, unknown>;
try {
  await Promise.all(riders.map(async rider => {await rider.seat(30_000);}));
  console.log(JSON.stringify({at: 'restart.ready', bots: riders.length, ms: Math.round(performance.now() - started)}));
  const rides = await Promise.all(riders.map(async rider => await rider.rideThrough(deadline)));
  const fight = rides.find(ride => ride.fight !== null)?.fight ?? null;
  report = {version: 1, proof: 'mw5-restart-under-bots', complete: rides.every(ride => ride.ok), signedReleaseBuild: build, url,
    elapsedMs: Math.round(performance.now() - started), limitSeconds: Number(seconds),
    heardCountdown: rides.every(ride => ride.countdowns.length > 0), toldRestart: rides.every(ride => ride.closed === 'restart'),
    allBack: rides.every(ride => ride.backMs !== null), worstMovedMeters: Math.max(...rides.map(ride => ride.movedMeters ?? Number.POSITIVE_INFINITY)),
    ownedKept: rides.every(ride => ride.ownedKept === true), fightReset: fight?.reset ?? null, rides};
} catch (error) {
  report = {version: 1, proof: 'mw5-restart-under-bots', complete: false, signedReleaseBuild: build, url,
    elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), rides: riders.map(rider => rider.ride)};
} finally {
  await Promise.allSettled(riders.map(async rider => {await rider.leave();}));
}
writeFileSync(result, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({at: 'restart.done', complete: report['complete']}));
process.exit(report['complete'] === true ? 0 : 1);
