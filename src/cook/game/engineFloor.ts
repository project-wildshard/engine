// FORMAT-PRUNE FP47b (coordinator 2026-11-24, J505): a product names the lowest engine release that can draw it
// (`requires.engine`, format 0.1.0.6). The cook and a pin refuse a product whose floor is above this engine, so a
// shard built for a newer engine never lands on an older grid: the API places only what the channel's cook approved.
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {readFileSync} from 'node:fs';
import {engineFloorRefusal} from '@wildshard/format/engine-floor';

/** scripts/build-server.mjs: package.json's version in a server bundle; unset when the cook runs from the checkout. */
declare const __ENGINE_VERSION__: string | undefined;
let own: string | undefined;

/** This engine's release: the bundle's baked version, else package.json beside src/ (a release checkout names its tag). */
export function engineRelease(): string {
  if (typeof __ENGINE_VERSION__ === 'string') return __ENGINE_VERSION__;
  own ??= (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {version: string}).version;
  return own;
}

/** Throws when `index` needs a newer engine than `running` (this engine by default). */
export function checkEngineFloor(index: Readonly<{requires: Readonly<{engine?: string}>; identity: Readonly<{slug: string}>}>, running: string = engineRelease()): void {
  const refusal = engineFloorRefusal(index.requires.engine, running);
  if (refusal !== undefined) throw new Error(`${refusal}: ${index.identity.slug}`);
}
