import type {SaveFixture} from '../debug-settings.mjs';
/** A real saved Developer choice, applied by the existing fixture transport. */
export function parseSaveFixture(text: string | undefined): SaveFixture | undefined {
  if (text === undefined) return undefined;
  if (text.length > 16384 || new TextEncoder().encode(text).length > 16384) throw new Error('Save fixture exceeds 16 KiB');
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid save fixture');
  const scope: unknown = Reflect.get(value, 'scope'), key: unknown = Reflect.get(value, 'key');
  const merge: unknown = Reflect.get(value, 'merge'), once: unknown = Reflect.get(value, 'once');
  if ((scope !== 'device' && scope !== 'session' && scope !== 'global') || typeof key !== 'string'
    || !/^[a-z][a-zA-Z0-9._:-]{0,127}$/u.test(key) || ['constructor', 'prototype'].includes(key)
    || !Object.hasOwn(value, 'data') || merge !== undefined && typeof merge !== 'boolean'
    || once !== undefined && (typeof once !== 'string' || once.length === 0 || once.length > 128)
    || Object.keys(value).some(name => !['scope', 'key', 'data', 'merge', 'once'].includes(name))) throw new Error('Invalid save fixture');
  const data: unknown = Reflect.get(value, 'data');
  if (merge === true && (typeof data !== 'object' || data === null || Array.isArray(data))) throw new Error('Merged save fixture requires an object');
  return { scope, key, data, ...(merge === undefined ? {} : {merge}), ...(once === undefined ? {} : {once}) };
}
