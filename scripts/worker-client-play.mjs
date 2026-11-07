// J130: the row played through, as the flip's real checklist. Each step stands alone: one that fails is listed and the next still runs.
// Driftwood's opening quest, a fight and its coins; a ride on Nalati; a grapple; the other shards; a crossing; save, reload, resume.
import { saveFixture } from './debug-settings.mjs';
import { floorGridBenchmarkUrl, FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** Open one page with the row on. */
async function open(browser, phone, base, path) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  page.on('console', line => { if (line.type() === 'error') errors.push(line.text().slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(new URL(path, base).href, { waitUntil: 'load' });
  return { context, page, errors };
}
const started = page => page.evaluate(() => typeof window.__workerClient === 'function');
async function entered(page) {
  await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 }).catch(async error => {
    throw new Error(`${String(error).slice(0, 80)}: ${await page.evaluate(() => [...document.querySelectorAll('pre')].map(node => node.textContent).join(' ').slice(0, 300))}`);
  });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
}
const report = page => page.evaluate(() => window.__workerClient());
/** Walk at a point, stepping aside when stuck. True when within `near` metres. */
async function walk(page, x, z, near, seconds) {
  const until = Date.now() + seconds * 1000;
  let last = null, stuck = 0, turn = 0;
  while (Date.now() < until) {
    const at = await page.evaluate(([tx, tz, side]) => {
      const { player } = window.__wildshard.world, dx = tx - player.position.x, dz = tz - player.position.z;
      player.yaw = Math.atan2(-dx, -dz) + side; player.touchMove.y = 1; player.touchSprint = true;
      return { x: player.position.x, z: player.position.z, away: Math.hypot(dx, dz) };
    }, [x, z, turn]);
    if (at.away < near) { await page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; player.touchSprint = false; }); return true; }
    stuck = last !== null && Math.hypot(at.x - last.x, at.z - last.z) < 0.5 ? stuck + 1 : 0; last = at;
    turn = stuck >= 3 ? (stuck % 6 < 3 ? 1.2 : -1.2) : 0;
    if (stuck === 3) await page.keyboard.press('Space');
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; player.touchSprint = false; });
  return false;
}
/** The nearest living row body, by kind if named. */
const nearestBody = (page, kinds) => page.evaluate(wanted => {
  const { world } = window.__wildshard, { player } = world, list = world.animals?.animals ?? [];
  const live = list.filter(body => body.alive && body.rowDriven && (wanted.length === 0 || wanted.includes(body.kind)));
  live.sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position));
  const body = live[0];
  return body === undefined ? null : { kind: body.kind, x: body.position.x, z: body.position.z, away: body.position.distanceTo(player.position), count: list.length };
}, kinds);

