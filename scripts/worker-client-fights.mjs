// J130: the flip's checklist, the parts a walk can't reach: a real fight on its rows to the reward, a refused press, a boss that resets, a
// fall and the way back, the sky and the Weather setting, a chest, a buy, a contract, a door. A harness stands the player where it needs
// them and hardens their blows (`__workerClientHits`), so a long fight ends inside a proof; the hits, the fight and the reward are real.
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** What the game asks of the score from here on: `heardOf` reads it. A proof's own record: no step's `ok` needs it. Never wrap `hud.killFeed` here:
 *  a lair's runtime pins that method's identity, and on Nalati a wrapped one faults `shard.nalati.elites` every frame, and presses and blows die with it. */
const listen = page => page.evaluate(() => {
  const { world } = window.__wildshard, lines = window.__said = [];
  const record = (owner, name) => { const real = owner[name].bind(owner); owner[name] = (...args) => { lines.push(`${name} ${args.join(' ')}`); return real(...args); }; };
  for (const name of ['combat', 'sting']) record(world.music, name);
});
const heardOf = page => page.evaluate(() => (window.__said ?? []).slice(-14));
/** Open one shard with the row on, entered and on the wire. */
async function open(browser, phone, base, slug, query = '') {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  page.on('console', line => { if (line.type() === 'error') errors.push(line.text().slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(new URL(`/?chunk=${slug}&mute=1&nolock=1${query}`, base).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
  return { context, page, errors };
}
const report = page => page.evaluate(() => window.__workerClient());
const fight = (page, id) => page.evaluate(want => window.__workerClientFights().find(row => row.id === want) ?? null, id);
const place = (page, x, y, z) => page.evaluate(([px, py, pz]) => { window.__wildshard.world.player.link.place(px, py, pz, 0); }, [x, y, z]);
/** `--second`: a second player stands in this fight from here on. It joins after the sky is set: a room shares one sky, and takes no player's word for it. */
const joinSecond = page => (process.argv.includes('--second') ? page.evaluate(() => { const { x, y, z } = window.__wildshard.world.player.position; window.__secondClient = window.__workerClientBot('bot:2', x + 3, y, z + 3); }) : Promise.resolve());
/** Wait until `read` answers something truthy; its last answer either way. */
async function until(page, read, seconds, every = 250) {
  const end = Date.now() + seconds * 1000;
  let last = await read();
  while (!last && Date.now() < end) { await page.waitForTimeout(every); last = await read(); }
  return last;
}
/** Face a point and swing or shoot at it. */
const strike = (page, at, chase) => page.evaluate(([x, y, z, run]) => {
  const { player, game } = window.__wildshard.world, dx = x - player.position.x, dz = z - player.position.z, away = Math.hypot(dx, dz);
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y + 1 - player.position.y - 1.6, Math.max(away, 0.1)); player.touchMove.y = run && away > 2.2 ? 1 : 0; player.touchSprint = run && away > 8;
  game.app.input.press('attack');
}, [at.x, at.y, at.z, chase]);
const stand = page => page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; player.touchSprint = false; });
/** The boss bar's words as a player reads them. */
const bossBar = page => page.evaluate(() => { const shown = selector => [...document.querySelectorAll(selector)].filter(node => node.classList.contains('show')).map(node => (node.textContent ?? '').trim().slice(0, 60)); return { bar: shown('[class*="ws-boss"]').slice(0, 4), elite: shown('[class*="ws-elite"]').slice(0, 4) }; });
const prompt = (page, match) => page.evaluate(source => { const pattern = new RegExp(source, 'iu'), found = window.__wildshard.world.interactables.find(row => (pattern.test(row.label) || pattern.test(row.wireId ?? '')) && row.radius > 0); return found === undefined ? null : { label: found.label, x: found.position.x, y: found.position.y, z: found.position.z, id: found.wireId ?? null }; }, match);
/** A press of whatever stands nearest, as a player's E. */
const press = page => page.keyboard.press('KeyE');

const SUNSCAR_BASIN = [-14, 28, -150], NALATI_DOOR = [-169, 75], KINGS_CLEARING = [150, -30];
const groundAt = (page, x, z) => page.evaluate(([gx, gz]) => window.__hf.heightAt(gx, gz), [x, z]);
/** Walk one way until `done`, or `seconds` run out; whether it was done. */
async function walkInto(page, yaw, seconds, done) {
  await page.evaluate(heading => { const { player } = window.__wildshard.world; player.yaw = heading; player.pitch = 0; player.touchMove.y = 1; }, yaw);
  const reached = await until(page, done, seconds, 150);
  await stand(page);
  return reached === true;
}
/** Stand beside a prompt, as near as a player would. */
async function standAt(page, match, off = 0.7) {
  const found = await prompt(page, match);
  if (found === null) return null;
  await place(page, found.x + off, found.y - 1.2, found.z + off);
  await page.waitForTimeout(1100);
  return found;
}
/** A press from each side of a prompt in turn: a player finds the side it can see from. */
async function pressRound(page, match, done) {
  const at = await prompt(page, match);
  if (at === null) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1.2], [0, -1.2], [1, 1], [-1, -1]]) {
    await place(page, at.x + dx, at.y - 1.3, at.z + dz);
    await page.waitForTimeout(1000);
    await press(page); await page.waitForTimeout(900);
    if (await done()) return true;
  }
  return false;
}
/** Press until `done`, reading a talk through as a player does. */
async function pressUntil(page, done, tries = 14) {
  for (let i = 0; i < tries; i++) { await press(page); await page.waitForTimeout(600); if (await done()) return true; }
  return false;
}
const hasFlag = (page, flag) => async () => (await report(page)).flags.includes(flag);
/** Face a point dead on, from the eye. */
const faceAt = (page, at) => page.evaluate(({ x, y, z }) => {
  const { player } = window.__wildshard.world, dx = x - player.position.x, dz = z - player.position.z;
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y - player.position.y - 1.68, Math.hypot(dx, dz));
}, at);
/** A lash or a shot at a point: stand a few metres off, face it, and strike. `heavy` holds the charge through. */
async function lash(page, at, heavy = false, off = 2.4, action = 'attack') {
  await place(page, at.x + off, at.y - 0.6, at.z + off);
  await page.waitForTimeout(1200);
  await faceAt(page, at);
  await page.waitForTimeout(200);
  if (heavy) {
    await page.evaluate(() => { window.__wildshard.world.game.app.equipment.adsHeld = true; });
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.__wildshard.world.game.app.equipment.adsHeld = false; });
    await page.waitForTimeout(1800);
  } else { await page.evaluate(name => { window.__wildshard.world.game.app.input.press(name); }, action); await page.waitForTimeout(900); }
}
/** Blows until a fight stands in `state`, keeping to its body. `also` is a second action to press with them. */
async function fightTo(page, id, state, seconds, also = null) {
  const end = Date.now() + seconds * 1000;
  let row = await fight(page, id), turn = 0;
  while (row?.state !== state && Date.now() < end) {
    if (row?.at !== null && row?.at !== undefined) {
      await strike(page, row.at, true);
      if (await page.evaluate(() => window.__wildshard.world.game.app.equipment.current.id === 'bow')) { // hold to draw, let go to loose
        await page.evaluate(() => { window.__wildshard.world.game.app.equipment.altHeld = true; }); await page.waitForTimeout(1100);
        await strike(page, row.at, false); await page.evaluate(() => { window.__wildshard.world.game.app.equipment.altHeld = false; });
      }
      if (also !== null) await page.evaluate(name => { window.__wildshard.world.game.app.input.press(name); }, also);
      if (turn++ % 12 === 0) { const { at } = row, seen = await page.evaluate(() => window.__wildshard.world.player.position.y); await place(page, at.x + 1.5, Math.max(seen, at.y - 1), at.z + 1.5); }
    }
    await page.waitForTimeout(350);
    row = await fight(page, id);
  }
  await stand(page);
  return row;
}

/** Sunscar, whole: Sefa, the logbook, the well, three waymarks, the signal fire, the Matriarch, the end of the quest. */
export async function sunscarJourney(browser, phone, base, step, prepare = () => Promise.resolve()) {
  const dune = await open(browser, phone, base, 'sunscar-dunes');
  const { page } = dune, flagged = flag => hasFlag(page, flag);
  await prepare(page);
  await step('sunscar: Sefa starts the quest', async () => {
    await standAt(page, 'Sefa');
    return { ok: await pressUntil(page, flagged('sunscar.scout'), 24), quests: (await report(page)).quests };
  });
  await step('sunscar: the logbook press reaches the server', async () => {
    const found = await standAt(page, 'logbook');
    return { ok: await pressUntil(page, flagged('sunscar.logbook'), 4), found, flags: (await report(page)).flags.filter(flag => !flag.startsWith('seen:')) };
  });
  await step('sunscar: the crank takes a double crack, and the jar comes up', async () => {
    const well = await prompt(page, 'well|bucket|oil');
    await lash(page, { x: 85.67, y: 17.67, z: -6 }, true);
    await standAt(page, 'well|bucket|oil');
    return { ok: await pressUntil(page, flagged('sunscar.oil'), 5), well, label: (await prompt(page, 'well|bucket|oil'))?.label ?? null };
  });
  // Each waymark from where a player stands to pour: 2.5 m south of the bowl, on the ground. The server picks the prompt it sees from there.
  for (const index of [0, 1, 2]) await step(`sunscar: waymark ${index} takes oil and a light crack`, async () => {
    const crack = [{ x: 58, y: 26.6, z: -34 }, { x: -44, y: 19.41, z: -22 }, { x: 34, y: 10.37, z: -102 }][index], on = flagged(`sunscar.brazier.${index}`), label = () => page.evaluate(wanted => window.__wildshard.world.interactables.find(row => row.wireId === wanted)?.label ?? null, `pour.${index}`);
    await place(page, crack.x, crack.y - 1.3, crack.z + 2.5);
    await page.waitForTimeout(1600);
    await press(page); await page.waitForTimeout(900);
    const poured = await label();
    for (let crackAt = 0; crackAt < 4 && await on() !== true; crackAt++) { await faceAt(page, crack); await page.waitForTimeout(250); await faceAt(page, crack); await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await until(page, on, 1.5); }
    return { ok: await on() === true, poured, label: await label(), server: [(await report(page)).serverX, (await report(page)).serverZ], refused: (await report(page)).refused, flags: (await report(page)).flags.filter(flag => !flag.startsWith('seen:')) };
  });
  await step('sunscar: a gate a player opened is that player\'s', async () => {
    const seen = await page.evaluate(() => [0, 1, 2].map(index => window.__workerClientGate(`sunscar.brazier.${index}`)));
    return { ok: seen.every(open_ => open_ === true) && await page.evaluate(() => window.__workerClientGate('sunscar.lit')) === false, seen };
  });
  await step('sunscar: the signal fire lights, and the sky has gone to dusk', async () => {
    const fire = await prompt(page, 'signal');
    await place(page, 8.75, fire.y - 1.1, -73.5);
    await page.waitForTimeout(1600);
    const lit = await pressUntil(page, flagged('sunscar.lit'), 5);
    await page.waitForTimeout(6000);
    return { ok: lit, flags: (await report(page)).flags.filter(flag => !flag.startsWith('seen:')), row: (await fight(page, 'sunscar.matriarch'))?.state, dusk: await page.evaluate(() => window.__wildshard.shard.weatherFields?.value?.('dusk') ?? null) };
  });
  await step('sunscar: the Matriarch falls to real blows, and the quest ends', async () => {
    await page.evaluate(() => { window.__workerClientHits(60); });
    await place(page, ...SUNSCAR_BASIN);
    const up = await until(page, async () => { const seen = await fight(page, 'sunscar.matriarch'); return seen?.state === 'fight' ? seen : null; }, 25);
    const shown = await bossBar(page), end = await fightTo(page, 'sunscar.matriarch', 'victory', 50);
    await page.waitForTimeout(3000);
    const r = await report(page);
    return { ok: end?.state === 'victory' && r.quests['sunscar.signal'] === null && r.paid > 0 && r.receipts.some(line => line === 'fact:sunscar.matriarch'), up: up?.state ?? null, state: end?.state, shown, quests: r.quests, paid: r.paid, coins: r.owned.coins, receipts: r.receipts };
  });
  await step('sunscar: no page error', () => ({ ok: dune.errors.length === 0, errors: [...new Set(dune.errors)].slice(0, 6) }));
  await dune.context.close();
}

