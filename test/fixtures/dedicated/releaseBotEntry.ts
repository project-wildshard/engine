// Meta MACBOOK-WAITS MW5 (J504, EG-33): built against the signed staging release's own engine source by `mmo-bots.mjs staging
// --release-proof`. The bots sit for hours and ride the next staging release (Jake 2026-11-24: "Bots ride the next release").
// Prints `release.seated` once every bot sits, `release.countdown` when the first hears one, and `release.holding` each half hour.
import {writeFileSync} from 'node:fs';
import {botTarget, STAGING_SOCKET} from './mmoBotsGuard';
import {RoomBot} from './roomBot';
import {ReleaseRider} from './releaseJourney';

const [url = '', build = '', bots = '', seconds = '', tag = '', result = '', addresses = 'own'] = process.argv.slice(2);
const {loopback, url: parsed} = botTarget(url, addresses, Number(bots));
if (!loopback && parsed.origin !== STAGING_SOCKET) throw new Error('Release proof requires the public staging Tunnel');
if (!Number.isInteger(Number(bots)) || Number(bots) < 1 || Number(bots) > 4 || addresses !== 'own' || !/^[a-f0-9]{40}$/u.test(build)
  || !/^[a-z0-9-]{1,16}$/u.test(tag) || !Number.isFinite(Number(seconds)) || Number(seconds) < 60 || Number(seconds) > 50_400 || result === '')
  throw new Error('Release proof needs 1 to 4 ordinary clients, 60 to 50,400 seconds and a signed-release identity');
const connect = (index: number) => (): RoomBot => {
  const device = `device:release-${tag}-${String(index)}`, name = `Agent ${tag}-${String(index)}`;
  if (loopback) return new RoomBot(url, build, device, name);
  const Native = globalThis.WebSocket;
  globalThis.WebSocket = class extends Native {constructor(at: string | URL) {
    super(at, {headers: {origin: 'https://staging.wildshard.io'}} as unknown as string[]);
  }};
  try {return new RoomBot(url, build, device, name);}
  finally {globalThis.WebSocket = Native;}
};
const started = performance.now(), deadline = started + Number(seconds) * 1000;
const riders = Array.from({length: Number(bots)}, (_, index) => new ReleaseRider(connect(index), index, index === 0));
const elapsed = (): number => Math.round(performance.now() - started);
let report: Record<string, unknown>, said = false;
const holding = setInterval(() => {
  console.log(JSON.stringify({at: 'release.holding', ms: elapsed(), seated: riders.filter(rider => rider.seated()).length,
    reseats: riders.reduce((sum, rider) => sum + rider.ride.reseats.length, 0)}));
}, 1_800_000);
try {
  await Promise.all(riders.map(async rider => {await rider.seat(30_000);}));
  console.log(JSON.stringify({at: 'release.seated', bots: riders.length, ms: elapsed()}));
  const rides = await Promise.all(riders.map(async rider => await rider.hold(deadline, ride => {
    if (said) return;
    said = true;
    console.log(JSON.stringify({at: 'release.countdown', bot: ride.bot, ms: elapsed(), said: ride.countdowns[0]}));
  })));
  const fight = rides.find(ride => ride.fight !== null)?.fight ?? null;
  const builds = [...new Set(rides.flatMap(ride => ride.countdowns.map(countdown => countdown.build)))];
  const heardCountdown = rides.every(ride => ride.countdowns.length > 0);
  report = {version: 1, proof: 'mw5-release-under-bots', complete: heardCountdown && rides.every(ride => ride.ok), signedReleaseBuild: build, url,
    elapsedMs: elapsed(), limitSeconds: Number(seconds), heardCountdown, countdownBuilds: builds,
    firstCountdownSeconds: Math.max(0, ...rides.map(ride => ride.countdowns[0]?.seconds ?? 0)),
    toldRestart: rides.every(ride => ride.closed === 'restart'), allBack: rides.every(ride => ride.backMs !== null),
    worstMovedMeters: Math.max(...rides.map(ride => ride.movedMeters ?? Number.POSITIVE_INFINITY)),
    ownedKept: rides.every(ride => ride.ownedKept === true), fightReset: fight?.reset ?? null,
    reseats: rides.reduce((sum, ride) => sum + ride.reseats.length, 0), rides};
} catch (error) {
  report = {version: 1, proof: 'mw5-release-under-bots', complete: false, signedReleaseBuild: build, url,
    elapsedMs: elapsed(), error: error instanceof Error ? error.message : String(error), rides: riders.map(rider => rider.ride)};
} finally {
  clearInterval(holding);
  await Promise.allSettled(riders.map(async rider => {await rider.leave();}));
}
writeFileSync(result, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({at: 'release.done', complete: report['complete']}));
process.exit(report['complete'] === true ? 0 : 1);