/** Run every step; prints one line each. */
export async function play(browser, phone, base, only = '') {
  const steps = [], runs = name => only === '' || only === name;
  const step = async (name, run) => {
    let ok = false, note = '';
    const at = Date.now();
    try { const out = await run(); ok = out === true || out?.ok === true; note = typeof out === 'object' && out !== null ? JSON.stringify(out) : String(out); }
    catch (error) { note = `threw: ${String(error).slice(0, 300)}`; }
    steps.push({ name, ok, note });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${Math.round((Date.now() - at) / 1000)} s)  ${note.slice(0, 2400)}`);
    return ok;
  };


  if (runs('pine-economy')) { const { pineEconomy } = await import('./worker-client-pine.mjs'); await pineEconomy(browser, phone, base, step); }

  // Traversal: the page asks, and the server carries. Each stands at its prompt by the harness's move, presses, and reads the owner block's lead.
  const prompted = (page, id) => page.evaluate(wanted => { const near = window.__wildshard.world.interactables.find(prompt => prompt.wireId === wanted); return near === undefined ? null : { x: near.position.x, y: near.position.y, z: near.position.z }; }, id);
  const pressAt = async (page, id) => {
    const at = await prompted(page, id);
    if (at === null) return { ok: false, why: 'no prompt', id };
    await page.evaluate(({ x, y, z }) => { window.__wildshard.world.player.link.place(x, y + 0.2, z, 0); }, at);
    await page.waitForTimeout(1200);
    const start = await report(page);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('KeyE'); await page.waitForTimeout(600);
      const led = await page.evaluate(() => window.__wildshard.world.player.link.predictor.leading);
      if (led) return { ok: true, start: [start.x, start.z] };
    }
    const r = await report(page); return { ok: false, why: 'never led', refused: r.refused, x: r.x, z: r.z };
  };

  // Driftwood, one shard: the opening quest
  if (runs('driftwood')) { const drift = await open(browser, phone, base, '/?chunk=driftwood-isle&mute=1&nolock=1');
  await step('driftwood boots on the row', async () => { await entered(drift.page); return started(drift.page); });
  await step('the page draws the server creatures', async () => { const r = await report(drift.page); return { ok: r.rows > 0, rows: r.rows, closed: r.closed }; });
  await step('walk to Wendell', async () => {
    for (const [x, z] of [[-8, -172], [-30, -142], [-30, -104], [-24, -80]]) await walk(drift.page, x, z, 3, 25); // the sand path up from the pier
    // Nearest prompt wins, as on the page: Maren stands a step off, and a press from her side opens her shop and no quest.
    const wendell = await prompted(drift.page, 'castaway.talk');
    const there = wendell !== null && await walk(drift.page, wendell.x, wendell.z, 1.5, 25);
    await drift.page.waitForTimeout(1000); // a press is judged where the server has the body, a command behind
    return there;
  });
  await step('talk to Wendell: the server starts the quest', async () => {
    for (let i = 0; i < 14; i++) { await drift.page.keyboard.press('KeyE'); await drift.page.waitForTimeout(700); const r = await report(drift.page); if (r.quests['sealed-ring'] !== undefined && r.quests['sealed-ring'] !== 'unstarted') return { ok: true, quests: r.quests }; }
    const r = await report(drift.page); return { ok: false, quests: r.quests, flags: r.flags.slice(0, 12), x: r.x, z: r.z };
  });
  await step('read to the end of the talk', async () => {
    const reading = () => drift.page.evaluate(() => window.__wildshard.shard['driftwood.adventure'].spine.dialogue.isOpen);
    for (let i = 0; i < 30 && await reading(); i++) { await drift.page.keyboard.press('KeyE'); await drift.page.waitForTimeout(500); }
    return !await reading();
  });
  await step('the chip shows the server step', async () => {
    await drift.page.waitForTimeout(1500);
    const text = await drift.page.evaluate(() => document.body.textContent);
    return { ok: /glyph shards/iu.test(text), text: text.slice(0, 160) };
  });
  await step('a place is discovered and the server keeps it', async () => {
    for (let i = 0; i < 8; i++) { const r = await report(drift.page); const seen = r.flags.filter(flag => flag.startsWith('seen:')); if (seen.length > 0) return { ok: true, seen }; await drift.page.waitForTimeout(1000); }
    return { ok: false };
  });
  // Chase and swing: the sword reaches two metres, and a boar doesn't stand still.
  let stuck = 0, from = null;
  const swing = async kinds => {
    const body = await nearestBody(drift.page, kinds);
    if (body === null) { await drift.page.waitForTimeout(400); return; }
    const at = await drift.page.evaluate(([x, z, away, side]) => { const { player, game } = window.__wildshard.world; player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)) + side; player.pitch = -0.15; player.touchMove.y = away > 1.8 ? 1 : 0; player.touchSprint = away > 8; if (away < 2.6) game.app.input.press('attack'); return { x: player.position.x, z: player.position.z }; }, [body.x, body.z, body.away, stuck >= 3 ? (stuck % 12 < 6 ? 1.3 : -1.3) : 0]);
    stuck = from !== null && body.away > 2.6 && Math.hypot(at.x - from.x, at.z - from.z) < 0.4 ? stuck + 1 : Math.max(0, stuck - 1); from = at; // round whatever stands between them
    if (stuck === 4) await drift.page.keyboard.press('Space');
    await drift.page.waitForTimeout(350);
  };
  await step('a fight: the server takes a hit', async () => {
    const before = await report(drift.page);
    for (let i = 0; i < 200; i++) { await swing(['boar']); const r = await report(drift.page); if (r.hits > before.hits) return { ok: true, hits: r.hits, hp: r.hp }; }
    const r = await report(drift.page); return { ok: false, hits: r.hits, refused: r.refused, held: r.held, falls: r.falls };
  });
  await step('a kill pays once', async () => {
    const coins = () => drift.page.evaluate(() => window.__wildshard.shard['driftwood.loot']?.purse?.coins ?? null), before = await coins();
    for (let i = 0; i < 260; i++) {
      const r = await report(drift.page);
      if (r.paid > 0) { await drift.page.evaluate(() => { window.__wildshard.world.player.touchMove.y = 0; }); await drift.page.waitForTimeout(4000); const after = await coins(), done = await report(drift.page); return { ok: after !== null && before !== null && after - before === done.paid, before, after, paid: done.paid, kills: done.kills }; }
      await swing(['boar']);
    }
    const r = await report(drift.page); return { ok: false, paid: r.paid, kills: r.kills, hits: r.hits, falls: r.falls };
  });
  await drift.page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; player.touchSprint = false; });
  await step('the server says what this player holds', async () => {
    await drift.page.waitForTimeout(1200);
    const r = await report(drift.page); return { ok: typeof r.owned.coins === 'number' && r.paid > 0 ? r.owned.coins >= r.paid : typeof r.owned.coins === 'number', owned: r.owned, paid: r.paid };
  });
  await step('the day is on the wire and the page follows', async () => {
    const first = await report(drift.page); await drift.page.waitForTimeout(3000); const next = await report(drift.page);
    const clock = await drift.page.evaluate(() => window.__wildshard?.world?.game?.sky?.dayNight?.phase ?? null);
    return { ok: typeof next.day === 'number' && (first.day !== next.day) && (clock === null || Math.min(Math.abs(clock - next.day), 1 - Math.abs(clock - next.day)) < 0.02), first: first.day, next: next.day, clock };
  });
  await step('driftwood saves', async () => { await drift.page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })])); const r = await report(drift.page); return { ok: r.savedOk, tick: r.savedTick }; });
  await step('driftwood resumes: the quest is where it stood', async () => {
    await drift.page.reload({ waitUntil: 'load' }); await entered(drift.page);
    await drift.page.waitForTimeout(2500);
    const r = await report(drift.page); return { ok: r.restored && r.quests['sealed-ring'] !== undefined && r.quests['sealed-ring'] !== 'unstarted', restored: r.restored, quests: r.quests, x: r.x, z: r.z, serverX: r.serverX, serverZ: r.serverZ };
  });
  await step('export holds the server session', async () => {
    await drift.page.keyboard.press('Escape'); await drift.page.waitForTimeout(600);
    await drift.page.evaluate(() => { [...document.querySelectorAll('.ws-gmenu-tab')].find(node => /settings/iu.test(node.textContent ?? ''))?.click(); });
    await drift.page.waitForTimeout(600);
    const [download] = await Promise.all([drift.page.waitForEvent('download', { timeout: 20_000 }), drift.page.evaluate(() => { [...document.querySelectorAll('.ws-gmenu-btn')].find(node => /export/iu.test(node.textContent ?? ''))?.click(); })]);
    const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'), doc = JSON.parse(text);
    return { ok: doc.server === true && Object.keys(doc.docs).some(key => key.startsWith('standalone')), docs: Object.keys(doc.docs).slice(0, 8) };
  });
  await step('New Game forgets the server copy', async () => {
    await drift.page.evaluate(() => { document.querySelector('.ws-saves-new')?.click(); });
    await drift.page.waitForTimeout(500);
    await drift.page.evaluate(() => { document.querySelector('.ws-saves-btn.confirm')?.click(); });
    await drift.page.waitForTimeout(4000);
    await drift.page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1', base).href, { waitUntil: 'load' }); await entered(drift.page); await drift.page.waitForTimeout(2500);
    const r = await report(drift.page); return { ok: !r.restored && (r.quests['sealed-ring'] === undefined || r.quests['sealed-ring'] === 'unstarted'), restored: r.restored, quests: r.quests };
  });
  await step('driftwood raises no page error', () => ({ ok: drift.errors.length === 0, errors: [...new Set(drift.errors)].slice(0, 6) }));
  await drift.context.close(); }

  if (runs('traverse')) {
    const drift = await open(browser, phone, base, '/?chunk=driftwood-isle&mute=1&nolock=1');
    await step('zipline: the driftwood cable is the server\'s ride', async () => { await entered(drift.page); return pressAt(drift.page, 'driftwood.zipline'); });
    await step('driftwood rides without a page error', () => ({ ok: drift.errors.length === 0, errors: [...new Set(drift.errors)].slice(0, 6) }));
    await drift.context.close();
    const pine = await open(browser, phone, base, '/?chunk=pine-hollow&mute=1&nolock=1');
    await step('zipline: the pine cable is the server\'s ride', async () => { await entered(pine.page); return pressAt(pine.page, 'pine.zipline'); });
    await step('the cable sets its rider down', async () => { await pine.page.waitForFunction(() => !window.__wildshard.world.player.link.predictor.leading, undefined, { timeout: 40_000 }); return true; });
    await step('carry: the pine canoe takes a press', () => pressAt(pine.page, 'pine.canoe.ride.0'));
    await step('pine rides without a page error', () => ({ ok: pine.errors.length === 0, errors: [...new Set(pine.errors)].slice(0, 6) }));
    await pine.context.close();
    const far = await open(browser, phone, base, '/?chunk=far-reach&mute=1&nolock=1');
    await step('lift: a far reach islet comes to a call, and carries its rider down', async () => {
      await entered(far.page);
      const deckPrompts = label => far.page.evaluate(wanted => window.__wildshard.world.interactables.filter(prompt => prompt.label === wanted && prompt.position.y > 10).map(prompt => ({ x: prompt.position.x, y: prompt.position.y, z: prompt.position.z })), label), height = () => far.page.evaluate(() => window.__wildshard.world.player.position.y);
      const [call] = await deckPrompts('Call the islet');
      if (call === undefined) return { ok: false, why: 'no call prompt' };
      await far.page.evaluate(({ x, y, z }) => { window.__wildshard.world.player.link.place(x, y + 0.2, z, 0); }, call);
      await far.page.waitForTimeout(1500);
      await far.page.keyboard.press('KeyE');
      let ride = null;
      for (let i = 0; i < 40 && ride === null; i++) { await far.page.waitForTimeout(500); ride = (await deckPrompts('Ride the islet')).find(prompt => Math.hypot(prompt.x - call.x, prompt.z - call.z) < 12) ?? null; }
      if (ride === null) return { ok: false, why: 'the islet never came', call };
      await far.page.evaluate(({ x, y, z }) => { window.__wildshard.world.player.link.place(x, y + 0.2, z, 0); }, ride);
      await far.page.waitForTimeout(1000);
      const high = await height();
      await far.page.keyboard.press('KeyE');
      let low = high;
      for (let i = 0; i < 40; i++) { await far.page.waitForTimeout(500); low = Math.min(low, await height()); if (low < high - 16) break; }
      const r = await report(far.page);
      return { ok: high - low > 8, high, low, corrections: r.corrections, worst: r.worstOffset, missed: r.missed, closed: r.closed };
    });
    await step('far reach rides without a page error', () => ({ ok: far.errors.length === 0, errors: [...new Set(far.errors)].slice(0, 6) }));
    await far.context.close();
  }

  // Nalati: a ride
  if (runs('nalati')) { const nalati = await open(browser, phone, base, '/?chunk=nalati-grasslands&mute=1&nolock=1');
  await step('nalati boots on the row', async () => { await entered(nalati.page); return started(nalati.page); });
  await step('ride a horse', async () => {
    for (let i = 0; i < 240; i++) {
      const body = await nearestBody(nalati.page, ['horse']);
      if (body === null) { await nalati.page.waitForTimeout(500); continue; }
      if (body.away > 2.2) { await walk(nalati.page, body.x, body.z, 2, 1.5); continue; }
      await nalati.page.keyboard.press('KeyE'); await nalati.page.waitForTimeout(900);
      if (await nalati.page.evaluate(() => window.__wildshard.world.player.ride !== null)) return { ok: true, tries: i };
    }
    return { ok: false, horse: await nearestBody(nalati.page, ['horse']) };
  });
  await step('nalati raises no page error', () => ({ ok: nalati.errors.length === 0, errors: [...new Set(nalati.errors)].slice(0, 6) }));
  await nalati.context.close(); }

  // The grapple's shard
  if (runs('nine')) { const nine = await open(browser, phone, base, '/?chunk=nine-dragon-stack&mute=1&nolock=1');
  await step('nine dragon boots on the row', async () => { await entered(nine.page); return started(nine.page); });
  await step('grapple: the claw is on the wire and answers', async () => {
    const claw = () => nine.page.evaluate(() => { const tool = window.__wildshard.world.game.app.equipment?.tools.find(item => 'guardOpen' in item); return tool === undefined ? null : { sim: tool.sim?.constructor?.name, phase: tool.sim?.phase, hooks: tool.sim?.course?.hooks?.length }; });
    for (let i = 0; i < 40 && (await claw())?.sim !== 'Object'; i++) await nine.page.waitForTimeout(250); // a claw on the wire is a plain object
    const held = await claw();
    const r = await report(nine.page);
    if (held === null || held.sim !== 'Object') return { ok: false, held, clawed: r.clawed, own: r.own };
    // Fire at nothing: the server runs the shot, and its phases come back on rows.
    await nine.page.evaluate(() => { const hook = window.__wildshard.world.game.app.equipment.tools.find(item => 'guardOpen' in item).sim, view = { eye: window.__wildshard.world.player.position, project: (point, out) => out.copy(point), forward: out => out.set(0, 0, -1) }; hook.lock(view, null, false); hook.fire(view); });
    const phases = new Set();
    for (let i = 0; i < 30; i++) { phases.add((await claw())?.phase); await nine.page.waitForTimeout(100); }
    return { ok: phases.size > 1, phases: [...phases], own: r.own };
  });
  await step('nine: a press of the held weapon gets the server\'s answer', async () => {
    const before = await report(nine.page);
    await nine.page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); });
    await nine.page.waitForTimeout(1200);
    const r = await report(nine.page), held = await nine.page.evaluate(() => window.__wildshard.world.game.app.equipment.current?.id ?? null);
    return { ok: r.refused === before.refused && r.closed === null, held, refused: r.refused, waiting: r.attacks };
  });
  await step('nine: a walk stays with the server, corrections and all', async () => { // Nine declares no places and no quest: a walk is what it has
    const at = await nine.page.evaluate(() => { const { position: p } = window.__wildshard.world.player; return { x: p.x, z: p.z }; }), before = await report(nine.page);
    await walk(nine.page, at.x + 12, at.z - 12, 2, 6);
    await nine.page.waitForTimeout(800);
    const r = await report(nine.page), parted = Math.hypot(r.x - r.serverX, r.z - r.serverZ), moved = Math.hypot(r.x - at.x, r.z - at.z);
    return { ok: moved > 3 && parted < 1 && r.closed === null, moved, parted, corrections: r.corrections - before.corrections, worst: r.worstOffset };
  });
  await step('nine: a fall off the stack comes back to firm ground, unhurt', async () => {
    const stood = await nine.page.evaluate(() => { const { position: p } = window.__wildshard.world.player; return { x: p.x, y: p.y, z: p.z }; }), before = await report(nine.page);
    await nine.page.waitForTimeout(800);
    await nine.page.evaluate(({ x, z }) => { window.__wildshard.world.player.link.place(x, 26, z, 0); }, stood);
    let lowest = Infinity;
    for (let i = 0; i < 24; i++) { lowest = Math.min(lowest, await nine.page.evaluate(() => window.__wildshard.world.player.position.y)); await nine.page.waitForTimeout(150); }
    await nine.page.waitForTimeout(1000);
    const back = await nine.page.evaluate(() => window.__wildshard.world.player.position.y), r = await report(nine.page);
    return { ok: back > 25 && r.falls === before.falls && r.hp === before.hp, stood: stood.y, lowest, back, falls: r.falls, hp: r.hp };
  });
  await step('nine saves and resumes where it stood', async () => {
    await nine.page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]));
    const stood = await report(nine.page);
    await nine.page.reload({ waitUntil: 'load' }); await entered(nine.page);
    await nine.page.waitForTimeout(1500);
    const r = await report(nine.page);
    return { ok: stood.savedOk && r.restored && Math.hypot(r.serverX - stood.serverX, r.serverZ - stood.serverZ) < 3, restored: r.restored, flags: r.flags.length };
  });
  await step('nine raises no page error', () => ({ ok: nine.errors.length === 0, errors: [...new Set(nine.errors)].slice(0, 6) }));
  await nine.context.close(); }

  // Every other shard boots on the row, its sky and fights on rows, with no page error
  if (runs('shards')) for (const slug of ['pine-hollow', 'sunscar-dunes', 'far-reach', 'driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack']) {
    const shard = await open(browser, phone, base, `/?chunk=${slug}&mute=1&nolock=1`);
    await step(`${slug} plays on the row`, async () => {
      await entered(shard.page);
      await shard.page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 1; });
      await shard.page.waitForTimeout(8000);
      const r = await report(shard.page), rig = await shard.page.evaluate(() => { const held = Object.entries(window.__wildshard.shard).find(([key]) => key.includes('weather'))?.[1]; return held?.weather?.state ?? null; });
      return { ok: shard.errors.length === 0 && r.closed === null && (r.rows > 0 || slug === 'nine-dragon-stack') && Object.keys(r.retired).length === 0, rows: r.rows, retired: r.retired, spawnMs: Object.fromEntries(Object.entries(r.spawnMs).map(([kind, ms]) => [kind, Math.round(ms)])), fights: r.fights.slice(0, 6), movers: r.movers, posed: r.posed, fps: Math.round(r.framesPerSecond * 10) / 10, delay: Math.round(r.delayMs), queue: r.queue, replays: Math.round(r.replaysPerFrame * 100) / 100, corrections: r.corrections, missed: r.missed, worst: r.worstOffset, sky: rig, errors: [...new Set(shard.errors)].slice(0, 4) };
    });
    await shard.context.close();
  }

  // A data shard: the page is the data client's alone. Its door is a public field, so the server turns it and the page draws what the row says.
  if (runs('data')) { const data = await open(browser, phone, base, '/?chunk=pastel-plain&mute=1&nolock=1');
  const door = () => data.page.evaluate(() => ({ row: window.__workerClientRow('pastel.door.open') ?? null, targets: window.__wildshard.shard.shardfile.targets() }));
  await step('pastel boots on the row', async () => { await entered(data.page); return started(data.page); });
  await step('pastel draws the server creatures', async () => { const r = await report(data.page); return { ok: r.rows > 0 && Object.keys(r.retired).length === 0, rows: r.rows, retired: r.retired }; });
  await step('pastel\'s quest stands on the row', async () => { const r = await report(data.page); return { ok: 'pastel.quest' in r.quests, quests: r.quests }; });
  await step('the door is shut, and its panel and collider say so', async () => { const at = await door(); return { ok: at.row === 0 && at.targets.every(row => row.visible && row.solid), ...at }; });
  await step('a predicted walk stops at the shut door', async () => {
    await data.page.evaluate(() => { const { player } = window.__wildshard.world; player.link.place(0, 1.4, -6, 0); });
    await data.page.waitForTimeout(800);
    await data.page.evaluate(() => { const { player } = window.__wildshard.world; player.yaw = 0; player.touchMove.y = 1; }); // straight at it: `walk` would step around
    await data.page.waitForTimeout(2500);
    await data.page.evaluate(() => { window.__wildshard.world.player.touchMove.y = 0; });
    await data.page.waitForTimeout(800);
    const r = await report(data.page), parted = Math.hypot(r.x - r.serverX, r.z - r.serverZ);
    return { ok: r.z > -9 && r.z < -7 && parted < 1, z: r.z, parted };
  });
  await step('a press turns the door on the server, and the page follows the row', async () => {
    const prompt = await prompted(data.page, 'pastel.door.use');
    if (prompt === null) return { ok: false, why: 'no prompt' };
    await data.page.evaluate(({ x, y, z }) => { window.__wildshard.world.player.link.place(x, y + 0.2, z + 1.5, 0); }, prompt);
    await data.page.waitForTimeout(1200);
    for (let i = 0; i < 6 && (await door()).row !== 1; i++) { await data.page.keyboard.press('KeyE'); await data.page.waitForTimeout(600); }
    const at = await door(); return { ok: at.row === 1 && at.targets.every(row => !row.visible && !row.solid), ...at };
  });
  await step('a predicted walk goes through the open door and stays with the server', async () => {
    const before = await report(data.page);
    await walk(data.page, 0, -12, 1, 6);
    await data.page.waitForTimeout(800);
    const r = await report(data.page), parted = Math.hypot(r.x - r.serverX, r.z - r.serverZ);
    return { ok: r.z < -10 && parted < 1, z: r.z, parted, corrections: r.corrections - before.corrections, worst: r.worstOffset };
  });
  await step('pastel saves and resumes with its door open', async () => {
    await data.page.evaluate(() => Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 6000); })]));
    await data.page.reload({ waitUntil: 'load' }); await entered(data.page);
    await data.page.waitForFunction(() => window.__workerClientRow('pastel.door.open') === 1, undefined, { timeout: 30_000 });
    const at = await door(); return { ok: at.targets.every(row => !row.visible && !row.solid), ...at };
  });
  await step('pastel raises no page error', () => ({ ok: data.errors.length === 0, errors: [...new Set(data.errors)].slice(0, 6) }));
  await data.context.close(); }

  // The grid: a crossing, a save, a reload
  if (runs('grid')) { const grid = await open(browser, phone, base, floorGridBenchmarkUrl(base).replace(base, '/'));
  await step('the grid boots on the row', async () => {
    await grid.page.locator('.ws-main-grid').click({ timeout: 60_000 });
    await grid.page.waitForFunction(() => window.__wildshard?.shard?.grid?.state().live?.live?.gameplayReady, undefined, { timeout: 90_000 });
    await grid.page.evaluate(FLOOR_GRID_ENTER);
    await grid.page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
    return true;
  });
  await step('a kill in a cell reaches that cell\'s own purse', async () => {
    await grid.page.evaluate(() => { window.__workerClientHits(40); });
    const purse = () => grid.page.evaluate(() => window.__wildshard.shard['driftwood.loot']?.purse?.coins ?? null), before = await purse();
    for (let i = 0; i < 90; i++) {
      const r = await report(grid.page);
      if ((r.owned.coins ?? 0) > 0) { await grid.page.waitForTimeout(800); const shown = await purse(); return { ok: shown === (await report(grid.page)).owned.coins, before, shown, owned: (await report(grid.page)).owned }; }
      const body = await grid.page.evaluate(() => { const list = window.__workerClientRows('boar'), { x, z } = window.__wildshard.shard.grid.state().live.live.worldFeet; return [...list].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null; });
      if (body === null) { await grid.page.waitForTimeout(400); continue; }
      await grid.page.evaluate(({ x, y, z }) => { window.__wildshard.world.player.link.place(x + 0.8, y + 0.3, z + 0.8, 0); }, body);
      await grid.page.waitForTimeout(400);
      // the touch disc's own call: a page with no pointer lock has no mouse press to send
      await grid.page.evaluate(() => { const { player, game } = window.__wildshard.world; player.yaw = Math.atan2(0.8, 0.8); player.pitch = -0.3; game.app.equipment.current.tryFire(); });
      await grid.page.waitForTimeout(500);
    }
    return { ok: false, owned: (await report(grid.page)).owned, hits: (await report(grid.page)).hits };
  });
  await step('cross a cell', async () => {
    for (const [x, z] of [[0, -285], [0, -235]]) {
      const until = Date.now() + 70_000;
      while (Date.now() < until) {
        const at = await grid.page.evaluate(([tx, tz]) => { const { live } = window.__wildshard.shard.grid.state().live, { player } = window.__wildshard.world, feet = live.worldFeet; player.yaw = Math.atan2(feet.x - tx, feet.z - tz); player.touchMove.y = 1; player.touchSprint = true; return { away: Math.hypot(feet.x - tx, feet.z - tz), current: live.current }; }, [x, z]);
        if (at.away < 6) break;
        await grid.page.waitForTimeout(1000);
      }
    }
    const r = await report(grid.page); return { ok: r.closed === null, cell: r.cell, serverX: r.serverX, serverZ: r.serverZ, corrections: r.corrections, missed: r.missed, misses: r.misses.slice(0, 48).map(miss => miss.map(value => Math.round(value * 100) / 100)) };
  });
  await step('grid saves, reloads and resumes', async () => {
    await grid.page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; return Promise.race([window.__workerClientSave(), new Promise(resolve => { setTimeout(resolve, 20_000); })]); });
    const stood = await report(grid.page);
    await grid.page.goto(floorGridBenchmarkUrl(base), { waitUntil: 'load' });
    await grid.page.locator('.ws-main-grid').click({ timeout: 60_000 });
    await grid.page.waitForFunction(() => window.__wildshard?.shard?.grid?.state().live?.live?.gameplayReady, undefined, { timeout: 90_000 });
    await grid.page.evaluate(FLOOR_GRID_ENTER);
    await grid.page.waitForFunction(cell => typeof window.__workerClient === 'function' && window.__workerClient().cell === cell && window.__workerClient().frames > 30, stood.cell, { timeout: 60_000 });
    const back = await report(grid.page);
    return { ok: stood.savedOk && back.restored && Math.hypot(back.serverX - stood.serverX, back.serverZ - stood.serverZ) < 3, cell: back.cell, restored: back.restored };
  });
  await step('the grid raises no page error', () => ({ ok: grid.errors.length === 0, errors: [...new Set(grid.errors)].slice(0, 6) }));
  await grid.context.close(); }
  return steps;
}