/** The nearest living row body of a kind. */
const bodyOf = (page, kind) => page.evaluate(want => { const { world } = window.__wildshard, live = (world.animals?.animals ?? []).filter(body => body.alive && body.rowDriven && body.kind === want); live.sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position)); const body = live[0]; return body === undefined ? null : { x: body.position.x, y: body.position.y, z: body.position.z, count: live.length }; }, kind);
/** What a page bound on a row's body as its fight began, nearest `at`: read off the mesh the page draws. */
const rowLook = (page, at) => page.evaluate(({ x, z }) => {
  const live = (window.__wildshard.world.animals?.animals ?? []).filter(body => body.rowDriven), away = body => Math.hypot(body.position.x - x, body.position.z - z);
  live.sort((one, other) => away(one) - away(other));
  const body = live[0]; if (body === undefined) return null;
  const materials = new Set(); body.mesh.traverse(mesh => { for (const material of [mesh.material].flat()) if (material !== undefined) materials.add(material); });
  const rows = [...materials], standard = rows.filter(material => material.isMeshStandardMaterial), lambert = rows.filter(material => material.isMeshLambertMaterial);
  return { kind: body.kind, away: Number(away(body).toFixed(1)), pinned: body.drawPinned, standard: standard.length, painted: standard.filter(material => /lights_fragment_end/u.test(material.customProgramCacheKey())).length,
    glow: Math.max(0, ...lambert.filter(material => material.emissive.getHex() !== 0).map(material => material.emissiveIntensity)), tint: lambert[0]?.color.toArray().map(value => Number(value.toFixed(2))) ?? null };
}, at);
/** Far Reach, whole: the keeper's notes, the roost, three vanes, the winch, the crown, the Roc. */
async function farJourney(browser, phone, base, step) {
  const sky = await open(browser, phone, base, 'far-reach');
  const { page } = sky, flagged = flag => hasFlag(page, flag), live = async () => (await report(page)).flags.filter(flag => !flag.startsWith('seen:'));
  await page.evaluate(() => { window.__workerClientHits(40); });
  await step('far reach: the keeper\'s talk starts the quest', async () => {
    await standAt(page, 'keeper');
    return { ok: await pressUntil(page, flagged('far.notes'), 20), flags: await live(), quests: (await report(page)).quests };
  });
  await step('far reach: the roost\'s rays fall to real blows', async () => {
    await place(page, 60, 35.5, -12);
    await page.waitForTimeout(1500);
    const done = await until(page, async () => {
      if (await flagged('far.roost')()) return true;
      const ray = await bodyOf(page, 'driftRay');
      if (ray !== null) { if (Math.hypot(ray.x - 60, ray.z + 12) < 40) await place(page, ray.x + 1.5, Math.max(ray.y - 1.2, 34.5), ray.z + 1.5); await strike(page, ray, false); }
      return false;
    }, 70, 450);
    return { ok: done === true, flags: await live(), left: await bodyOf(page, 'driftRay') };
  });
  for (const [name, x, y, z] of [['grove', -50, 30.3, 0], ['keeper', -54, 35.8, -56], ['ruin', 62, 31.3, -76]]) await step(`far reach: the ${name} vane takes a gust`, async () => {
    await lash(page, { x, y, z }, false, 3, 'far.gust');
    return { ok: await until(page, flagged(`far.vane.${name}`), 4) === true, flags: await live() };
  });
  await step('far reach: the winch raises the bridge', async () => {
    const found = await standAt(page, 'winch');
    const up = await pressUntil(page, flagged('far.bridge'), 8);
    return { ok: up, found, flags: await live(), quests: (await report(page)).quests };
  });
  await step('far reach: the Roc falls to real blows and the sky is won', async () => {
    await place(page, 0, 45.5, -188);
    const up = await until(page, async () => (await fight(page, 'far.roc.encounter'))?.state === 'fight', 20);
    const shown = await bossBar(page), end = await fightTo(page, 'far.roc.encounter', 'victory', 100, 'far.gust');
    await page.waitForTimeout(2500);
    const r = await report(page);
    return { ok: up === true && end?.state === 'victory' && r.flags.includes('far.roc.down'), state: end?.state, shown, quests: r.quests, paid: r.paid, coins: r.owned.coins, flags: await live() };
  });
  await step('far reach: no page error', () => ({ ok: sky.errors.length === 0, errors: [...new Set(sky.errors)].slice(0, 6) }));
  await sky.context.close();
}

const coins = async page => (await report(page)).owned.coins ?? 0;
/** Boars until the purse holds `want`. */
async function earn(page, kind, want, seconds) {
  const end = Date.now() + seconds * 1000;
  while (await coins(page) < want && Date.now() < end) {
    const body = await bodyOf(page, kind);
    if (body === null) { await page.waitForTimeout(500); continue; }
    await place(page, body.x + 1.2, body.y + 0.5, body.z + 1.2);
    await page.waitForTimeout(350);
    await strike(page, body, true);
    await page.waitForTimeout(450);
  }
  await stand(page);
  return coins(page);
}
/** Driftwood, whole: Wendell, his chest, a beacon, a buy, a real door, and as far along the ring as a press can go. */
async function driftwoodJourney(browser, phone, base, step) {
  const isle = await open(browser, phone, base, 'driftwood-isle');
  const { page } = isle, live = async () => (await report(page)).flags.filter(flag => !flag.startsWith('seen:') && !flag.startsWith('glass') && !flag.startsWith('taken:glass'));
  await page.evaluate(() => { window.__workerClientHits(40); });
  await step('driftwood: Wendell starts the ring', async () => {
    await standAt(page, 'Wendell');
    return { ok: await pressUntil(page, async () => (await report(page)).quests['sealed-ring'] === 'shards', 12), quests: (await report(page)).quests };
  });
  await step('driftwood: a chest pressed on the page opens on the server', async () => {
    for (let i = 0; i < 24; i++) { await press(page); await page.waitForTimeout(250); } // the talk's lines
    const opened = await pressRound(page, 'castaway-chest', async () => (await report(page)).owned['item.doubloon'] === 2);
    return { ok: opened, owned: (await report(page)).owned, flags: await live() };
  });
  await step('driftwood: the beacon takes the flint and gives its shard', async () => {
    const lit = await pressRound(page, '^beacon$', async () => await prompt(page, 'shard-lookout') !== null);
    const taken = await pressRound(page, 'shard-lookout', async () => await prompt(page, 'shard-lookout') === null);
    return { ok: lit && taken, lit, taken, flags: await live(), quests: (await report(page)).quests };
  });
  await step('driftwood: real kills fill the purse and a buy takes it', async () => {
    const before = await earn(page, 'boar', 8, 60);
    await standAt(page, 'Trade with Maren');
    await press(page); await page.waitForTimeout(1000);
    await page.locator('.ws-shop-grid > *').filter({ hasText: /cape/iu }).first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    await page.locator('.ws-shop-bigbuy').click({ timeout: 4000 });
    const open_ = await page.evaluate(() => document.querySelector('.ws-shop-counter, .ws-shop')?.classList.contains('show') ?? null), at = Date.now(), landed = await until(page, async () => Object.keys((await report(page)).owned).some(line => line.startsWith('own') && line.includes('cape')) ? Date.now() - at : null, 3); // a line at 0 is gone, so read the cape
    await page.locator('.ws-shop-close').click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(1500);
    const r = await report(page), held = Object.keys(r.owned).filter(line => line.startsWith('own'));
    return { ok: held.some(line => line.includes('cape')) && landed !== null, before, panel: open_, whileOpen: landed, after: r.owned.coins, held };
  });
  await step('driftwood: no page error', () => ({ ok: isle.errors.length === 0, errors: [...new Set(isle.errors)].slice(0, 6) }));
  await isle.context.close();
}
/** Pine: a contract filled by a real kill and claimed on the board, and the miller's barred door. */
async function pineJourney(browser, phone, base, step) {
  const pine = await open(browser, phone, base, 'pine-hollow');
  const { page } = pine, board = async () => { const { owned } = await report(page); return Object.entries(owned).filter(([line]) => line.startsWith('board') || line.startsWith('slot') || line.includes('|')); };
  await page.evaluate(() => { window.__workerClientHits(60); });
  await step('pine: the board comes up on lines', async () => {
    await page.waitForTimeout(1500);
    const lines = await board();
    return { ok: lines.length > 0, lines: lines.slice(0, 8) };
  });
  await step('pine: a real kill fills a contract, and it counts on the page', async () => {
    const lines = await board(), slot = lines.map(([line, have]) => ({ line, have, parts: line.split('|') })).find(row => row.parts.length >= 5);
    const target = slot?.parts[4] ?? 'boar', kind = /deer|stag|hind/iu.test(target) ? 'deer' : /elk/iu.test(target) ? 'elk' : 'boar';
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      const body = await bodyOf(page, kind);
      if (body !== null) { await place(page, body.x + 1.5, body.y + 0.6, body.z + 1.5); await page.waitForTimeout(350); await strike(page, body, false); }
      await page.waitForTimeout(600);
      const now = await board();
      if (JSON.stringify(now) !== JSON.stringify(lines)) return { ok: true, target, now: now.slice(0, 8) };
    }
    return { ok: false, target, slot: slot?.line, now: (await board()).slice(0, 8) };
  });
  await step('pine: a filled contract is claimed on the board, and it pays', async () => {
    const slot = (await board()).map(([line]) => line.split('|')).find(parts => parts.length >= 5 && parts[3] === 'species');
    const target = slot?.[4] ?? 'deer', kind = /elk/iu.test(target) ? 'elk' : /boar/iu.test(target) ? 'boar' : 'deer', ready = () => page.evaluate(() => [...document.querySelectorAll('.ws-ph-seal')].some(node => node.offsetParent !== null));
    const close = () => page.locator('button:visible').filter({ hasText: /^close$/iu }).first().dispatchEvent('click').catch(() => undefined);
    await pressRound(page, 'contract board', () => page.evaluate(() => [...document.querySelectorAll('.ws-ph-note-count')].some(node => node.offsetParent !== null)));
    const need = await page.evaluate(() => Number(/\/ (?<need>\d+)/u.exec(document.querySelector('.ws-ph-note-count')?.textContent ?? '')?.groups?.need ?? 0));
    await close(); await page.waitForTimeout(400);
    const end = Date.now() + 100_000;
    let kills = 0;
    while (Date.now() < end) { // the line counts from 1
      const have = (await board()).find(([line]) => line.startsWith('board|0|'))?.[1] ?? 0;
      if (have > need) break;
      const was = await report(page), body = await bodyOf(page, kind);
      if (body === null) { await page.waitForTimeout(500); continue; }
      await place(page, body.x + 1.5, body.y + 0.6, body.z + 1.5); await page.waitForTimeout(350); await strike(page, body, false); await page.waitForTimeout(900);
      if ((await report(page)).kills > was.kills) kills++;
    }
    const sealed = await pressRound(page, 'contract board', ready);
    if (!sealed) return { ok: false, kills, target, lines: (await board()).slice(0, 8) };
    const before = await report(page);
    await page.locator('.ws-ph-seal:visible').first().dispatchEvent('click');
    const paid = await until(page, async () => { const { owned } = await report(page); return owned['board.claimed'] === before.owned['board.claimed'] ? null : owned; }, 4);
    await page.locator('button:visible').filter({ hasText: /^close$/iu }).first().dispatchEvent('click').catch(() => undefined);
    await page.waitForTimeout(800);
    return { ok: paid !== null, kills, target, claimed: paid?.['board.claimed'] ?? null, coins: [before.owned.coins, paid?.coins] };
  });
  await step('pine: a contract can be read and torn on the page, and the server deals another', async () => {
    const lines = await board();
    await pressRound(page, 'contract board', () => page.evaluate(() => [...document.querySelectorAll('.ws-ph-tear')].some(node => node.offsetParent !== null)));
    const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].filter(node => node.offsetParent !== null).map(node => (node.textContent ?? '').trim()).filter(Boolean).slice(0, 14));
    await page.locator('.ws-ph-tear:visible').first().dispatchEvent('click');
    const moved = await until(page, async () => JSON.stringify(await board()) !== JSON.stringify(lines), 3) === true;
    await page.locator('button:visible').filter({ hasText: /^close$/iu }).first().dispatchEvent('click').catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(1000);
    return { ok: moved, whileOpen: moved, buttons: buttons.slice(-6), now: (await board()).slice(0, 8) };
  });
  await step('pine: the mill door is barred, and opens for the player whose gate it is', async () => {
    // The watermill's door, cabin-7: a leaf across x, its prompt on the east side.
    const gate = () => page.evaluate(() => window.__wildshard.world.registry.get('mill-door-bar')?.active?.() ?? null), DOOR = { x: -178.09, z: -145.32 }, id = 'door:cabin-7-door';
    await page.waitForFunction(() => window.__wildshard.world.registry.get('mill-door-bar') !== undefined, undefined, { timeout: 20_000 }).catch(() => undefined);
    const stood = (x, z) => groundAt(page, x, z).then(y => place(page, x, y + 0.4, z));
    const through = async () => { // from the race side, straight at the door, a step past it
      await stood(DOOR.x + 2.6, DOOR.z);
      await page.waitForTimeout(1300);
      await walkInto(page, Math.PI / 2, 3.5, () => page.evaluate(wanted => window.__wildshard.world.player.position.x < wanted, DOOR.x - 1));
      await page.waitForTimeout(500);
      const r = await report(page);
      return { x: r.x, server: r.serverX, corrections: r.corrections };
    };
    const pressDoor = async () => { await stood(DOOR.x + 1.1, DOOR.z); await page.waitForTimeout(1200); await press(page); await page.waitForTimeout(1200); };
    const barred = await gate(), shut = await through();
    await pressDoor();
    const refused = !(await report(page)).flags.includes(id);
    await page.evaluate(() => { window.__workerClientFlag('errand:done'); });
    const heard = await until(page, () => page.evaluate(() => window.__workerClientGate('errand:done')), 4);
    const opened = await gate(), stillShut = await through();
    await pressDoor();
    const opens = (await report(page)).flags.includes(id), went = await through();
    await stood(DOOR.x + 1.1, DOOR.z); await page.waitForTimeout(1500); await press(page); await page.waitForTimeout(2200);
    const closed = !(await report(page)).flags.includes(id), back = await through();
    const stops = row => row.x > DOOR.x - 0.2 && row.server > DOOR.x - 0.2, passes = row => row.x < DOOR.x - 0.5 && row.server < DOOR.x - 0.5;
    return { ok: barred === true && heard === true && opened === false && refused && stops(shut) && stops(stillShut) && opens && passes(went) && closed && stops(back), barred, heard, opened, refused, opens, closed, shut, stillShut, went, back };
  });
  await step('pine: no page error', () => ({ ok: pine.errors.length === 0, errors: [...new Set(pine.errors)].slice(0, 6) }));
  await pine.context.close();
}

