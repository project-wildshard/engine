#!/usr/bin/env node
// REMOTE-PLAYERS RP5 (Jake, 2026-11-12 17:43: "they need a sword ... I don't see his sword and stuff"), on the rig of
// `remote-body-proof.mjs`: two phones in one room, Jimmy 2.5 m in front of Jake. On Driftwood Jimmy holds his wooden sword and
// tries the iron one; on Nalati his bow, then the sabre and back; on Pine Hollow his crossbow, and tries the longbow. It fails unless Jake's page draws, each time, the item Jimmy's row holds (`__onlinePlayers()` names its row) in
// Jimmy's hand, built from the very geometry Jake's own first-person view draws for that row, at a hand-held size and off the
// ground, and nothing else in his hands. (Driftwood's and Nalati's kits have no slot map: since opus-slotsync a page swaps them
// by its kit's order, `kitSlots`, so the switch reaches the server.)
//   scripts/browser-lane.sh --max 15 node scripts/remote-held-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>] [--legs=driftwood,nalati]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-held-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>] [--legs=driftwood,nalati]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '', shots = join(work, 'shots-remote-held'), AWAY = 2.5;
/** Each room: its shard, the row Jimmy starts with and its hand, and the row he switches to and back from. Driftwood's iron
 *  sword and Pine's longbow are a quest's: a fresh Jimmy doesn't own them, the server keeps what he holds, and the swap is
 *  skipped with what the server said (`net-remote-held-swap.test.ts` earns the iron sword and swaps it). Nalati's arms are his.
 *  `--legs=driftwood,nalati` runs only those rooms. */
const ALL = [{ shard: 'driftwood-isle', first: /^weapon\.sword$/u, hand: 'right', other: /iron/u }, { shard: 'nalati-grasslands', first: /bow/u, hand: 'left', other: /sabre/u },
  { shard: 'pine-hollow', first: /crossbow/u, hand: 'right', other: /longbow/u }];
const picked = process.argv.find(value => value.startsWith('--legs='))?.slice('--legs='.length).split(',') ?? [];
const LEGS = picked.length === 0 ? ALL : ALL.filter(leg => picked.some(name => leg.shard.startsWith(name)));
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };

const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** Face a spot, the eye tipped down onto a body's middle. @param {import('playwright').Page} page @param {{ x: number, z: number }} at */
const face = (page, at) => page.evaluate(([x, z]) => { const { player } = /** @type {any} */ (window).__wildshard.world; const away = Math.hypot(x - player.position.x, z - player.position.z); player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -Math.atan2(0.6, Math.max(1, away)); }, [at.x, at.z]);
/** @param {import('playwright').Page} page @param {number} forward */
const walk = (page, forward) => page.evaluate(y => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; }, forward);
/** Jimmy's kit as his page holds it: the row in hand, and every row the server has a slot for. @param {import('playwright').Page} page */
const kitOf = page => page.evaluate(() => {
  const { player, game } = /** @type {any} */ (window).__wildshard.world, equipment = game.app.equipment, slots = player.link?.slots ?? new Map();
  return { current: String(equipment.current.row.id), rows: equipment.list.map((/** @type {any} */ weapon) => ({ id: String(weapon.id), row: String(weapon.row.id), slot: slots.get(weapon.row.id) ?? null })) };
});
/** Jimmy swaps to `id` (a weapon of his kit), as his swap key does. @param {import('playwright').Page} page @param {string} id */
const swap = (page, id) => page.evaluate(to => { const equipment = /** @type {any} */ (window).__wildshard.world.game.app.equipment; equipment.unlock(to); equipment.select(to); }, id);
/** What Jake's page drew in Jimmy's hands: his shown row, each hand's held item (its parts, their world size, and whether each
 *  part is the very geometry Jake's own first-person view draws for that row). @param {import('playwright').Page} page */
