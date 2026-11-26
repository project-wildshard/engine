// Passive WebKit resource-usage categories; no heap collection or pressure notification.
import { setTimeout as sleep } from 'node:timers/promises';

const types = new Set(['javascript', 'jit', 'images', 'layers', 'page', 'other']);
export async function memoryCategories(inspector, wait = sleep) {
  const samples = [], errors = [];
  const off = inspector.on('Memory.trackingUpdate', params => {
    const event = params?.event;
    if (!Number.isFinite(event?.timestamp) || !Array.isArray(event.categories) || event.categories.length !== types.size
      || new Set(event.categories.map(c => c.type)).size !== types.size
      || event.categories.some(c => !types.has(c.type) || !Number.isFinite(c.size) || c.size < 0)) {
      errors.push('Invalid WebKit memory category event'); return;
    }
    samples.push(event);
  });
  let enabled = false, started = false;
  try {
    await inspector.send('Memory.enable'); enabled = true;
    await inspector.send('Memory.startTracking'); started = true;
    await wait(2500);
  } catch (error) { errors.push(String(error)); }
  finally {
    if (started) await inspector.send('Memory.stopTracking').catch(error => errors.push(String(error)));
    if (enabled) await inspector.send('Memory.disable').catch(error => errors.push(String(error)));
    off();
  }
  return { protocol: 'Passive Memory.trackingUpdate after original WC/GL samples, no GC. Engine categories, not a JS heap snapshot; external payload may be included. Unsupported/errors are preserved.', samples, errors };
}