/** Draw and loose at a point, as a player holds the FIRE disc. */
async function loose(page, at) {
  await faceAt(page, at);
  await page.evaluate(() => { window.__wildshard.world.game.app.equipment.altHeld = true; });
  await page.waitForTimeout(1300);
  await faceAt(page, at);
  await page.evaluate(() => { window.__wildshard.world.game.app.equipment.altHeld = false; });
  await page.waitForTimeout(700);
}
const bodyMid = at => ({ x: at.x, y: at.y + 1, z: at.z });
/** Nalati: its elder, a lair's bar and orb, the King's barrow, a refused press of his orb and a taken one. */
export async function nalatiJourney(browser, phone, base, step, prepare = () => Promise.resolve()) {
  const steppe = await open(browser, phone, base, 'nalati-grasslands');
  const { page } = steppe, flagged = flag => hasFlag(page, flag), KING = 'golden-king';
  await prepare(page);
  await page.evaluate(() => { window.__workerClientHits(60); });
  await step('nalati: the elder\'s talk starts the Tulpar chapter, and the server keeps it', async () => {
    const elder = await prompt(page, 'Baqyt');
    await place(page, elder.x + 0.9, elder.y + 0.1, elder.z + 0.9);
    await page.waitForTimeout(1600);
    const moved = await pressUntil(page, flagged('talked:elder'), 28);
    await page.waitForTimeout(1200);
    const chip = await page.evaluate(() => { const { flags, line } = window.__wildshard.shard['nalati.quest']; return { flags: flags.all.filter(flag => !flag.startsWith('seen:')), chapter: line?.active?.def?.id ?? null, step: line?.active?.current?.id ?? null }; });
    return { ok: moved && chip.chapter === 'tulpar' && chip.step === 'tame', chip, flags: (await report(page)).flags.filter(flag => !flag.startsWith('seen:')) };
  });
  await step('nalati: Aqbars falls to real arrows and leaves its orb on the row', async () => {
    await place(page, 138, 62, -58);
    await until(page, async () => (await fight(page, 'aqbars'))?.at !== null, 12);
    const shown = await bossBar(page), end = Date.now() + 40_000, before = await report(page);
    let row = await fight(page, 'aqbars');
    while (row?.state !== 'dead' && Date.now() < end) { if (row?.at !== null && row?.at !== undefined) await loose(page, bodyMid(row.at)); row = await fight(page, 'aqbars'); }
    await page.waitForTimeout(1200);
    const done = await fight(page, 'aqbars'), orb = await prompt(page, 'skin'), r = await report(page);
    return { ok: done?.state === 'dead' && done.reward !== null && orb !== null && r.hits > before.hits, state: done?.state, reward: done?.reward, orb, shown, hits: r.hits, refused: r.refused, falls: r.falls };
  });
  await step('nalati: the felled lair reaches the story', async () => {
    const felled = await until(page, flagged('felled:aqbars'), 6), feather = await until(page, flagged('feather:1'), 4);
    return { ok: felled === true && feather === true, flags: (await report(page)).flags.filter(flag => /^(?:felled|dead|feather)/u.test(flag)) };
  });
  await step('nalati: the orb is taken and the server keeps it', async () => {
    const taken = await pressRound(page, 'skin', async () => (await fight(page, 'aqbars')).reward === null);
    return { ok: taken, reward: (await fight(page, 'aqbars')).reward, owned: (await report(page)).owned };
  });
  await step('nalati: the King\'s barrow takes the player in, and the bar comes up', async () => {
    await listen(page);
    const [x, z] = NALATI_DOOR, feet = await groundAt(page, x, z);
    await place(page, x, feet + 1, z);
    await page.waitForTimeout(1500);
    const inside = await walkInto(page, Math.PI / 2, 4, () => page.evaluate(() => window.__wildshard.world.player.position.y > 130));
    const up = await walkInto(page, 0, 12, async () => (await fight(page, KING))?.state === 'fight');
    await page.waitForTimeout(600);
    return { ok: inside && up && (await bossBar(page)).bar.length > 0, inside, row: await fight(page, KING), shown: await bossBar(page) };
  });
  await step('nalati: the King falls to real arrows, and his gold orb lies on the row', async () => {
    const end = Date.now() + 40_000;
    let row = await fight(page, KING), glow = 0;
    while (row?.state !== 'victory' && Date.now() < end) { if (row?.at !== null && row?.at !== undefined) { await loose(page, bodyMid(row.at)); glow = Math.max(glow, (await rowLook(page, row.at))?.glow ?? 0); } row = await fight(page, KING); }
    const orb = await until(page, async () => { const seen = await fight(page, KING); return seen?.reward !== null ? seen.reward : null; }, 8);
    await page.waitForTimeout(600);
    return { ok: row?.state === 'victory' && orb !== null && glow > 0, state: row?.state, orb, glow, shown: await prompt(page, 'take|claim|bow|gold|reward'), said: await heardOf(page) };
  });
  await step('nalati: the orb refuses a press from across the room, and stays', async () => {
    const { reward } = await fight(page, KING);
    await place(page, reward.x + 6, reward.y - 0.8, reward.z + 8);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__wildshard.world.interactables.find(entry => /take|claim|bow|gold|reward/iu.test(entry.label) && entry.radius > 0)?.onInteract(); });
    await page.waitForTimeout(2600);
    const held = (await report(page)).owned;
    return { ok: (await fight(page, KING)).reward !== null && held['item.goldenBow'] === undefined, reward: (await fight(page, KING)).reward, held };
  });
  await step('nalati: a press in reach takes the King\'s orb for good', async () => {
    const { reward } = await fight(page, KING);
    await place(page, reward.x + 0.8, reward.y - 0.8, reward.z + 0.8);
    await page.waitForTimeout(1200);
    const taken = await pressUntil(page, async () => (await fight(page, KING)).reward === null, 6);
    await page.waitForTimeout(1500);
    const r = await report(page);
    return { ok: taken && r.owned['item.goldenBow'] === 1, owned: r.owned, flags: r.flags.filter(flag => /^(?:dead|boss)/u.test(flag)) };
  });
  await step('nalati: a save holds the story and the bow, through a reload', async () => {
    await page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    const saved = await report(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const r = await report(page), chip = await page.evaluate(() => { const { line } = window.__wildshard.shard['nalati.quest']; return { chapter: line?.active?.def?.id ?? null, step: line?.active?.current?.id ?? null }; }), king = await fight(page, KING);
    return { ok: saved.savedOk && r.restored && r.flags.includes('talked:elder') && chip.chapter === 'tulpar' && r.owned['item.goldenBow'] === 1 && king?.reward === null, restored: r.restored, chip, owned: r.owned, king: king?.state };
  });
  await step('nalati: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
}

/** Nalati's chapters on the server, the parts a long play would reach: harness flags stand in for a chapter's earlier steps and for a tame's hour-long break; a ride, a round, a kill and a tie are real. */
async function chapterJourney(browser, phone, base, step) {
  const steppe = await open(browser, phone, base, 'nalati-grasslands');
  const { page } = steppe, flagged = flag => hasFlag(page, flag), raise = flags => page.evaluate(list => { for (const flag of list) window.__workerClientFlag(flag); }, flags);
  const chip = () => page.evaluate(() => { const { line } = window.__wildshard.shard['nalati.quest']; return { chapter: line?.active?.def?.id ?? null, step: line?.active?.current?.id ?? null }; });
  const onChip = (chapter, at, seconds = 6) => until(page, async () => { const seen = await chip(); return seen.chapter === chapter && seen.step === at ? seen : null; }, seconds);
  await page.evaluate(() => { window.__toasts = []; new MutationObserver(list => { for (const row of list) for (const node of row.addedNodes) if (node.classList?.contains('ws-game-toast')) window.__toasts.push(node.textContent); }).observe(document.body, { childList: true, subtree: true }); });
  await page.evaluate(() => { window.__workerClientHits(60); });
  await step('chapters: a tame\'s flag moves Tulpar on, on the server and the page', async () => {
    await raise(['talked:elder']);
    const tame = await onChip('tulpar', 'tame');
    await raise(['tamed:horse']);
    const kokpar = await onChip('tulpar', 'kokpar');
    return { ok: tame !== null && kokpar !== null, tame, kokpar, flags: (await report(page)).flags.filter(flag => !flag.startsWith('seen:')) };
  });
  await step('chapters: a kokpar round runs on the server, a real rider and a real goat', async () => {
    let mounted = false;
    for (let i = 0; i < 60 && !mounted; i++) {
      const body = await bodyOf(page, 'horse');
      if (body === null) { await page.waitForTimeout(500); continue; }
      await place(page, body.x - 2.9, body.y + 0.4, body.z); await page.waitForTimeout(800); // in a horse's reach, past its naming prompt's
      await faceAt(page, body); await page.waitForTimeout(200);
      await press(page); await page.waitForTimeout(900);
      mounted = await page.evaluate(() => window.__wildshard.world.player.ride !== null);
    }
    if (!mounted) return { ok: false, why: 'no ride' };
    const home = { x: -61, z: 36 }, goal = { x: -33.99, z: 29.1 };
    await place(page, home.x + 1, await groundAt(page, home.x, home.z) + 0.5, home.z);
    const got = await until(page, async () => { const { owned } = await report(page); return owned['story.prop'] === 1 ? owned : null; }, 8);
    await page.waitForTimeout(600);
    const goat = () => page.evaluate(() => { const at = window.__wildshard.world.game.scene.getObjectByName('nalati-kokpar-goat')?.position; return at === undefined ? null : { x: at.x, z: at.z }; });
    const carried = await goat();
    await place(page, goal.x, await groundAt(page, goal.x, goal.z) + 0.5, goal.z);
    const won = await until(page, flagged('won:kokpar'), 6);
    await page.waitForTimeout(1200);
    const r = await report(page), rests = await goat();
    return { ok: got !== null && won === true && (r.owned['story.prop'] ?? 0) >= 2, prop: r.owned['story.prop'], said: Object.entries(r.owned).filter(([line]) => line.startsWith('said.')), carried, rests, toasts: await page.evaluate(() => window.__toasts.slice(-4)), chip: await chip() };
  });
  await step('chapters: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
  await stormJourney(browser, phone, base, step);
}

/** The Storm Titan: tied at the cairn in the storm, his bar and, behind flags, his looks and his whole fight. */
async function stormJourney(browser, phone, base, step) {
  const storm = await open(browser, phone, base, 'nalati-grasslands', process.argv.includes('--titan') ? '&bossGod' : '');
  await step('chapters: tied at the cairn in the storm, the Titan\'s bar comes up off its row', async () => {
    const { page: sky } = storm;
    await listen(sky);
    await sky.evaluate(() => { window.__workerClientHits(60); window.__workerClientSky('storm'); });
    let mounted = false;
    for (let i = 0; i < 60 && !mounted; i++) {
      const body = await bodyOf(sky, 'horse');
      if (body === null) { await sky.waitForTimeout(500); continue; }
      await place(sky, body.x - 2.9, body.y + 0.4, body.z); await sky.waitForTimeout(800); // in a horse's reach, past its naming prompt's
      await faceAt(sky, body); await sky.waitForTimeout(200);
      await press(sky); await sky.waitForTimeout(900);
      mounted = await sky.evaluate(() => window.__wildshard.world.player.ride !== null);
    }
    const cairn = await sky.evaluate(() => { const found = window.__wildshard.world.interactables.find(row => /tie/iu.test(row.label ?? '')); return found === undefined ? null : { x: found.position.x, y: found.position.y, z: found.position.z, label: found.label, radius: found.radius }; });
    if (cairn === null) return { ok: false, mounted, why: 'no tie prompt', prompts: await sky.evaluate(() => window.__wildshard.world.interactables.map(row => row.label).slice(0, 12)) };
    await place(sky, cairn.x + 1.2, await groundAt(sky, cairn.x, cairn.z) + 0.5, cairn.z); await sky.waitForTimeout(1500);
    await sky.evaluate(() => { window.__workerClientSky('storm'); }); await sky.waitForTimeout(2500); // a long ride over, the sky's still up
    for (let i = 0; i < 8; i++) { await press(sky); await sky.waitForTimeout(700); if ((await report(sky)).flags.includes('lit:cairn')) break; }
    const row = await until(sky, async () => { const seen = await fight(sky, 'storm-titan'); return seen !== null && seen.state !== 'dormant' ? seen : null; }, 10);
    const yaw = () => sky.evaluate(() => { const { player, camera } = window.__wildshard.world, fightOf = window.__wildshard.shard['nalati.titan'].openFight, { x, z } = fightOf.body.focusPoint, { position: p } = player; return { yaw: player.yaw, pitch: player.pitch, toward: Math.atan2(-(x - p.x), -(z - p.z)), riding: player.ride !== null, camera: camera?.position?.y ?? null }; });
    const faced = [await yaw()];
    await sky.waitForTimeout(800); faced.push(await yaw());
    const shown = await bossBar(sky), r = await report(sky);
    await sky.screenshot({ path: 'tmp/flip17/titan-intro.png' }).catch(() => undefined);
    await sky.waitForTimeout(1200); faced.push(await yaw());
    const off = ({ yaw: at, toward }) => Math.abs(Math.atan2(Math.sin(toward - at), Math.cos(toward - at)));
    return { ok: r.flags.includes('lit:cairn') && row !== null && shown.bar.length > 0 && off(faced[2]) < Math.max(0.3, off(faced[0]) * 0.5), mounted, cairn, row: row?.state, shown, flags: r.flags.filter(flag => /cairn|jel/u.test(flag)), refused: r.refused, faced };
  });
  /** What the page's own fight holds of what it heard: it steps none on the wire, so all of this came off the server's words. */
  const arenaDrawn = async sky => ({ words: Object.fromEntries(Object.entries((await report(sky)).drawn).filter(([name]) => name.startsWith('open-arena.'))),
    ...await sky.evaluate(() => { const arena = window.__wildshard.shard['nalati.titan'], body = arena?.openFight.body, { field, whirls } = arena?.openFight.viewLoan ?? {}; return { arena: arena !== undefined, visible: body?.visible ?? null, puffs: body?.puffs.visible ?? null, alpha: body?.alpha.value ?? null, burning: field === undefined ? null : Array.from(field.modeCells).filter(mode => mode === field.rows.states.active).length, whirls: whirls?.drawn.filter(row => row.shown === 1).length ?? null, fights: window.__workerClientFights().map(entry => entry.id) }; }) });
  // Behind a flag: `--titan` below is the slow half. His looks are the server's: the page draws what its fight says (server/boss/arenaWords.ts).
  if (process.argv.includes('--titanlook')) await step('chapters: the Titan stands in his fight, and the page draws his cloud', async () => {
    const { page: sky } = storm, row = await until(sky, async () => { const seen = await fight(sky, 'storm-titan'); return seen?.state === 'fight' || seen?.state === 'beat' ? seen : null; }, 40);
    await sky.waitForTimeout(800);
    const seen = await arenaDrawn(sky), focus = await sky.evaluate(() => { const { x, y, z } = window.__wildshard.shard['nalati.titan'].openFight.body.focusPoint; return { x, y, z }; });
    await faceAt(sky, focus); await sky.waitForTimeout(400); // the shot looks at him: a page can hold all of this with its camera in the grass
    await sky.screenshot({ path: 'tmp/titan/look.png' }).catch(() => undefined);
    return { ok: row !== null && seen.visible === true && seen.puffs === true && seen.alpha > 0 && (seen.words['open-arena.look'] ?? 0) > 0, state: row?.state, focus, ...seen };
  });
  // `--titanreal`: the same fight with nothing lent: no god, no `place`, a rider on a horse who rides with the stick and shoots with the wind in
  // mind. The gale carries a full-draw arrow ~26 m and drops it ~14 m by 110 m out (`TITAN_PLACE`), so a shot dead at the heart misses: this is why
  // the harness's ground shots rarely landed. Each miss walks the next shot in, as a player's eye does; the heart is 7 m wide open.
  if (process.argv.includes('--titanreal')) await step('chapters: a real rider, no god, puts real arrows in the Titan\'s heart from the saddle', async () => {
    const { page: sky } = storm, up = await until(sky, async () => (await fight(sky, 'storm-titan'))?.state === 'fight', 40);
    await joinSecond(sky);
    const read = () => sky.evaluate(() => { const { world, shard } = window.__wildshard, { player } = world, fightOf = shard['nalati.titan'].openFight, { x, y, z } = fightOf.body.focusPoint, { position: p } = player, wind = fightOf.windNow ?? null;
      const { center } = fightOf.data.arena, radius = fightOf.data.place.arenaRadius; return { open: fightOf.open, focus: { x, y, z }, at: { x: p.x, y: p.y, z: p.z }, centre: { x: center.x, z: center.z }, radius, riding: player.ride !== null, hurt: world.game.app.player?.attributes?.health ?? null, wind: wind === null ? null : { x: wind.dirX, z: wind.dirZ, speed: wind.speed } }; });
    const drawn = on => sky.evaluate(held => { window.__wildshard.world.game.app.equipment.altHeld = held; }, on);
    const ride = (forward, turn) => sky.evaluate(([y, by]) => { const { player } = window.__wildshard.world; player.touchMove.y = y; player.yaw += by; }, [forward, turn]);
    await sky.evaluate(() => { window.__workerClientHits(1); });
    const mount = async () => { const body = await bodyOf(sky, 'horse'); if (body === null) return false; await place(sky, body.x - 2.9, body.y + 0.4, body.z); await sky.waitForTimeout(800); await faceAt(sky, body); await sky.waitForTimeout(200); await press(sky); await sky.waitForTimeout(900); return sky.evaluate(() => window.__wildshard.world.player.ride !== null); };
    if (!(await read()).riding) await mount(); // the cairn's walk-up left the saddle: the ride back on is setup, and nothing after it places the rider
    const log = [], end = Date.now() + 200_000, seen = await read();
    let throws = 0, shots = 0, landed = 0, saddle = 0, resets = 0, up_ = 0.15, side = 0.2, row = await fight(sky, 'storm-titan'), deaths = 0, first = null, hp = row?.hp ?? 1;
    const aim = (s, to) => { const dx = to.x - s.at.x, dz = to.z - s.at.z, d = Math.hypot(dx, dz), carry = (d / 110) ** 2, wx = s.wind?.x ?? 1, wz = s.wind?.z ?? 0, length = Math.hypot(wx, wz) || 1; return { x: to.x - wx / length * 26 * carry * side / 0.2, y: to.y + 14 * carry * up_ / 0.15, z: to.z - wz / length * 26 * carry * side / 0.2, d }; };
    await drawn(true);
    while (Date.now() < end && row?.state !== 'victory' && row?.phase === 0) {
      const s = await read();
      if (s.hurt !== null && s.hurt <= 0) { deaths++; await sky.waitForTimeout(800); row = await fight(sky, 'storm-titan'); continue; }
      if (!s.riding && ++throws % 8 === 0) await mount();
      // The heart stands out over the cloud sea: a rider who rode at it would fall and restart him. Keep inside, round the arena, as a player does.
      const out = Math.hypot(s.at.x - s.centre.x, s.at.z - s.centre.z) / s.radius;
      await sky.evaluate(([cx, cz, far]) => { const { player } = window.__wildshard.world, { x, z } = player.position, home = Math.atan2(-(cx - x), -(cz - z)); player.yaw = far ? home : home + 1.2; player.pitch = 0; }, [s.centre.x, s.centre.z, out > 0.55]);
      if (!s.open) { await ride(0.6, 0); await sky.waitForTimeout(300); row = await fight(sky, 'storm-titan'); continue; }
      await ride(s.riding ? 0.5 : 0, 0); await sky.waitForTimeout(1150); // a full draw: a rider keeps moving, off the spear's mark
      const was = (await fight(sky, 'storm-titan'))?.hp ?? hp, now = await read(), point = aim(now, now.focus);
      await faceAt(sky, point); await sky.waitForTimeout(40);
      await drawn(false); shots++; await sky.waitForTimeout(350 + point.d * 12);
      await drawn(true);
      row = await fight(sky, 'storm-titan');
      const hit = (row?.hp ?? was) < was;
      if (hit) { landed++; if (now.riding) saddle++; first ??= { shots, d: Math.round(point.d), hp: row?.hp, riding: now.riding }; } else { side = 0.2 * [1, 0.5, 0, -0.5, -1, 1.5][shots % 6]; up_ = 0.15 * [1, 0.4, 1.6][shots % 3]; }
      if ((row?.hp ?? was) > was) resets++;
      const held = await sky.evaluate(() => ({ page: window.__wildshard.world.game.app.equipment.current.state.bolts ?? null }));
      log.push(`${Math.round(point.d)}m ${hit ? 'HIT' : 'miss'} hp${(row?.hp ?? 0).toFixed(3)} ride${Number(now.riding)} arrows${held.page}/${((await report(sky)).owned['held.arrows'] ?? 1) - 1}`);
      hp = row?.hp ?? hp;
    }
    await drawn(false); await ride(0, 0);
    const end_ = await read();
    return { ok: up === true && landed > 0, up, shots, landed, saddle, deaths, resets, first, state: row?.state, phase: row?.phase, hp: row?.hp, riding: end_.riding, startedRiding: seen.riding, wind: end_.wind, log: log.slice(-12), corrections: (await report(sky)).corrections };
  });
  // Behind a flag: a Titan left standing mustn't turn a run red that came for the bar. `--titan` is the fight itself, for his score. His row has no
  // body, so `fightTo` has nothing to swing at (`row.at` is null): the heart stands 70 m off in a gale, so the proof carries a drawn bow up to it, and
  // every blow, chip and rider is the server's own. Under `?bossGod`: a proof that stood in the grass would die to the spear and restart him.
  if (process.argv.includes('--titan')) {
    const titan = page => page.evaluate(() => { const fightOf = window.__wildshard.shard['nalati.titan'].openFight, { field, scorch } = fightOf.viewLoan, modes = Array.from(field.modeCells), { x, y, z } = fightOf.body.focusPoint;
      return { open: fightOf.open, focus: { x, y, z }, hot: modes.flatMap((mode, cell) => mode === field.rows.states.active ? [{ x: field.x(cell), z: field.z(cell) }] : []), spent: modes.filter(mode => mode === field.rows.states.spent).length, scorch: scorch.count }; });
    const bow = (page, on) => page.evaluate(held => { window.__wildshard.world.game.app.equipment.altHeld = held; }, on);
    let spot = 0;
    const away = async page => { const a = spot++ * 2.4, x = -30 + Math.cos(a) * 14, z = -20 + Math.sin(a) * 14; await place(page, x, await groundAt(page, x, z) + 0.6, z); };
    const heartShot = async page => {
      const { focus } = await titan(page);
      await place(page, focus.x + 1, focus.y - 12, focus.z + 14); await page.waitForTimeout(160);
      await faceAt(page, (await titan(page)).focus); await page.waitForTimeout(60);
      await bow(page, false); await page.waitForTimeout(350);
      await away(page); await page.waitForTimeout(300);
    };
    const riders = page => page.evaluate(() => window.__wildshard.world.animals.animals.filter(body => body.rowDriven && body.alive && body.kind === 'ghost-rider').map(({ position: { x, y, z } }) => ({ x, y, z })));
    await step('chapters: the Titan falls to real blows, and his score plays', async () => {
      const { page: sky } = storm, up = await until(sky, async () => (await fight(sky, 'storm-titan'))?.state === 'fight', 30);
      const log = [], end = Date.now() + 420_000, say = async note => { const row = await fight(sky, 'storm-titan'), seen = await titan(sky); log.push(`${note} ${row?.state} p${row?.phase} hp${row?.hp.toFixed(2)} hot${seen.hot.length} scorch${seen.scorch}`); };
      let row = await fight(sky, 'storm-titan'), shots = 0, wasOpen = false, burned = null;
      await bow(sky, true);
      while (Date.now() < end && row?.state !== 'victory') {
        const seen = await titan(sky);
        if (shots++ % 10 === 0) await sky.evaluate(() => { window.__workerClientHits(1); });
        if (row?.phase === 0) {
          if (seen.open && !wasOpen) { await heartShot(sky); await bow(sky, true); await away(sky); } else if (row.state === 'fight' && Math.random() < 0.1) await away(sky);
          wasOpen = seen.open;
          await sky.waitForTimeout(100);
        } else if (row?.phase === 1 && row.shield) {
          const [first] = await riders(sky);
          await sky.waitForTimeout(1150);
          if (first !== undefined) {
            await place(sky, first.x + 3, first.y + 0.4, first.z + 3); await sky.waitForTimeout(260);
            const [now = first] = await riders(sky); await faceAt(sky, { x: now.x, y: now.y + 1.4, z: now.z }); await sky.waitForTimeout(50);
          }
          await bow(sky, false); await sky.waitForTimeout(450); await bow(sky, true);
        } else if (row?.phase === 2 && burned === null) {
          // The grass fire: flames and scorch on the page, in step with its cells.
          if (seen.hot.length > 0 && seen.spent > 5) { burned = { hot: seen.hot.length, spent: seen.spent, scorch: seen.scorch }; await say('burning'); await sky.screenshot({ path: 'tmp/titan/fire.png' }).catch(() => undefined); }
          else { await away(sky); await sky.waitForTimeout(700); }
        } else if (row?.state === 'fight') { await sky.waitForTimeout(1150); await heartShot(sky); await bow(sky, true); }
        else await sky.waitForTimeout(250);
        const next = await fight(sky, 'storm-titan');
        if (next?.phase !== row?.phase || next?.state !== row?.state) await say('now');
        row = next;
      }
      await bow(sky, false);
      await sky.waitForTimeout(1500);
      const heard = await heardOf(sky), words = await arenaDrawn(sky), reward = (await fight(sky, 'storm-titan'))?.reward ?? null;
      if (reward !== null) { await place(sky, reward.x + 1, reward.y - 1.2, reward.z + 1); await sky.waitForTimeout(1500); await faceAt(sky, reward); for (let i = 0; i < 6 && (await fight(sky, 'storm-titan'))?.reward !== null; i++) { await press(sky); await sky.waitForTimeout(800); } }
      await sky.waitForTimeout(1000);
      const { owned, flags } = await report(sky);
      return { ok: row?.state === 'victory' && heard.includes('sting chunk') && heard.includes('combat 1') && burned !== null && burned.scorch === burned.spent && owned['item.naizagai'] === 1 && owned['item.sky-marked-saddle'] === 1 && (words.words['open-arena.cells'] ?? 0) > 0 && (words.words['open-arena.fire'] ?? 0) > 0,
        up: up === true, state: row?.state, phase: row?.phase, hp: row?.hp, burned, heard, naizagai: owned['item.naizagai'] ?? 0, saddle: owned['item.sky-marked-saddle'] ?? 0, dead: flags.filter(flag => flag.startsWith('dead:')), log: log.slice(-16), words: words.words };
    });
  }
  await step('chapters: the storm page raises no page error', () => ({ ok: storm.errors.length === 0, errors: [...new Set(storm.errors)].slice(0, 6) }));
  await storm.context.close();
}

/** Qara Batyr on a server: a night's patrol thinned by real kills brings him, his lane, his fall and his orb are the server's, and a save keeps him fallen. */
async function qaraJourney(browser, phone, base, step) {
  const steppe = await open(browser, phone, base, 'nalati-grasslands', '&bossGod'), { page } = steppe, id = 'qara-batyr';
  const riders = () => page.evaluate(() => window.__wildshard.world.animals.animals.filter(body => body.rowDriven && body.alive && body.kind === 'ghost-rider').map(({ variant, position: { x, y, z } }) => ({ variant, x, y, z })));
  const bow = on => page.evaluate(held => { window.__wildshard.world.game.app.equipment.altHeld = held; }, on);
  const shoot = async at => {
    await bow(true); await page.waitForTimeout(1150);
    const [from = at] = await riders(); await page.waitForTimeout(100);
    const [now = from] = await riders(), lead = 3.4, x = now.x + (now.x - from.x) * lead, z = now.z + (now.z - from.z) * lead; // a line rides at 11 m/s: shoot where it will be
    await place(page, x + 3, now.y + 0.4, z + 3); await page.waitForTimeout(230);
    await faceAt(page, { x, y: now.y + 2.2, z }); await page.waitForTimeout(40);
    await bow(false); await page.waitForTimeout(400);
  };
  await page.evaluate(() => { const seen = window.__feedSeen = [], root = document.body; new MutationObserver(rows => { for (const row of rows) for (const node of row.addedNodes) { const text = (node.textContent ?? '').trim(); if (/his back is OPEN/u.test(text) && !seen.includes(text)) seen.push(text); } }).observe(root, { childList: true, subtree: root === document.body }); });
  await step('qara: a night\'s patrol, thinned by real kills, brings its captain on a row', async () => {
    await page.evaluate(() => { window.__workerClientHits(40); window.__workerClientTime('night'); });
    await page.waitForTimeout(2500); await joinSecond(page);
    let row = null, shots = 0;
    const end = Date.now() + 320_000;
    while (Date.now() < end) {
      row = await fight(page, id);
      if (row?.at !== null && row?.at !== undefined) break;
      const [first] = await riders();
      if (first === undefined) { await place(page, 0, await groundAt(page, 0, 0) + 1, 0); await page.waitForTimeout(1000); continue; } // a line rides for the camp, and a page holds only the rows near it
      await shoot(first);
      if (++shots % 12 === 0) await page.evaluate(() => { window.__workerClientHits(1); });
    }
    const line = await riders();
    return { ok: row?.at !== null && row?.at !== undefined && row.name !== null, state: row?.state, at: row?.at, name: row?.name, shots, captains: line.filter(body => body.variant === 'captain').length, kills: (await report(page)).kills };
  });
  await step('qara: his charge lane is drawn off the server\'s words, and his bar off his row', async () => {
    const row = await fight(page, id);
    if (row?.at === null || row?.at === undefined) return { ok: false, why: 'no captain' };
    await place(page, row.at.x + 14, row.at.y + 0.4, row.at.z + 14);
    const lane = await until(page, async () => { const drawn = (await report(page)).drawn['elite lane'] ?? 0, seen = await fight(page, id); if (seen?.at !== null && seen?.at !== undefined) { await faceAt(page, { ...seen.at, y: seen.at.y + 1.4 }); } return drawn > 0 ? drawn : null; }, 45, 500);
    await page.screenshot({ path: 'tmp/flip16/qara-lane.png' }).catch(() => undefined);
    return { ok: lane !== null, lane, state: (await fight(page, id))?.state, shown: await bossBar(page) };
  });
  await step('qara: real blows end him, and his orb is taken', async () => {
    await page.evaluate(() => { window.__workerClientHits(1); });
    await until(page, async () => (await report(page)).drawn['elite cue'] > 0 && (await page.evaluate(() => window.__feedSeen?.length ?? 0)) > 0, 25); // a pass he finishes says his back is open
    let end = await fight(page, id);
    const until_ = Date.now() + 60_000;
    while (Date.now() < until_ && end?.state !== 'dead') {
      await bow(true); await page.waitForTimeout(1150);
      const from = (await fight(page, id))?.at ?? null; await page.waitForTimeout(100);
      const now = (await fight(page, id))?.at ?? from;
      if (from !== null && now !== null) {
        const x = now.x + (now.x - from.x) * 3.4, z = now.z + (now.z - from.z) * 3.4;
        await place(page, x + 3, now.y + 0.4, z + 3); await page.waitForTimeout(230);
        await faceAt(page, { x, y: now.y + 2, z }); await page.waitForTimeout(40);
      }
      await bow(false); await page.waitForTimeout(400);
      end = await fight(page, id);
    }
    await page.waitForTimeout(800);
    const row = await fight(page, id), { reward } = row ?? {};
    if (reward !== null && reward !== undefined) { await place(page, reward.x + 0.6, reward.y - 1.2, reward.z + 0.6); await page.waitForTimeout(1200); await faceAt(page, reward); for (let i = 0; i < 6 && (await fight(page, id))?.reward !== null; i++) { await press(page); await page.waitForTimeout(700); } }
    const after = await fight(page, id), r = await report(page);
    return { ok: end?.state === 'dead' && reward !== null && reward !== undefined && after?.reward === null && r.flags.includes('felled:qara-batyr'), cues: r.drawn['elite cue'] ?? 0, state: after?.state, sleep: after?.sleep, reward, flags: r.flags.filter(flag => /felled|feather/u.test(flag)), feed: await page.evaluate(() => window.__feedSeen ?? []) };
  });
  await step('qara: a save keeps him fallen and a page\'s fresh boot reads it back', async () => {
    await page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    const before = await fight(page, id);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const { restored } = await report(page), row = await fight(page, id);
    return { ok: restored === true && row?.state === 'dead' && row.sleep > 0, restored, state: row?.state, sleep: row?.sleep, before: before?.sleep };
  });
  await step('qara: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
}

/** Qyran, whole: a storm brings him over his rock on a row, he climbs off his height, his beam and chevron and his fall come off the server's words,
 *  he lands where a player was and real arrows from the ground end him, and a save keeps him fallen. No god mode: his stoop is dodged as a player does. */
async function qyranJourney(browser, phone, base, step) {
  const steppe = await open(browser, phone, base, 'nalati-grasslands'), { page } = steppe, id = 'qyran', rock = { x: 180, z: 85 };
  const bird = () => page.evaluate(() => { const body = window.__wildshard.world.animals.animals.find(row => row.rowDriven && row.kind === 'eagle'); if (body === undefined) return null; const { x, y, z } = body.position, { mem, alive, hp } = body; return { x, y, z, alive, hp, ground: mem.ground ?? 0, fold: mem.fold ?? 0, flap: mem.flap ?? 0, altY: mem.altY ?? null }; });
  const bow = on => page.evaluate(held => { window.__wildshard.world.game.app.equipment.altHeld = held; }, on);
  const feet = async (x, z) => { await place(page, x, await groundAt(page, x, z) + 0.6, z); };
  const drew = async name => (await report(page)).drawn[name] ?? 0;
  const landed = seconds => until(page, async () => { const seen = await bird(); return seen !== null && seen.alive && seen.ground === 1 ? seen : null; }, seconds, 100);
  await step('qyran: a storm brings him over his rock on a row, with his bar, and he flies', async () => {
    await page.evaluate(() => { window.__workerClientHits(3); window.__workerClientSky('storm'); });
    await page.waitForTimeout(1200);
    const row = await until(page, async () => { await page.evaluate(() => { window.__workerClientSky('storm'); }); await feet(rock.x, rock.z - 70); await page.waitForTimeout(600); const seen = await fight(page, id); return seen?.at !== null && seen?.at !== undefined ? seen : null; }, 90, 400);
    if (row === null) return { ok: false, why: 'no storm brought him', row: await fight(page, id), r: (await report(page)).refused };
    await joinSecond(page);
    const flown = await until(page, async () => { const seen = await bird(); return seen !== null && seen.y - await groundAt(page, seen.x, seen.z) > 12 ? seen : null; }, 20);
    const shown = await until(page, async () => { const words = await bossBar(page); return words.elite.length > 0 ? words : null; }, 12);
    return { ok: flown !== null && shown !== null && row.name !== null, state: (await fight(page, id))?.state, name: row.name, flown, shown };
  });
  await step('qyran: his beam and chevron are drawn off the server\'s words, and his stoop misses a player who moves', async () => {
    await page.evaluate(() => { const { player } = window.__wildshard.world; player.pitch = -0.2; }); // looking away: the chevron is what says where he is
    const beam = await until(page, async () => (await drew('elite wind') > 0), 40, 80);
    const chevron = await page.evaluate(() => document.querySelector('.ws-elite-chevron')?.classList.contains('show') ?? null);
    await page.screenshot({ path: 'tmp/flip17/qyran-beam.png' }).catch(() => undefined);
    const at = await page.evaluate(() => { const { x, z } = window.__wildshard.world.player.position; return { x, z }; });
    await page.waitForTimeout(1250); await feet(at.x + 9, at.z + 9); // the tell tracks you, then the stoop locks where you stood: run as it locks
    const down = await landed(12);
    await page.screenshot({ path: 'tmp/flip17/qyran-grounded.png' }).catch(() => undefined);
    const words = await report(page);
    return { ok: beam === true && down !== null && (words.drawn['elite moment'] ?? 0) > 0, wind: words.drawn['elite wind'], moments: words.drawn['elite moment'], chevron, down };
  });
  await step('qyran: real arrows from the ground end him when he lands, his bar turns, and his orb is taken', async () => {
    const end = Date.now() + 240_000, hps = [];
    let row = await fight(page, id), shots = 0, phase = 0, heard = await drew('elite wind'), dodged = false;
    while (Date.now() < end && row?.state !== 'dead') {
      const seen = await bird();
      if (seen === null) { await page.waitForTimeout(300); row = await fight(page, id); continue; }
      if (seen.ground === 1) { // he has about 2 s on the ground: stand off, face him, loose a drawn bow
        await feet(seen.x + 2.2, seen.z + 2.2); await page.waitForTimeout(260);
        const low = await bird(); if (low !== null) Object.assign(seen, low); // he settles at his height in the first moments
        await faceAt(page, { ...seen, y: seen.y + 0.15 }); await page.waitForTimeout(40); // his body lies level at his height: 0.5 m wide
        await bow(false); await page.waitForTimeout(350); shots++;
        await bow(true); await page.waitForTimeout(1150); await faceAt(page, { ...seen, y: seen.y + 0.15 }); await bow(false); shots++;
        await page.waitForTimeout(300);
      } else {
        const words = await drew('elite wind');
        // His flight is about 13 s and a held bow's arms give out at 8 s, so the finger stays up until his beam is. Held the whole way, the shot on
        // landing was a lift, and the only arrow left as he rose: on WebKit's timing that missed and the step ran out of time at 4 % of his health.
        if (words > heard && !dodged) { // his beam is up: step off his line late, and a stoop that misses grounds him
          dodged = true; await bow(true); await page.waitForTimeout(1250);
          const me = await page.evaluate(() => { const { x, z } = window.__wildshard.world.player.position; return { x, z }; }), turn = Math.random() * Math.PI * 2;
          await feet(me.x + Math.cos(turn) * 8, me.z + Math.sin(turn) * 8);
        } else if (words === heard) dodged = false;
        heard = words;
        await page.waitForTimeout(260);
      }
      row = await fight(page, id); phase = Math.max(phase, row?.phase ?? 0); hps.push(Math.round((row?.hp ?? 0) * 100));
    }
    await bow(false); await page.waitForTimeout(900);
    const at = await fight(page, id), { reward } = at ?? {};
    await page.screenshot({ path: 'tmp/flip17/qyran-fall.png' }).catch(() => undefined);
    let prompts = null;
    if (reward !== null && reward !== undefined) { // he can fall in the river: stand on the ground beside his orb
      for (const off of [0.6, -0.7, 1.1]) {
        await feet(reward.x + off, reward.z + off); await page.waitForTimeout(1200); await faceAt(page, reward);
        prompts = await page.evaluate(() => { const { world } = window.__wildshard, { position: p } = world.player; return { at: [p.x, p.y, p.z], near: world.interactables.filter(item => item.radius > 0 && item.position.distanceTo(p) < 8).map(item => `${item.label} ${item.position.distanceTo(p).toFixed(1)}/${item.radius}`).slice(0, 5) }; });
        for (let i = 0; i < 3 && (await fight(page, id))?.reward !== null; i++) { await press(page); await page.waitForTimeout(500); }
        if ((await fight(page, id))?.reward === null) break;
      }
    }
    const after = await fight(page, id), r = await report(page);
    return { hits: r.hits, left: after?.reward ?? null, prompts, ok: at?.state === 'dead' && phase >= 1 && reward !== null && reward !== undefined && after?.reward === null && r.flags.includes('felled:qyran'), state: after?.state, sleep: after?.sleep, shots, phase, reward, hps: [...new Set(hps)], flags: r.flags.filter(flag => /felled|feather/u.test(flag)), arrows: r.owned['held.arrows'] };
  });
  await step('qyran: a save keeps him fallen and a page\'s fresh boot reads it back', async () => {
    await page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    const before = await fight(page, id);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const { restored } = await report(page), row = await fight(page, id);
    return { ok: restored === true && row?.state === 'dead' && row.sleep > 0, restored, state: row?.state, sleep: row?.sleep, before: before?.sleep };
  });
  await step('qyran: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
}

/** Run the fights; `step` prints one line each. */
/** The night: a Developer's time reaches the server, a statue walks out on its row, and a topple is a clue on the page. */
const BOWL = [0, 24];
async function nightJourney(browser, phone, base, step) {
  const steppe = await open(browser, phone, base, 'nalati-grasslands');
  const { page } = steppe;
  await page.evaluate(() => { window.__toasts = []; new MutationObserver(list => { for (const row of list) for (const node of row.addedNodes) if (node.classList?.contains('ws-game-toast')) window.__toasts.push(node.textContent); }).observe(document.body, { childList: true, subtree: true }); window.__workerClientHits(60); });
  for (const flag of ['talked:elder', 'tamed:horse', 'won:kokpar', 'told:tulpar', 'talked:elder:2']) await page.evaluate(wanted => { window.__workerClientFlag(wanted); }, flag);
  const awakeRow = () => page.evaluate(() => window.__workerClientRow('slots.awake.0'));
  const statues = () => page.evaluate(() => { const set = [...window.__wildshard.shard['nalati.dressing'].sites.values()].map(row => row.sites).find(row => typeof row?.isAwake === 'function'); return set.sites.map((site, index) => ({ x: site.x, y: site.y, z: site.z, awake: set.isAwake(index) })); });
  await step('the page\'s sky follows the server\'s', async () => {
    const drawn = () => page.evaluate(() => window.__wildshard.shard['nalati.weather']?.weather?.state ?? null), was = await drawn();
    await page.evaluate(() => { window.__workerClientSky('storm'); });
    const storm = await until(page, async () => await drawn() === 'storm', 8), row = await page.evaluate(() => window.__workerClientRow('weather.phase')), rain = await page.evaluate(() => window.__wildshard.shard['nalati.weather'].weather.rain);
    await page.evaluate(() => { window.__workerClientSky('clear'); });
    const clear = await until(page, async () => await drawn() === 'clear', 8);
    return { ok: storm === true && clear === true, was, storm, clear, row, rain };
  });
  await step('night: the Developer\'s time reaches the server', async () => {
    const before = (await report(page)).day;
    await page.evaluate(() => { window.__workerClientTime('night'); });
    const day = await until(page, async () => { const now = (await report(page)).day; return now !== before ? now : null; }, 10);
    await page.waitForTimeout(1500);
    const settled = (await report(page)).day;
    return { ok: day !== null && settled !== before, before, day, settled };
  });
  await step('night: statues wake, their sites go empty on a row, and the page takes them down', async () => {
    const word = await until(page, async () => { const row = await awakeRow(); return row !== undefined && row !== 0 ? row : null; }, 25);
    await page.waitForTimeout(600);
    const sites = await statues();
    return { ok: word !== null && sites.some(site => site.awake), word, down: sites.filter(site => site.awake).length, of: sites.length };
  });
  await step('night: one rises out of the ground, drawn on its row', async () => {
    const site = (await statues()).find(row => row.awake);
    if (site === undefined) return { ok: false, why: 'no empty site' };
    await place(page, site.x + 7, await groundAt(page, site.x + 7, site.z) + 1, site.z);
    const low = await until(page, () => bodyOf(page, 'balbal'), 12);
    if (low === null) return { ok: false, why: 'no body on the page', rows: await page.evaluate(() => window.__workerClientRows('balbal')) };
    const under = low.y - await groundAt(page, low.x, low.z);
    await faceAt(page, { x: low.x, y: low.y + 1, z: low.z });
    await page.waitForTimeout(2500);
    const up = await bodyOf(page, 'balbal'), over = up === null ? null : up.y - await groundAt(page, up.x, up.z), r = await report(page);
    return { ok: up !== null && over > under, under, over, kind: up?.kind, rows: r.rows, retired: r.retired };
  });
  await step('night: the wake\'s cue fired, and a balbal\'s tell wedge drew', async () => {
    const wedgeUp = () => page.evaluate(() => window.__wildshard.world.game.scene.getObjectsByProperty('name', 'tell-wedge').some(mesh => mesh.visible));
    const hunted = await bodyOf(page, 'balbal');
    if (hunted === null) return { ok: false, why: 'no body to stand by' };
    await place(page, hunted.x + 2, await groundAt(page, hunted.x + 2, hunted.z) + 1, hunted.z);
    const up = await until(page, async () => (await wedgeUp()) === true ? true : null, 25, 100), r = await report(page);
    await page.screenshot({ path: 'tmp/flip8/night-wedge.png' }).catch(() => undefined);
    const wake = r.drawn['cue.balbal.wake'] ?? 0, wedge = r.drawn.wedge ?? 0;
    return { ok: wake > 0 && wedge > 0 && up === true, wake, wedge, up, drawn: r.drawn };
  });
  await page.screenshot({ path: 'tmp/flip8/night-balbal.png' }).catch(() => undefined);
  await step('night: a save out of the ground comes back as it stood', async () => {
    const before = await statues(), word = await awakeRow();
    await page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    const saved = await report(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => { window.__toasts = []; new MutationObserver(list => { for (const row of list) for (const node of row.addedNodes) if (node.classList?.contains('ws-game-toast')) window.__toasts.push(node.textContent); }).observe(document.body, { childList: true, subtree: true }); window.__workerClientHits(60); });
    const back = await until(page, async () => (await awakeRow()) === word, 12), down = (await statues()).filter(site => site.awake).length, r = await report(page);
    await page.waitForTimeout(1500);
    return { ok: saved.savedOk && r.restored && back === true && down === before.filter(site => site.awake).length, savedOk: saved.savedOk, restored: r.restored, word, row: await awakeRow(), down, balbal: await bodyOf(page, 'balbal') };
  });
  await step('night: real blows topple it, and it reads as a clue on the page', async () => {
    const paid = await report(page), end = Date.now() + 60_000;
    for (;;) {
      const r = await report(page);
      if (r.flags.includes('clue:1') || Date.now() > end) break;
      const body = await bodyOf(page, 'balbal');
      await (body === null ? page.waitForTimeout(400) : loose(page, { x: body.x, y: body.y + 1, z: body.z }));
    }
    await page.waitForTimeout(1500);
    const r = await report(page), toasts = await page.evaluate(() => window.__toasts.slice(-4)), reading = await page.evaluate(() => (document.body.textContent ?? '').includes('A toppled balbal'));
    const shown = reading ? true : toasts.some(line => line.includes('carving'));
    return { ok: r.flags.includes('clue:1') && shown, hits: r.hits - paid.hits, kills: r.kills - paid.kills, flags: r.flags.filter(flag => flag.startsWith('clue')), said: Object.entries(r.owned).filter(([line]) => line.startsWith('said.')), toasts, reading, retired: r.retired };
  });
  await step('night: a blow chips it, and its fall breaks on the page', async () => {
    const { drawn } = await report(page), chips = Object.entries(drawn).filter(([id]) => /^cue\.balbal\.(chip|crack)/u.test(id)), broken = drawn['cue.balbal.broken'] ?? 0;
    return { ok: chips.length > 0 && broken > 0, chips, broken };
  });
  await page.screenshot({ path: 'tmp/flip8/night-clue.png' }).catch(() => undefined);
  await step('night: ghost riders ride on rows, dressed', async () => {
    await place(page, BOWL[0], await groundAt(page, BOWL[0], BOWL[1]) + 1, BOWL[1]);
    const riders = await until(page, async () => (await page.evaluate(() => window.__workerClientRows('ghost-rider')))[0] ?? null, 45, 1000);
    if (riders === null) return { ok: false, why: 'no rider came round the bowl' };
    await place(page, riders.x + 14, riders.y + 2, riders.z);
    const drawn = await until(page, () => page.evaluate(() => { const body = window.__wildshard.world.animals?.animals.find(row => row.kind === 'ghost-rider' && row.rowDriven); return body === undefined ? null : { material: body.mesh.material.name, scale: body.scale }; }), 12);
    return { ok: drawn !== null && drawn.material.startsWith('nalati-ghost'), drawn, retired: (await report(page)).retired };
  });
  await step('night: a rider looses, and its arrow flies on the page', async () => {
    const arrows = () => page.evaluate(() => { const mesh = window.__wildshard.world.game.scene.getObjectByName('patrol-arrows'), matrices = mesh?.instanceMatrix.array ?? []; let shown = 0; for (let at = 0; at < matrices.length; at += 16) if (matrices[at] !== 0 || matrices[at + 1] !== 0 || matrices[at + 2] !== 0) shown++; return shown; });
    const riders = await page.evaluate(() => window.__workerClientRows('ghost-rider'));
    if (riders[0] !== undefined) await place(page, riders[0].x + 24, riders[0].y + 2, riders[0].z);
    const seen = await until(page, async () => { const shown = await arrows(); return shown > 0 ? shown : null; }, 45, 100);
    await page.screenshot({ path: 'tmp/flip8/night-arrow.png' }).catch(() => undefined);
    await page.waitForTimeout(1500); // a shot that flies a second's frames is an arrow, and not one that stopped where it left
    const r = await report(page), frames = r.drawn['arrow frame'] ?? 0;
    return { ok: seen !== null && (r.drawn.shot ?? 0) > 0 && frames > 3, shot: r.drawn.shot, frames, seen, hurt: r.drawn.hurt, hp: r.hp };
  });
  await step('night: a rider\'s gallop leaves its trail on the page', async () => {
    const before = (await report(page)).drawn['cue.ghost.trail'] ?? 0;
    await page.waitForTimeout(1500);
    const trail = (await report(page)).drawn['cue.ghost.trail'] ?? 0;
    return { ok: trail > before, before, trail };
  });
  await step('night: dawn sends the rest home, and their sites stand', async () => {
    await page.evaluate(() => { window.__workerClientTime('midday'); });
    const torn = await until(page, async () => { const count = (await report(page)).drawn['cue.ghost.tear'] ?? 0; return count > 0 ? count : null; }, 8, 100);
    // A body goes home on its own feet, so a body nobody's near waits for them: go round them.
    const end = Date.now() + 60_000;
    while ((await awakeRow()) !== 0 && Date.now() < end) {
      const site = (await statues()).find(row => row.awake);
      if (site !== undefined) await place(page, site.x + 7, await groundAt(page, site.x + 7, site.z) + 1, site.z);
      await page.waitForTimeout(4000);
    }
    const clear = (await awakeRow()) === 0;
    const r = await report(page);
    return { ok: clear && torn !== null, torn, row: await awakeRow(), left: (await page.evaluate(() => window.__workerClientRows('balbal'))).length, retired: r.retired };
  });
  await step('night: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
}

/** Past one player: a door a second client swings, a bar that stays each player's own, a door across a reload, and a chapter's fact filed once. */
async function secondClientJourney(browser, phone, base, step) {
  const pine = await open(browser, phone, base, 'pine-hollow');
  const { page } = pine, MILL = { x: -178.09, z: -145.32 }, millWire = 'cabin-7-door', millId = `door:${millWire}`;
  const hasDoor = flag => async () => (await report(page)).flags.includes(flag) === true;
  const stood = (x, z) => groundAt(page, x, z).then(y => place(page, x, y + 0.4, z));
  const reopen = async () => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 }); await page.evaluate(FLOOR_GRID_ENTER); await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 }); };
  const free = await page.evaluate(wanted => { const row = window.__wildshard.world.interactables.find(entry => entry.wireId?.includes('door') && entry.wireId !== wanted); return row === undefined ? null : { id: row.wireId, x: row.position.x, y: row.position.y, z: row.position.z }; }, millWire);
  await step('second client: its press swings a door, and this page sees it', async () => {
    if (free === null) return { ok: false, why: 'no free door' };
    await page.evaluate(({ x, y, z }) => { window.__secondClient = window.__workerClientBot('bot:2', x + 0.8, y - 1, z + 0.8); }, free);
    await page.waitForTimeout(1500);
    await page.evaluate(id => { window.__secondClient.press(id); }, free.id);
    const opened = await until(page, hasDoor(`door:${free.id}`), 6);
    await page.waitForTimeout(1800);
    await page.evaluate(id => { window.__secondClient.press(id); }, free.id);
    const shut = await until(page, async () => !await hasDoor(`door:${free.id}`)(), 6);
    return { ok: opened === true && shut === true, id: free.id, opened, shut, flags: (await report(page)).flags.filter(flag => flag.startsWith('door')) };
  });
  await step('second client: a bar is each player\'s own', async () => {
    const barred = await page.evaluate(() => window.__wildshard.world.registry.get('mill-door-bar')?.active?.() ?? null);
    await page.evaluate(({ x, z, ground }) => { window.__secondClient.move(x + 1.1, ground + 0.4, z); }, { ...MILL, ground: await groundAt(page, MILL.x + 1.1, MILL.z) });
    await page.waitForTimeout(1500);
    await page.evaluate(id => { window.__secondClient.press(id); }, millWire);
    await page.waitForTimeout(1200);
    const refused = !await hasDoor(millId)();
    await page.evaluate(() => { window.__workerClientFlag('errand:done'); });
    const mine = await until(page, () => page.evaluate(() => window.__workerClientGate('errand:done')), 4);
    await page.evaluate(id => { window.__secondClient.press(id); }, millWire);
    await page.waitForTimeout(1200);
    const stillBarredForIt = !await hasDoor(millId)();
    await stood(MILL.x + 1.1, MILL.z); await page.waitForTimeout(1200); await press(page);
    const opened = await until(page, hasDoor(millId), 5);
    return { ok: barred === true && refused && mine === true && stillBarredForIt && opened === true, barred, refused, mine, stillBarredForIt, opened };
  });
  await step('a door left open stands open across a reload', async () => {
    await page.evaluate(() => { window.__secondClient.end(); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    const saved = await report(page);
    await reopen();
    await page.waitForTimeout(2000);
    const flagged = await hasDoor(millId)(), r0 = await report(page);
    await stood(MILL.x + 2.6, MILL.z); await page.waitForTimeout(1300);
    await walkInto(page, Math.PI / 2, 3.5, () => page.evaluate(wanted => window.__wildshard.world.player.position.x < wanted, MILL.x - 1));
    await page.waitForTimeout(500);
    const r = await report(page), went = r.x < MILL.x - 0.5 && r.serverX < MILL.x - 0.5;
    return { ok: saved.savedOk && r0.restored && flagged && went, savedOk: saved.savedOk, restored: r0.restored, flagged, went, x: r.x, serverX: r.serverX };
  });
  await step('second client: no page error', () => ({ ok: pine.errors.length === 0, errors: [...new Set(pine.errors)].slice(0, 6) }));
  await pine.context.close();
  const steppe = await open(browser, phone, base, 'nalati-grasslands');
  const nalati = steppe.page, FACT = 'nalati.quest.tulpar', filed = async () => (await report(nalati)).receipts.filter(line => line === `fact:${FACT}`).length, kept = () => nalati.evaluate(name => Object.keys(localStorage).map(key => (localStorage.getItem(key) ?? '').split(`"name":"${name}"`).length - 1).reduce((sum, count) => sum + count, 0), FACT);
  await step('a chapter\'s fact is filed once, and a reload adds none', async () => {
    const before = await kept();
    for (const flag of ['talked:elder', 'tamed:horse', 'won:kokpar', 'told:tulpar']) { await nalati.evaluate(wanted => { window.__workerClientFlag(wanted); }, flag); await nalati.waitForTimeout(300); }
    const done = await until(nalati, async () => (await report(nalati)).flags.includes('quest:tulpar'), 8);
    await nalati.waitForTimeout(2500);
    const once = await filed(), first = await kept(), all = (await report(nalati)).receipts;
    await nalati.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    await nalati.waitForTimeout(800);
    await nalati.reload({ waitUntil: 'load' }); await nalati.waitForFunction(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 }); await nalati.evaluate(FLOOR_GRID_ENTER); await nalati.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
    await nalati.waitForTimeout(4000);
    const again = await filed(), second = await kept();
    // A fresh page hears the server's book from the top. The page's own ledger keeps the fact once, however often it's told.
    return { ok: done === true && once === 1 && before === 0 && first <= 1 && second === first, done, once, again, before, first, second, receipts: all, keys: await nalati.evaluate(() => Object.keys(localStorage).slice(0, 30)) };
  });
  await step('nalati, a second time: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
}

/** The row's small words: a horse's prompt by its name, and the line a tie's press gets. */
async function wordsJourney(browser, phone, base, step) {
  const steppe = await open(browser, phone, base, 'nalati-grasslands');
  const { page } = steppe;
  await page.evaluate(() => { window.__toasts = []; new MutationObserver(list => { for (const row of list) for (const node of row.addedNodes) if (node.classList?.contains('ws-game-toast')) window.__toasts.push(node.textContent); }).observe(document.body, { childList: true, subtree: true }); });
  await step('a horse\'s prompt reads by its name', async () => {
    const horse = await until(page, () => bodyOf(page, 'horse'), 20);
    if (horse === null) return { ok: false, why: 'no horse near' };
    await place(page, horse.x + 1.5, horse.y + 0.6, horse.z);
    const shown = () => page.evaluate(() => { const list = window.__wildshard.shard['harness.shard.nalati-grasslands']?.ride?.mount?.interactables ?? []; return list.length === 0 ? null : list.map(row => row.label); }), labels = await until(page, shown, 12);
    return { ok: labels !== null && !labels.some(row => row.includes('creature:')), labels: labels?.slice(0, 4) };
  });
  await step('a tie\'s press gets its line on the page', async () => {
    const tie = await page.evaluate(() => { const row = window.__wildshard.world.interactables.find(entry => entry.wireId?.endsWith('.tie')); return row === undefined ? null : { x: row.position.x, z: row.position.z, id: row.wireId, radius: row.radius, label: row.label }; });
    if (tie === null) return { ok: false, why: 'no tie prompt' };
    await place(page, tie.x + 1.2, await groundAt(page, tie.x + 1.2, tie.z) + 0.5, tie.z);
    await page.waitForTimeout(2000);
    const label = await page.evaluate(() => window.__wildshard.world.interactables.find(entry => entry.wireId?.endsWith('.tie'))?.label ?? null);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await press(page);
    const line = await until(page, () => page.evaluate(() => window.__toasts.find(row => !row.startsWith('Discovered')) ?? null), 6);
    return { ok: line !== null, tie: tie.id, label, line, toasts: await page.evaluate(() => window.__toasts.slice(-3)) };
  });
  await step('words: no page error', () => ({ ok: steppe.errors.length === 0, errors: [...new Set(steppe.errors)].slice(0, 6) }));
  await steppe.context.close();
}

/** Every pooled point light as a frame sees it: the pool's size is what every lit program was built for. */
const poolLights = page => page.evaluate(() => {
  const { game } = window.__wildshard.requireWorld(), pool = (game.rootScene ?? game.scene).getObjectByName('light-pool');
  return (pool?.children ?? []).filter(light => light.isPointLight).map(light => ({ colour: light.color.toArray().map(value => Number(value.toFixed(2))), intensity: Number(light.intensity.toFixed(2)), at: light.position.toArray().map(value => Number(value.toFixed(1))), reach: light.distance }));
});
const eyeOf = page => page.evaluate(() => window.__wildshard.requireWorld().game.camera.position.toArray());
/** What hangs on the King, as the scene has it: read the same way on the row and on a page. Part names and meshes are `rows.socketRig`'s. */
const kingRig = page => page.evaluate(() => {
  const { game } = window.__wildshard.requireWorld(), root = game.rootScene ?? game.scene;
  const shown = from => { for (let at = from; at !== null; at = at.parent) if (!at.visible) return false; return true; };
  const cage = root.getObjectByName('king-ribcage'), lanterns = [], flames = [];
  root.traverse(at => { if (/^king-lantern\.\d+$/u.test(at.name)) lanterns.push(at); if (at.name === 'antler-king-lantern-fire') flames.push(at); });
  if (cage === undefined) return null;
  const [core, ribs] = cage.children, at = cage.getWorldPosition(cage.position.clone());
  return { shown: shown(cage), ribs: Number(ribs.scale.x.toFixed(3)), core: Number(core.scale.x.toFixed(3)), ribsGain: Number(ribs.material.emissiveIntensity.toFixed(3)), coreGain: Number(core.material.emissiveIntensity.toFixed(3)), glass: Number((lanterns[0]?.children.find(mesh => mesh.material.emissiveIntensity > 0)?.material.emissiveIntensity ?? 0).toFixed(3)), lanterns: lanterns.length, hung: lanterns.filter(shown).length, fire: flames.filter(shown).length, at: at.toArray().map(value => Number(value.toFixed(1))) };
});
/** The binds a body boss, a shard's light and a herd lair make as a fight begins, on rows. */
async function sweepJourney(browser, phone, base, step) {
  const dune = await open(browser, phone, base, 'sunscar-dunes');
  await step('sweep: Sunscar\'s rows wear its painter\'s light', async () => {
    const at = await dune.page.evaluate(() => { const { x, z } = window.__wildshard.world.player.position; return { x, z }; });
    const look = await until(dune.page, async () => { const seen = await rowLook(dune.page, at); return seen !== null && seen.standard > 0 ? seen : null; }, 20);
    return { ok: look !== null && look.painted === look.standard, look };
  });
  await dune.context.close();
  const far = await open(browser, phone, base, 'far-reach');
  await step('sweep: a body boss\'s row stays drawn at any distance', async () => {
    await place(far.page, 0, 45.5, -188);
    const row = await until(far.page, async () => { const seen = await fight(far.page, 'far.roc.encounter'); return seen?.state === 'fight' && seen.at !== null ? seen : null; }, 25);
    await far.page.waitForTimeout(800);
    const look = row === null ? null : await rowLook(far.page, row.at);
    return { ok: look?.pinned === true, look, state: row?.state };
  });
  await far.context.close();
  const steppe = await open(browser, phone, base, 'nalati-grasslands', '&bossGod');
  await step('sweep: Argymaq\'s row wears his colour', async () => {
    const lair = await steppe.page.evaluate(() => { const { x, z } = window.__wildshard.shard['nalati.elites'].elites.entry('argymaq').script.def.lair; return { x, z }; });
    const row = await until(steppe.page, async () => { const feet = await groundAt(steppe.page, lair.x + 12, lair.z); await place(steppe.page, lair.x + 12, feet + 0.4, lair.z); return bodyOf(steppe.page, 'argymaq'); }, 30, 1000);
    await steppe.page.waitForTimeout(500);
    const look = row === null ? null : await rowLook(steppe.page, row);
    return { ok: look?.kind === 'argymaq' && look.tint?.[0] === 0.62, look, lair };
  });
  /** A lair's tell as the page's elite holds it, and what the page has drawn of what it heard. */
  const tell = id => steppe.page.evaluate(want => { const { tell: ground } = window.__wildshard.shard['nalati.elites'].elites.entry(want).script; return { shown: ground.mesh.visible, drawn: window.__workerClient().drawn }; }, id);
  await step('sweep: Argymaq\'s charge lane is drawn off the server\'s words', async () => {
    const lane = await until(steppe.page, async () => { const row = await fight(steppe.page, 'argymaq'); if (row?.at !== null && row?.at !== undefined) { await place(steppe.page, row.at.x + 14, row.at.y + 0.4, row.at.z); await faceAt(steppe.page, row.at); } return (await report(steppe.page)).drawn['elite lane'] ?? null; }, 45, 800);
    return { ok: lane !== null, lane, shown: (await tell('argymaq')).shown, state: (await fight(steppe.page, 'argymaq'))?.state };
  });
  await step('sweep: Aqbars\'s pounce rings the ground, and its growl and feed are heard', async () => {
    await steppe.page.evaluate(() => { window.__workerClientTime('night'); });
    await place(steppe.page, 138, 62, -58);
    let shown = false;
    const seen = await until(steppe.page, async () => { const row = await fight(steppe.page, 'aqbars'); if (row?.at !== null && row?.at !== undefined) await place(steppe.page, row.at.x + 9, row.at.y + 0.4, row.at.z); const now = await tell('aqbars'); shown ||= now.shown; return shown && (now.drawn['elite moment'] ?? 0) > 0 ? now : null; }, 60, 400);
    return { ok: seen !== null, shown, seen, last: await tell('aqbars') };
  });
  await steppe.context.close();
}
/** Pine's King on a plain page: the row's numbers to read beside. The row off, and night and blows by hand. */
async function pageRigJourney(browser, phone, base, step, [x, z]) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', data: { time: 'night' }, merge: true });
  await page.goto(new URL('/?chunk=pine-hollow&mute=1&nolock=1&bossGod', base).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForTimeout(4000);
  const hold = () => page.evaluate(([px, pz]) => { const { player } = window.__wildshard.world, feet = window.__hf.heightAt(px, pz) + 0.1; player.position.set(px, feet, pz); player.motor?.resetAt(player.position); }, [x + 4, z]);
  await step('rigpage: on a page, what he wears and how it moves', async () => {
    const end = Date.now() + 100_000;
    let widest = null, dimmest = null, first = null;
    while (Date.now() < end) {
      await hold();
      const rig = await kingRig(page);
      if (rig?.shown === true) { first ??= rig; if (widest === null || rig.ribs > widest.ribs) widest = rig; if (dimmest === null || rig.ribs < dimmest.ribs) dimmest = rig; if (widest.ribs > dimmest.ribs + 0.2) break; }
      await page.waitForTimeout(120);
    }
    return { ok: first !== null && widest !== null && widest.ribs > dimmest.ribs + 0.1 && errors.length === 0, first, widest, dimmest, errors: errors.slice(0, 4) };
  });
  await context.close();
}
/** Pine's King on a server: his ribs, their glow and the lanterns hung off him all follow the fight. Worth reading beside `--only=rigpage`. */
async function rigJourney(browser, phone, base, step, [x, z]) {
  const pine = await open(browser, phone, base, 'pine-hollow', '&bossGod'), { page } = pine, trail = [];
  const king = async () => (await page.evaluate(() => window.__workerClientFights())).find(row => row.id === 'pine.king') ?? null;
  const hold = async () => { const feet = await groundAt(page, x + 4, z); await place(page, x + 4, feet + 0.4, z); };
  await step('rig: entry hangs nothing on nobody', async () => { const rig = await kingRig(page); return { ok: rig === null, rig }; });
  await step('rig: at night he comes dressed: ribs, core and every lantern, on him', async () => {
    await page.evaluate(() => { window.__workerClientHits(4); window.__workerClientTime('night'); });
    await hold();
    const rig = await until(page, async () => { await hold(); const seen = await kingRig(page); return seen?.shown === true ? seen : null; }, 60, 1000), row = await king();
    const away = rig === null || row?.at === null || row?.at === undefined ? null : Math.hypot(rig.at[0] - row.at.x, rig.at[2] - row.at.z);
    return { ok: rig !== null && rig.lanterns > 0 && rig.hung === rig.lanterns && rig.coreGain > 0 && away !== null && away < 6, rig, state: row?.state, away };
  });
  await step('rig: his ribs open and burn as the fight says', async () => {
    const end = Date.now() + 90_000;
    let widest = null, dimmest = null, row = await king();
    while (Date.now() < end) {
      await hold();
      const rig = await kingRig(page); row = await king();
      if (rig !== null) { trail.push([rig.ribs, rig.ribsGain, rig.coreGain]); if (widest === null || rig.ribs > widest.ribs) widest = rig; if (dimmest === null || rig.ribs < dimmest.ribs) dimmest = rig; }
      if (widest !== null && dimmest !== null && widest.ribs > dimmest.ribs + 0.1 && widest.ribsGain > dimmest.ribsGain) break;
      await page.waitForTimeout(120);
    }
    if (widest !== null) await page.screenshot({ path: 'tmp/rig-king-open.png' });
    return { ok: widest !== null && dimmest !== null && widest.ribs > dimmest.ribs + 0.1 && widest.ribsGain > dimmest.ribsGain, widest, dimmest, samples: trail.length, state: row?.state };
  });
  await step('rig: a blow in phase I sparks, and the second third drops the lanterns to burn on the ground', async () => {
    await page.evaluate(() => { window.__workerClientHits(8); }); // the blows that end phase I are real; only their size isn't: one at 60 ends him
    const end = Date.now() + 90_000;
    let rig = await kingRig(page), row = await king();
    while ((rig === null || rig.hung > 0 || rig.fire === 0) && Date.now() < end) {
      if (row?.at !== null && row?.at !== undefined) {
        await place(page, row.at.x + 5, row.at.y + 0.4, row.at.z + 5); await page.waitForTimeout(700);
        await faceAt(page, rig === null ? bodyMid(row.at) : { x: rig.at[0], y: rig.at[1] - 0.5, z: rig.at[2] }); await page.waitForTimeout(150);
        await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(1000);
      } else { await hold(); await page.waitForTimeout(400); }
      rig = await kingRig(page); row = await king();
    }
    if (rig !== null) await page.screenshot({ path: 'tmp/rig-king-dropped.png' });
    const seen = await report(page);
    return { ok: rig !== null && rig.hung === 0 && rig.fire > 0 && (seen.drawn.struck ?? 0) > 0, rig, struck: seen.drawn.struck, hits: seen.hits, hp: row?.hp, state: row?.state };
  });
  await step('rig: no page error', () => ({ ok: pine.errors.length === 0, errors: [...new Set(pine.errors)].slice(0, 6) }));
  await pine.context.close();
}
/** Pine's King: the amber on his ribs, the lantern in his dark, and the light let go when the fight ends. Colours are `rows.light`'s. */
async function lanternJourney(browser, phone, base, step, [x, z], blows) {
  const pine = await open(browser, phone, base, 'pine-hollow', '&bossGod'), { page } = pine, warned = [], AMBER = [1, 0.55, 0.18], LANTERN = [1, 0.72, 0.4];
  page.on('console', line => { if (/LightPool/u.test(line.text())) warned.push(line.text().slice(0, 160)); });
  const lit = async colour => (await poolLights(page)).find(light => light.intensity > 0 && light.colour.every((value, index) => Math.abs(value - (colour[index] ?? 0)) < 0.01)) ?? null;
  const king = async () => (await page.evaluate(() => window.__workerClientFights())).find(row => row.id === 'pine.king') ?? null;
  const hold = async () => { const feet = await groundAt(page, x + 4, z); await place(page, x + 4, feet + 0.4, z); };
  /** A bolt at his ribs, where the amber stands, from outside his reach. */
  const shoot = async at => {
    const ribs = await lit(AMBER), aim = ribs === null ? bodyMid(at) : { x: ribs.at[0], y: ribs.at[1] - 0.5, z: ribs.at[2] };
    const beyond = Math.hypot(at.x + 5 - x, at.z + 5 - z) > 20; // past the wall the fight resets: from his clearing's side then
    await place(page, at.x + (beyond ? -5 : 5), at.y + 0.4, at.z + (beyond ? -5 : 5)); await page.waitForTimeout(900);
    await faceAt(page, aim); await page.waitForTimeout(150);
    await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(1200);
  };
  const size = (await poolLights(page)).length;
  await step('lantern: entry lights nothing for a fight that has not begun', async () => {
    const lights = await poolLights(page);
    return { ok: size > 0 && await lit(AMBER) === null && await lit(LANTERN) === null, size, lit: lights.filter(light => light.intensity > 0), fights: await page.evaluate(() => window.__workerClientFights().map(row => row.id)) };
  });
  await step('lantern: the King comes at night, and the ribs burn amber at him', async () => {
    await page.evaluate(by => { window.__workerClientHits(by); window.__workerClientTime('night'); }, blows);
    await hold();
    const row = await until(page, async () => { await hold(); const seen = await king(); return seen?.at !== null && seen?.at !== undefined && seen.state !== 'dormant' ? seen : null; }, 40, 1000), light = await until(page, () => lit(AMBER), 30, 500), now = await king();
    const away = light === null || now?.at === null || now?.at === undefined ? null : Math.hypot(light.at[0] - now.at.x, light.at[2] - now.at.z);
    return { ok: row !== null && light !== null && away !== null && away < 6, state: now?.state, hp: now?.hp, light, away, size: (await poolLights(page)).length, warned };
  });
  // His adds shield him from the second third on, so the two ends are two fights: the dark on measured blows, the kill on one.
  if (blows < 100) await step('lantern: phase III falls dark, and the lantern lights the player', async () => {
    const end = Date.now() + 170_000;
    let light = null, row = await king();
    while (light === null && row?.state !== 'victory' && Date.now() < end) {
      if (row?.at !== null && row?.at !== undefined && row.hp > 0.31) await shoot(row.at); else { await hold(); await page.waitForTimeout(400); } // his last third: the dark comes on by itself, for a player inside the wall
      light = await lit(LANTERN); row = await king();
    }
    light = await until(page, () => lit(LANTERN), 12, 250);
    const eye = await eyeOf(page), away = light === null ? null : Math.hypot(light.at[0] - eye[0], light.at[2] - eye[2]);
    if (light !== null) await page.screenshot({ path: 'tmp/lantern-phase-iii.png' });
    const seen = await report(page), held = await page.evaluate(() => window.__wildshard.world.game.app.equipment.current?.id ?? null);
    return { ok: light !== null && light.intensity > 1 && away !== null && away < 2, hits: seen.hits, refused: seen.refused, held, hp: row?.hp, state: row?.state, light, eye: eye.map(value => Number(value.toFixed(1))), away, size: (await poolLights(page)).length, warned };
  });
  if (blows >= 100) await step('lantern: the fight ends, and the light is let go', async () => {
    const end = Date.now() + 100_000;
    let row = await king();
    while (row !== null && row.state !== 'victory' && row.hp > 0 && Date.now() < end) {
      if (row.at !== null) await shoot(row.at);
      row = await king();
    }
    const ended = row?.state === 'victory' || row?.hp === 0;
    await page.waitForTimeout(600);
    const lights = await poolLights(page);
    return { ok: ended && await lit(AMBER) === null && await lit(LANTERN) === null && lights.length === size, ended, row: row?.state, hp: row?.hp, size: lights.length, lit: lights.filter(light => light.intensity > 0), warned };
  });
  await step('lantern: no page error', () => ({ ok: pine.errors.length === 0, errors: [...new Set(pine.errors)].slice(0, 6) }));
  await pine.context.close();
}

export async function fights(browser, phone, base, only, step) {
  const runs = name => only === '' || only === 'fights' || only === name;
  if (only === 'titan') await stormJourney(browser, phone, base, step);
  if (runs('qara')) await qaraJourney(browser, phone, base, step);
  if (runs('qyran')) await qyranJourney(browser, phone, base, step);
  if (runs('rig')) await rigJourney(browser, phone, base, step, KINGS_CLEARING);
  if (runs('sweep')) await sweepJourney(browser, phone, base, step);
  if (only === 'rigpage') await pageRigJourney(browser, phone, base, step, KINGS_CLEARING);
  if (runs('lantern')) { await lanternJourney(browser, phone, base, step, KINGS_CLEARING, 4); await lanternJourney(browser, phone, base, step, KINGS_CLEARING, 3000); }

  // A boss: its row draws the bar, leaving resets it, a fall comes back, and real blows end it and pay.
  if (runs('roc')) {
    const far = await open(browser, phone, base, 'far-reach');
    const id = 'far.roc.encounter', crown = [0, 45.5, -188];
    await step('roc: walking in starts the fight, and the bar comes up off its row', async () => {
      await place(far.page, ...crown);
      const row = await until(far.page, async () => { const seen = await fight(far.page, id); return seen?.state === 'fight' ? seen : null; }, 20);
      await far.page.waitForTimeout(500);
      const shown = await bossBar(far.page);
      return { ok: row !== null && shown.bar.length > 0, state: row?.state, shown };
    });
    await step('roc: a lone player who leaves is still in it (a reset is for a room: J104)', async () => {
      await place(far.page, 0, 31, -5);
      await far.page.waitForTimeout(3000);
      const row = await fight(far.page, id), shown = await bossBar(far.page);
      return { ok: row?.state === 'fight' && shown.bar.length > 0, state: row?.state, shown };
    });
    await step('roc: real blows end it, it pays, and the bar goes', async () => {
      await far.page.evaluate(() => { window.__workerClientHits(40); });
      await place(far.page, ...crown);
      const paidBefore = await report(far.page);
      for (let i = 0; i < 80; i++) {
        const row = await fight(far.page, id);
        if (row?.state === 'victory') break;
        if (row?.at !== null && row?.at !== undefined) await strike(far.page, row.at, false);
        await far.page.waitForTimeout(400);
      }
      await stand(far.page);
      await far.page.waitForTimeout(2500);
      const row = await fight(far.page, id), done = await report(far.page), shown = await bossBar(far.page);
      return { ok: row?.state === 'victory' && done.paid > paidBefore.paid, state: row?.state, paid: done.paid, coins: done.owned.coins, shown };
    });
    await step('roc: no page error', () => ({ ok: far.errors.length === 0, errors: [...new Set(far.errors)].slice(0, 6) }));
    await far.context.close();
  }

  // A fight pays for blows: a player off the crown, however far they fall, ends nothing and earns nothing.
  if (runs('rocfall')) {
    const far = await open(browser, phone, base, 'far-reach');
    const id = 'far.roc.encounter', [cx, cy, cz] = [0, 45.5, -188], CROWN_REACH = 23;
    await step('roc: a player who falls off the crown ends nothing and earns nothing', async () => {
      await place(far.page, cx, cy, cz);
      await until(far.page, async () => (await fight(far.page, id))?.state === 'fight', 20);
      const before = await report(far.page), trail = [];
      let lowest = Infinity, fallen = 0;
      for (let round = 0; round < 6 && (await fight(far.page, id))?.state !== 'victory'; round++) { // over each of its moves in turn
        await place(far.page, cx, cy, cz);
        await far.page.waitForTimeout(2500 + round * 900);
        await place(far.page, cx + CROWN_REACH, cy - 2, cz); // over the edge, under its nose
        for (let i = 0; i < 16; i++) {
          await far.page.waitForTimeout(500);
          const row = await fight(far.page, id), height = await far.page.evaluate(() => window.__wildshard.world.player.position.y);
          lowest = Math.min(lowest, height);
          if (i % 5 === 0) trail.push({ y: Math.round(height), hp: row?.hp, state: row?.state, roc: row?.at === null || row?.at === undefined ? null : Math.round(row.at.y) });
          if (row?.state === 'victory') break;
        }
        fallen++;
      }
      const row = await fight(far.page, id), done = await report(far.page);
      return { ok: row?.state !== 'victory' && (row?.hp ?? 0) > 0 && done.paid === before.paid && done.hits === before.hits, state: row?.state, hp: row?.hp, fallen, lowest, paid: done.paid, coins: done.owned.coins, hits: done.hits, falls: done.falls, trail: trail.slice(-12) };
    });
    await far.context.close();
  }

  // Two real clients in one room: a boss resets when everyone has gone, and not before (J104).
  if (runs('rooms')) {
    const far = await open(browser, phone, base, 'far-reach');
    const { page } = far, id = 'far.roc.encounter', [cx, cy, cz] = [0, 45.5, -188], state = async () => (await fight(page, id))?.state ?? null;
    await step('two clients: a second real client joins and fights in the room', async () => {
      await place(page, cx, cy, cz);
      await page.evaluate(([x, y, z]) => { window.__secondClient = window.__workerClientBot('bot:1', x + 3, y, z); }, [cx, cy, cz]);
      const up = await until(page, async () => await state() === 'fight', 25);
      return { ok: up === true, state: await state(), closed: (await report(page)).closed };
    });
    await step('two clients: one leaves, and the fight goes on for the other', async () => {
      await place(page, 0, 31, -5);
      await page.waitForTimeout(4000);
      return { ok: await state() === 'fight', state: await state() };
    });
    await step('two clients: everyone gone resets the boss', async () => {
      await page.evaluate(() => { window.__secondClient.move(0, 31, -3); });
      const reset = await until(page, async () => { const seen = await state(); return seen !== 'fight' && seen !== 'beat' ? seen : null; }, 25);
      await page.waitForTimeout(800);
      const row = await fight(page, id);
      return { ok: reset !== null && row?.hp === 1, reset, row: { state: row?.state, hp: row?.hp }, bar: await bossBar(page) };
    });
    await step('two clients: it arms again for whoever comes back', async () => {
      await place(page, cx, cy, cz);
      const up = await until(page, async () => await state() === 'fight', 25);
      return { ok: up === true, state: await state() };
    });
    await page.evaluate(() => { window.__secondClient.end(); });
    await step('two clients: no page error', () => ({ ok: far.errors.length === 0, errors: [...new Set(far.errors)].slice(0, 6) }));
    await far.context.close();
  }

  // An elite: the bar, the first-kill orb on its row, a refused press, a taken one.
  if (runs('elite')) {
    const pine = await open(browser, phone, base, 'pine-hollow');
    const id = 'ironhide';
    await step('elite: its row draws the bar at the lair', async () => {
      await place(pine.page, -44, 12, -66);
      const row = await until(pine.page, async () => { const seen = await fight(pine.page, id); return seen?.at !== null && ['aware', 'engaged'].includes(seen?.state) ? seen : null; }, 25);
      await pine.page.waitForTimeout(600);
      const shown = await bossBar(pine.page);
      return { ok: row !== null && shown.elite.length > 0, state: row?.state, shown };
    });
    await step('elite: it kills the player, who comes back whole where they last stood (J107)', async () => {
      const before = await report(pine.page);
      for (let i = 0; i < 160; i++) {
        const row = await fight(pine.page, id), seen = await report(pine.page);
        if (seen.falls > before.falls) break;
        if (row?.at !== null && row?.at !== undefined) await place(pine.page, row.at.x + 1, row.at.y + 0.3, row.at.z + 1);
        await pine.page.waitForTimeout(500);
      }
      await pine.page.waitForTimeout(4000);
      const back = await report(pine.page);
      return { ok: back.falls > before.falls && back.hp === 100, falls: back.falls, hp: back.hp, at: [back.serverX, back.serverZ], state: (await fight(pine.page, id))?.state };
    });
    await step('elite: real blows drop it and its orb lies on the row', async () => {
      await pine.page.evaluate(() => { window.__workerClientHits(60); });
      await place(pine.page, -44, 12, -66);
      for (let i = 0; i < 160; i++) {
        const row = await fight(pine.page, id);
        if (row?.state === 'dead') break;
        if (row?.at !== null && row?.at !== undefined) { if (i % 8 === 0) await place(pine.page, row.at.x + 2, row.at.y + 0.4, row.at.z + 2); await strike(pine.page, row.at, true); }
        await pine.page.waitForTimeout(400);
      }
      await stand(pine.page);
      const row = await until(pine.page, async () => { const seen = await fight(pine.page, id); return seen?.reward !== null ? seen : null; }, 6);
      await pine.page.waitForTimeout(400);
      const orb = await prompt(pine.page, 'skin');
      return { ok: row !== null && orb !== null, state: row?.state, reward: row?.reward, orb, falls: (await report(pine.page)).falls };
    });
    await step('elite: a press from too far is refused, and the orb comes back', async () => {
      const row = await fight(pine.page, id), { reward } = row;
      await place(pine.page, reward.x + 30, reward.y + 8, reward.z + 30);
      await pine.page.waitForTimeout(1500);
      await pine.page.evaluate(() => { window.__wildshard.world.interactables.find(entry => /skin/iu.test(entry.label) && entry.radius > 0)?.onInteract(); });
      await pine.page.waitForTimeout(400);
      const gone = await prompt(pine.page, 'skin');
      await pine.page.waitForTimeout(2200);
      return { ok: gone === null && await prompt(pine.page, 'skin') !== null && (await fight(pine.page, id)).reward !== null, gone };
    });
    await step('elite: a press in reach takes it for good', async () => {
      const row = await fight(pine.page, id), { reward } = row;
      await place(pine.page, reward.x + 0.6, reward.y - 0.6, reward.z + 0.6);
      await pine.page.waitForTimeout(1200);
      const taken = await pressUntil(pine.page, async () => (await fight(pine.page, id)).reward === null, 6); // a press is judged a command behind, as on a phone
      await pine.page.waitForTimeout(2200);
      return { ok: taken && await prompt(pine.page, 'skin') === null, taken };
    });
    await step('elite: no page error', () => ({ ok: pine.errors.length === 0, errors: [...new Set(pine.errors)].slice(0, 6) }));
    await pine.context.close();
  }

  if (runs('sunscar')) await sunscarJourney(browser, phone, base, step);
  if (runs('farreach')) await farJourney(browser, phone, base, step);
  if (runs('isle')) await driftwoodJourney(browser, phone, base, step);
  if (runs('pine')) await pineJourney(browser, phone, base, step);
  if (runs('nalati')) await nalatiJourney(browser, phone, base, step);
  if (runs('chapters')) await chapterJourney(browser, phone, base, step);
  if (runs('night')) await nightJourney(browser, phone, base, step);
  if (runs('second')) await secondClientJourney(browser, phone, base, step);
  if (runs('words')) await wordsJourney(browser, phone, base, step);

  // The sky: the rows move on their own, and a Weather setting goes up and comes back.
  if (runs('sky')) {
    const pine = await open(browser, phone, base, 'pine-hollow');
    await step('sky: a shard with a programme has it on rows and draws it', async () => {
      await pine.page.waitForTimeout(1500);
      const r = await report(pine.page), drawn = await pine.page.evaluate(() => window.__wildshard.shard['pine.weather']?.weather?.state ?? null);
      return { ok: r.sky !== null && drawn !== null, row: r.sky, drawn };
    });
    await step('sky: a live Weather setting goes up, and the row and the page come back with it', async () => {
      const page = pine.page, before = await page.evaluate(() => window.__wildshard.shard['pine.weather']?.weather?.rain ?? 0);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      await page.evaluate(() => { [...document.querySelectorAll('.ws-gmenu-tab')].find(node => /settings/iu.test(node.textContent ?? ''))?.click(); });
      await page.waitForTimeout(500);
      const card = page.locator('.ws-gmenu-card.fold').filter({ has: page.locator('.ws-gmenu-cardtitle', { hasText: /^Developer/u }) }).first();
      if (await card.evaluate(node => node.classList.contains('folded'))) await card.locator('.ws-gmenu-cardtitle').dispatchEvent('click');
      await page.waitForTimeout(300);
      const group = card.locator('.ws-dbg-group:not(.open) > .ws-dbg-head').first();
      if (await group.count() > 0) await group.dispatchEvent('click');
      await card.locator('.ws-gmenu-segbtn[data-v="rain"]').first().dispatchEvent('click');
      await page.waitForTimeout(300);
      const shown = await card.locator('.ws-gmenu-segbtn.active').allTextContents();
      await page.keyboard.press('Escape');
      const rain = await until(page, async () => { const seen = await page.evaluate(() => window.__wildshard.shard['pine.weather']?.weather?.rain ?? 0); return seen > before + 0.01 ? seen : null; }, 25);
      return { ok: rain !== null, before, rain, shown: shown.slice(0, 6), row: (await report(page)).sky, state: await page.evaluate(() => window.__wildshard.shard['pine.weather']?.weather?.state ?? null) };
    });
    await pine.context.close();
  }
}