const hands = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy') ?? null;
  const group = w.__wildshard.world.game.rootScene.getObjectByName('Player · Jimmy');
  if (group === undefined || shown === null) return { shown, right: [], left: [] };
  group.updateMatrixWorld(true);
  const own = /** @type {ArrayLike<number>[]} */ ([]), look = w.__wildshard.world.game.app.equipment.heldLook?.(shown.item);
  look?.model?.traverse?.((/** @type {any} */ node) => { if (node.isMesh === true) own.push(node.geometry.attributes.position.array); });
  /** Whether a part's vertices are one of Jake's own first-person parts' (each hand holds its kit's copy). @param {ArrayLike<number>} array */
  const ownPart = array => own.some(other => other.length === array.length && Array.prototype.every.call(other, (/** @type {number} */ value, /** @type {number} */ index) => value === array[index]));
  /** @param {string} mount */
  const held = mount => (group.getObjectByName(mount)?.children ?? []).filter((/** @type {any} */ node) => node.name === 'HeldItem').map((/** @type {any} */ item) => {
    const box = item.position.clone(), parts = /** @type {{ name: string, own: boolean }[]} */ ([]);
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    item.traverse((/** @type {any} */ node) => {
      if (node.isMesh !== true) return;
      parts.push({ name: node.name, own: ownPart(node.geometry.attributes.position.array) });
      node.geometry.computeBoundingBox();
      const { min, max } = node.geometry.boundingBox;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        box.set(x, y, z).applyMatrix4(node.matrixWorld);
        box.toArray().forEach((/** @type {number} */ value, /** @type {number} */ axis) => { bounds.min[axis] = Math.min(bounds.min[axis] ?? value, value); bounds.max[axis] = Math.max(bounds.max[axis] ?? value, value); });
      }
    });
    const size = bounds.max.map((value, axis) => value - (bounds.min[axis] ?? 0));
    return { visible: item.visible, parts, length: Math.max(...size), lowest: (bounds.min[1] ?? 0) - group.position.y };
  });
  return { shown: { held: shown.held, item: shown.item, model: shown.model }, right: held('RightHandMount'), left: held('LeftHandMount') };
});
/** Wait until Jake's page draws Jimmy holding `row`. @param {import('playwright').Page} page @param {string} row */
const drawn = async (page, row) => { for (let i = 0; i < 40; i++) { const seen = await hands(page); if (seen.shown?.item === row) return seen; await page.waitForTimeout(150); } return hands(page); };
/** One item drawn right: Jimmy's row, in `hand`, Jake's own first-person parts (no hands or sleeves), at a held size, nothing
 *  else held. @param {Awaited<ReturnType<typeof hands>>} seen @param {string} row @param {string} hand */
const holds = (seen, row, hand) => {
  const items = [...seen.right, ...seen.left], [item] = hand === 'left' ? seen.left : seen.right;
  return seen.shown?.item === row && items.length === 1 && item !== undefined && item.visible && item.parts.length > 0 && item.parts.every((/** @type {{ name: string, own: boolean }} */ part) => part.own && !/hand|sleeve|fist/u.test(part.name)) && item.length > 0.25 && item.length < 1.8 && item.lowest > 0.05;
};
/** The slot the server says Jimmy holds, as his own page last heard it. @param {import('playwright').Page} page */
const serverSlot = page => page.evaluate(() => Number(/** @type {any} */ (window).__wildshard.world.player.link?.heldSlot ?? -1));

/** One room: Jimmy walks out, turns his right side to Jake, and Jake checks and captures what is in his hands.
 *  @param {(typeof LEGS)[number]} leg @param {number} at */
