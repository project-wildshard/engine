import { chromium } from 'playwright';

// Launched under browser-lane.sh: Chromium's ancestry holds exactly one machine-wide slot.
const server = await chromium.launchServer({ channel: 'chromium', headless: true,
  args: [`--use-angle=${process.argv[2] ?? 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio'] });
console.log(server.wsEndpoint());
process.stdin.resume();
await new Promise((resolve) => {
  process.stdin.once('end', resolve);
  process.once('SIGTERM', resolve);
  process.once('SIGINT', resolve);
});
await server.close();
