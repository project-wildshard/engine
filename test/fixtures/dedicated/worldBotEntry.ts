import { RoomBot } from './roomBot';

// E7.2a: the real door, from outside the room: a bot on the wrong build, then one on the right build that walks. It prints what it saw, and what `/health` said after each.
const [base = 'ws://127.0.0.1:8790', build = 'dev', secondsArg = '3'] = process.argv.slice(2), seconds = Number(secondsArg);
const health = async (): Promise<unknown> => (await fetch(`${base.replace(/^ws/u, 'http')}/health`)).json();
const wrong = new RoomBot(`${base}/`, 'an-old-build', 'device:stale');
const refused = await wrong.ended(), afterWrong = await health();
wrong.drop();
const right = new RoomBot(`${base}/`, build, 'device:walker', 'Walker');
right.thumb = tick => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: tick / 90, pitch: 0, buttons: 0 });
const arrived = await right.arrived(60_000);
const frame = right.client.latest, start = frame === null ? null : Number(right.client.owner(frame)['px']);
await new Promise(resolve => { setTimeout(resolve, seconds * 1000); });
const last = right.client.latest, moved = last === null ? null : Number(right.client.owner(last)['px']), afterRight = await health();
console.log(JSON.stringify({ refused, afterWrong, arrived, resume: right.resume, start, moved, afterRight, closed: right.closed, node: process.version, platform: process.platform }));
right.drop();
process.exit(0);