const room = async (leg, at) => {
  const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: leg.shard }), url = `${rig.base}/?chunk=${leg.shard}&mute=1&nolock=1&skipintro=1`;
  const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  /** @param {string} name */
  const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
  try {
    const jake = await enter('Jake'), jimmy = await enter('Jimmy');
    // Jimmy walks on ahead along the way he spawned facing until he is AWAY metres from Jake, then turns side-on to him (his right
    // hand toward Jake), and Jake looks at him.
    let gap = 0;
    for (let i = 0; i < 80; i++) {
      const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]);
      gap = Math.hypot(me.x - him.x, me.z - him.z);
      if (gap >= AWAY - 0.1) break;
      await walk(jimmy.page, 0.6); await jimmy.page.waitForTimeout(100);
    }
    await walk(jimmy.page, 0);
    /** Turn Jimmy to face Jake, `by` radians further round. @param {number} by */
    const turnJimmy = async by => {
      const spot = await where(jake.page);
      await jimmy.page.evaluate(([x, z, more]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.yaw = Math.atan2(x - player.position.x, z - player.position.z) + Math.PI + more; }, [spot.x, spot.z, by]);
    };
    await turnJimmy(-0.6); await face(jake.page, await where(jimmy.page)); await jake.page.waitForTimeout(1500);
    note(`Jake stands about ${String(AWAY)} m from Jimmy`, gap > AWAY - 0.6 && gap < AWAY + 1.2, { gap });

    const kit = await kitOf(jimmy.page), first = kit.current, other = leg.other === null ? undefined : kit.rows.find((/** @type {{ id: string, row: string, slot: number | null }} */ entry) => leg.other !== null && leg.other.test(entry.row) && entry.slot !== null);
    note(`${leg.shard}: Jimmy holds ${first}${other === undefined ? '' : `, and his kit has ${other.row} on a slot of the server's`}`, leg.first.test(first) && (leg.other === null || other !== undefined), kit);
    const taken = /** @type {string[]} */ ([]), name = leg.shard.split('-')[0] ?? leg.shard;
    /** @param {string} shot */
    const shoot = async shot => { const file = `rp5-${String(at * 3 + taken.length + 1)}-${name}-${shot}.png`; await jake.page.screenshot({ path: join(shots, file) }); taken.push(file); };
    /** @param {string} row */
    const tail = row => row.replace(/^weapon\./u, '');

    const held = await drawn(jake.page, first);
    note(`Jake's page draws Jimmy's ${first} in his ${leg.hand} hand, from Jake's own first-person model of it`, holds(held, first, leg.hand), held);
    await shoot(tail(first));

    if (other !== undefined) {
      const firstId = kit.rows.find((/** @type {{ id: string, row: string }} */ entry) => entry.row === first)?.id ?? '';
      await swap(jimmy.page, other.id);
      const swapped = await drawn(jake.page, other.row), slot = await serverSlot(jimmy.page);
      if (slot !== other.slot && swapped.shown?.item === first) console.log(`skip Jimmy switches to ${other.row}: the server kept slot ${String(slot)} (he doesn't own it), and Jake's page still draws ${first}, as the row says`);
      else {
        note(`Jimmy switches to ${other.row}: Jake's page swaps the item in his hand`, holds(swapped, other.row, /bow/u.test(other.row) && !/crossbow/u.test(other.row) ? 'left' : 'right'), swapped);
        await jimmy.page.waitForTimeout(400); await shoot(tail(other.row));
        await swap(jimmy.page, firstId);
        const back = await drawn(jake.page, first);
        note(`Jimmy switches back: the ${first} is in his hand again`, holds(back, first, leg.hand), back);
        await jimmy.page.waitForTimeout(400); await shoot(`${tail(first)}-again`);
      }
    }
    if (keep !== '') { mkdirSync(keep, { recursive: true }); for (const shot of taken) copyFileSync(join(shots, shot), join(keep, shot)); }
    /** @param {string} line */
    const quiet = line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line), faults = [...jake.errors, ...jimmy.errors].filter(quiet);
    note(`${leg.shard}: no page error`, faults.length === 0, faults.slice(0, 6));
  } finally {
    await launched.close();
    await rig.close();
  }
};

let code = 1;
try {
  for (const [at, leg] of LEGS.entries()) await room(leg, at);
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);
