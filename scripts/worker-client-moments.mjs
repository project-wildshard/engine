#!/usr/bin/env node
// N1, N2, N5, N6, N7: what a page says and shows of a fight the server runs. A tape wraps the audio layer and the HUD, so a step reads what the
// game asked to play and show (`--mute-audio` and a headless page can't hear it), and `window.__audioLog` adds the score's scenes and phases.
//   scripts/browser-lane.sh node scripts/worker-client-moments.mjs --base=http://127.0.0.1:4401/ [--only=practice,pine,race,captain,god,roc,sunscar,phases,longroom,day]
import { chromium, devices } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', ''), only = arg('only', 'practice,pine,race,captain,god,roc,sunscar,phases,longroom,day').split(',');
if (base === '') throw new Error('Requires --base');
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
const browser = await chromium.launch({ args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let failed = 0;
const note = (name, ok, out) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(out).slice(0, 1400)}`); };

async function open(slug, query = '') {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'device', key: 'debug.workerClient', data: 'on' });
  await page.goto(new URL(`/?chunk=${slug}&mute=1&nolock=1${query}`, base).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => window.__workerClient().frames > 30, undefined, { timeout: 60_000 });
  await page.evaluate(pinned => {
    const { world } = window.__wildshard, tape = window.__tape = [];
    const record = (owner, name) => {
      const real = owner[name].bind(owner);
      owner[name] = (...args) => { tape.push(`${name} ${args.join(' ')}`); return real(...args); };
    };
    for (const name of ['combat', 'sting']) record(world.music, name);
    // A lair's runtime pins `hud.killFeed`'s identity: wrapped on Nalati, `shard.nalati.elites` faults every frame, and presses, blows and the barrow's door die with it.
    record(world.hud, 'toast'); if (!pinned) record(world.hud, 'killFeed');
  }, slug === 'nalati-grasslands');
  return { context, page, errors };
}
const report = page => page.evaluate(() => window.__workerClient());
const fight = (page, id) => page.evaluate(want => window.__workerClientFights().find(row => row.id === want) ?? null, id);
const tape = page => page.evaluate(() => window.__tape);
const score = page => page.evaluate(() => (window.__audioLog ?? []).filter(row => row.kind === 'music' && /^(?:scene|phase|sting):/u.test(row.name)).map(row => row.name));
const place = (page, x, y, z) => page.evaluate(([px, py, pz]) => { window.__wildshard.world.player.link.place(px, py, pz, 0); }, [x, y, z]);
const groundAt = (page, x, z) => page.evaluate(([gx, gz]) => window.__hf.heightAt(gx, gz), [x, z]);
async function until(page, read, seconds, every = 250) {
  const end = Date.now() + seconds * 1000;
  let last = await read();
  while (!last && Date.now() < end) { await page.waitForTimeout(every); last = await read(); }
  return last;
}
const faceAt = (page, at) => page.evaluate(({ x, y, z }) => {
  const { player } = window.__wildshard.world, dx = x - player.position.x, dz = z - player.position.z;
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y - player.position.y - 1.68, Math.hypot(dx, dz));
}, at);
const mid = at => ({ x: at.x, y: at.y + 1, z: at.z });
const close = async ({ context }) => { await context.close(); };
const stand = page => page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; player.touchSprint = false; });

if (only.includes('practice')) {
  const shard = await open('driftwood-isle'), { page } = shard;
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => { const { player } = window.__wildshard.world; return [player.position.x, player.position.y, player.position.z]; });
  await page.evaluate(() => { window.__wildshard.world.hud.onArena(); });
  const entered = await until(page, () => page.evaluate(() => window.__wildshard.world.arena?.active === true), 30);
  const read = () => page.evaluate(() => { const { player } = window.__wildshard.world, r = window.__workerClient(); return { y: Math.round(player.position.y), x: Math.round(player.position.x), z: Math.round(player.position.z), corrections: r.corrections }; });
  const inside = []; for (let at = 0; at < 8; at++) { await page.waitForTimeout(1000); inside.push(await read()); }
  // Walk in the room: on a page that keeps its link, the server's body answers and the walk snaps back.
  await page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 1; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 0; });
  const walked = await read();
  const ticksInside = await page.evaluate(() => window.__wildshard.world.arena.active && window.__workerClient().day);
  await page.waitForTimeout(1200);
  const stopped = await page.evaluate(ticks => window.__workerClient().day === ticks, ticksInside); // the day row moves every 0.7 s of a running world
  await page.evaluate(() => { const { world } = window.__wildshard; world.arena.exit(); });
  const back = await until(page, async () => (await read()).y < 300, 8);
  const after = await read(), frames = await report(page), moved = Math.hypot(walked.z - inside[0].z, walked.x - inside[0].x);
  await page.waitForTimeout(1000);
  const ticking = (await report(page)).frames > frames.frames;
  note('N5 a practice room stays up, answers a walk, holds the world, and hands the player back', entered === true && inside.every(row => row.y > 500) && walked.y > 500 && moved > 1 && back === true && ticking, { entered, before, inside: inside.slice(-1), walked, moved, stopped, back, after, ticking, errors: shard.errors.slice(0, 3) });
  await close(shard);
}

if (only.includes('pine')) {
  // ?bossGod: a King who keeps killing the proof would keep the score going round its death sting.
  const shard = await open('pine-hollow', '&bossGod=1'), { page } = shard, [x, z] = [150, -30];
  await page.evaluate(() => { window.__workerClientHits(120); window.__workerClientTime('night'); });
  await page.waitForTimeout(2500);
  await place(page, x, await groundAt(page, x, z) + 1, z + 2);
  const id = await until(page, () => page.evaluate(() => window.__workerClientFights().find(row => /king/u.test(row.id))?.id ?? null), 20);
  const armed = await until(page, async () => { const row = await fight(page, id); return row?.state === 'intro' || row?.state === 'fight' ? row.state : null; }, 40);
  const steered = await page.evaluate(() => { const { player } = window.__wildshard.world; player.touchMove.y = 1; return [player.position.x, player.position.z]; });
  await page.waitForTimeout(700);
  const held = await page.evaluate(([fromX, fromZ]) => { const { player } = window.__wildshard.world; player.touchMove.y = 0; return Math.hypot(player.position.x - fromX, player.position.z - fromZ); }, steered);
  const end = Date.now() + 120_000;
  let row = await fight(page, id);
  while (row?.state !== 'victory' && Date.now() < end) {
    if (row?.at !== null && row?.at !== undefined) {
      await place(page, row.at.x + 2, row.at.y + 0.4, row.at.z + 2); await page.waitForTimeout(300);
      await faceAt(page, mid(row.at)); await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(450);
    } else await page.waitForTimeout(400);
    row = await fight(page, id);
  }
  await page.waitForTimeout(1200);
  const heard = await tape(page), music = await score(page), ok = row?.state === 'victory' && music.includes('scene:boss') && heard.includes('sting chunk') && music.filter(line => line.startsWith('scene:')).length >= 2;
  note('N2 the Antler King\'s scene, phases, sting and ambient back', ok, { id, armed, walkedInIntro: Number(held.toFixed(2)), state: row?.state, music: music.slice(-10), heard: heard.slice(-10), errors: shard.errors.slice(0, 3) });
  // Old Ironhide, who waits for no dusk: a lair's banner, second phase, trophy line and kill sting.
  await page.evaluate(() => { window.__tape.length = 0; });
  const [ix, iz] = [-44, -76], lair = 'ironhide';
  await place(page, ix, await groundAt(page, ix, iz) + 1, iz);
  await until(page, async () => (await fight(page, lair))?.at !== null, 15);
  const hunt = Date.now() + 60_000;
  const seen = [];
  let beast = await fight(page, lair);
  while (beast?.state !== 'dead' && Date.now() < hunt) {
    if (seen.at(-1) !== beast?.state) seen.push(beast?.state);
    if (beast?.at !== null && beast?.at !== undefined) {
      await place(page, beast.at.x + 2, beast.at.y + 0.4, beast.at.z + 2); await page.waitForTimeout(350);
      await faceAt(page, mid(beast.at)); await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(450);
    } else await page.waitForTimeout(400);
    beast = await fight(page, lair);
  }
  await page.waitForTimeout(800);
  const said = await tape(page);
  note('N2 Ironhide\'s banner, phase, trophy line and kill sting', beast?.state === 'dead' && said.some(line => line.startsWith('killFeed') && line.includes('Ironhide')) && said.some(line => line === 'combat 0.8' || line.startsWith('combat .')) && said.includes('sting chunk'), { state: beast?.state, seen, phase: beast?.phase, banners: beast?.banners, said: said.slice(-12) });
  await close(shard);
}

if (only.includes('race')) {
  const shard = await open('pine-hollow', '&bossGod=1'), { page } = shard, [x, z] = [-181, -144];
  await page.evaluate(() => { window.__workerClientHits(1000); window.__workerClientFlag('errand:asked'); window.__workerClientTime('night'); });
  await page.waitForTimeout(3000);
  await place(page, x, await groundAt(page, x, z) + 1, z);
  const thralls = () => page.evaluate(([cx, cz]) => [...window.__wildshard.world.animals.animals].filter(body => body.variant === 'thrall' && body.alive && Math.hypot(body.position.x - cx, body.position.z - cz) < 140).map(body => ({ x: body.position.x, y: body.position.y, z: body.position.z })), [x, z]);
  const woke = await until(page, async () => (await thralls()).length >= 3, 30);
  const end = Date.now() + 25_000;
  while (Date.now() < end && !(await report(page)).flags.includes('errand:done')) {
    const [body] = await thralls();
    if (body === undefined) { await page.waitForTimeout(500); continue; }
    await place(page, body.x + 2, body.y + 0.4, body.z + 2); await page.waitForTimeout(500);
    await faceAt(page, mid(body)); await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(500);
  }
  // The server's own raise is proved by `net-quest-spawns`; a night's hunt doesn't fit a proof's minutes. The page hears this as it hears that.
  if (!(await report(page)).flags.includes('errand:done')) await page.evaluate(() => { window.__workerClientFlag('errand:done'); });
  await page.waitForTimeout(1500);
  const heard = await tape(page), done = (await report(page)).flags.includes('errand:done'), bank = await page.evaluate(() => (window.__audioLog ?? []).filter(row => row.kind === 'sfx' && /thrall/u.test(row.name)).map(row => row.name).slice(-6));
  note('N1 the millrace ends on its toast and sting, and thralls speak', done && heard.some(line => line.includes('goes down in the race')) && heard.includes('sting chunk'), { woke, done, heard: heard.slice(-8), bank, errors: shard.errors.slice(0, 3) });
  await close(shard);
}

if (only.includes('god')) {
  const shard = await open('pine-hollow', '&bossGod=1'), { page } = shard, [x, z] = [-44, -76];
  await place(page, x, await groundAt(page, x, z) + 1, z);
  const start = await page.evaluate(() => window.__wildshard.world.game.app.player.attributes.health);
  await page.waitForTimeout(20_000);
  const r = await report(page), end = await page.evaluate(() => window.__wildshard.world.game.app.player.attributes.health), ironhide = await fight(page, 'ironhide');
  note('N6 ?bossGod stands Ironhide down', r.falls === 0 && end >= start, { start, end, falls: r.falls, state: ironhide?.state, errors: shard.errors.slice(0, 2) });
  await close(shard);
}

if (only.includes('captain')) {
  // Before the fix a body's `burst-x` never came over the wire, so the page's splash read 0 and fell at the captain's feet. He has no encounter row, and rises off the
  // altar's real press. Stand-in: the three shards the press needs are raised by hand. He sinks only past his first third (captain.as: p>1 and 7 s stalking), so real blows bring him there.
  const shard = await open('driftwood-isle', '&bossGod=1'), { page } = shard;
  await page.evaluate(() => { for (const flag of ['shard:lookout', 'shard:wreck', 'shard:cave']) window.__workerClientFlag(flag); });
  await page.waitForTimeout(2000);
  const altar = await page.evaluate(() => { const found = window.__wildshard.world.interactables.find(row => /^Set the glyph/iu.test(row.label ?? '')); return found === undefined ? null : { x: found.position.x, y: found.position.y, z: found.position.z, label: found.label }; });
  const pressed = altar === null ? null : await (async () => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1.2], [0, -1.2]]) {
      await place(page, altar.x + dx, altar.y - 1.2, altar.z + dz); await page.waitForTimeout(1000);
      await page.keyboard.press('KeyE'); await page.waitForTimeout(900);
      if ((await report(page)).flags.includes('used:altar')) return true;
    }
    return false;
  })();
  const captain = () => page.evaluate(() => [...window.__wildshard.world.animals.animals].filter(body => body.kind === 'captain' && body.alive).map(body => ({ x: body.position.x, y: body.position.y, z: body.position.z, hp: body.hp / body.maxHp, st: body.mem?.st ?? null, burst: [body.mem?.['burst-x'] ?? 0, body.mem?.['burst-z'] ?? 0] }))[0] ?? null);
  const rose = await until(page, captain, 25);
  const trail = [];
  let seen = null;
  if (rose !== null) {
    await page.evaluate(() => { window.__workerClientHits(4); });
    const end = Date.now() + 75_000;
    while (seen === null && Date.now() < end) {
      const body = await captain();
      if (body === null) { await page.waitForTimeout(300); continue; }
      if (trail.at(-1) !== body.st) trail.push(body.st);
      if (body.burst[0] !== 0 || body.burst[1] !== 0) { seen = body; break; }
      if (body.hp > 0.6) { await place(page, body.x + 2, body.y + 0.4, body.z + 2); await page.waitForTimeout(250); await faceAt(page, mid(body)); await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(400); }
      else await page.waitForTimeout(200);
    }
  }
  const r = await report(page);
  note('N7 the captain\'s splash reads burst-x off the wire', seen !== null, { altar, pressed, rose, seen, trail, drawn: r.drawn, fights: r.fights, errors: shard.errors.slice(0, 2) });
  await close(shard);
}

/** How far the view stands off facing `at`, in radians: 0 is dead on. */
const offView = (page, at) => page.evaluate(({ x, z }) => { const { player } = window.__wildshard.world, want = Math.atan2(player.position.x - x, player.position.z - z), off = want - player.yaw; return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))); }, at);
/** Every toast and feed line since `from`. */
const words = async (page, from = 0) => (await tape(page)).slice(from).filter(line => /^(?:toast|killFeed) /u.test(line) && !/Journal|Contract/u.test(line));
/** Blows on a body until a fight stands in `state`. */
async function blows(page, id, state, seconds, near = 2) {
  const end = Date.now() + seconds * 1000;
  let row = await fight(page, id);
  while (row?.state !== state && Date.now() < end) {
    if (row?.at !== null && row?.at !== undefined) {
      await place(page, row.at.x + near, row.at.y + 0.4, row.at.z + near); await page.waitForTimeout(300);
      await faceAt(page, mid(row.at)); await page.evaluate(() => { window.__wildshard.world.game.app.input.press('attack'); }); await page.waitForTimeout(450);
    } else await page.waitForTimeout(400);
    row = await fight(page, id);
  }
  return row;
}
/** The view through an intro, sampled from its first frames: where it stood off the fight's body, and how many frames it took to get there. */
async function introView(page, id) {
  const offs = []; let row = await fight(page, id);
  while (row?.state === 'intro' && offs.length < 40) { if (row.at !== null) offs.push(Number((await offView(page, row.at)).toFixed(3))); await page.waitForTimeout(100); row = await fight(page, id); }
  return offs;
}
const nearly = (first, last) => first === undefined || last === undefined ? false : last < first || last < 0.2;

if (only.includes('roc')) {
  // Stand-in: `far.roc.down` raised by hand for the second run, because a server's win is final in a session. The fight, its blows and its row are real.
  for (const again of [false, true]) {
    const shard = await open('far-reach', '&bossGod=1'), { page } = shard, id = 'far.roc.encounter', crown = [0, 45.5, -188];
    await page.evaluate(down => { window.__workerClientHits(40); if (down) window.__workerClientFlag('far.roc.down'); }, again);
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.__tape.length = 0; });
    await place(page, crown[0], crown[1], crown[2]);
    await page.evaluate(() => { window.__wildshard.world.player.yaw = 2.4; }); // away: `place` leaves yaw 0, which may already face him
    const intro = await until(page, async () => { const row = await fight(page, id); return row?.state === 'intro' || row?.state === 'fight' ? row.state : null; }, 20, 80), turned = await introView(page, id);
    const yaw = await page.evaluate(() => window.__wildshard.world.player.yaw);
    const before = (await report(page)).paid, row = await blows(page, id, 'victory', 70);
    await stand(page); await page.waitForTimeout(4500);
    const said = await words(page), { paid, owned } = await report(page), want = again ? 'The Storm Roc falls into the clouds' : 'The storm breaks: 25 coins';
    note(`Roc's win, ${again ? 'again' : 'first'}: ${want}`, row?.state === 'victory' && Math.abs(yaw - 2.4) > 0.3 && said.filter(line => line === `toast ${want}`).length === 1, { intro, yaw, turned: turned.slice(0, 8), before, paid, coins: owned.coins, said, errors: shard.errors.slice(0, 3) });
    await close(shard);
  }
}

if (only.includes('sunscar')) {
  // The whole quest as a player plays it (`sunscarJourney`): the fire's gate reads marks as well as flags, so hand-raised flags can't open it.
  // Stand-in, second run only: `sunscar.matriarch.paid` raised by hand, because a server's win is final in a session. The server's own record read its save at boot, so it pays either way: this proves the page's line.
  const { sunscarJourney } = await import('./worker-client-fights.mjs');
  for (const again of [false, true]) {
    let said = null, trail = null, passed = 0, refused = 0;
    await sunscarJourney(browser, phone, base, async (name, run) => {
      const out = await run();
      if (out.ok) passed++; else { refused++; console.log(`  step refused: ${name} ${JSON.stringify(out).slice(0, 300)}`); }
      if (name.includes('Matriarch falls')) {
        await new Promise(resolve => { setTimeout(resolve, 1500); });
      }
    }, async page => {
      await page.evaluate(paid => {
        const { world } = window.__wildshard, lines = window.__said = [], view = window.__introView = [];
        const toast = world.hud.toast.bind(world.hud); world.hud.toast = (...args) => { lines.push(args[0]); toast(...args); };
        const look = () => {
          const row = window.__workerClientFights?.().find(entry => entry.id === 'sunscar.matriarch');
          if (row?.state === 'intro' && view.length < 200) { const { player } = world, at = row.at; if (at === null) view.push(null); else { const off = Math.atan2(player.position.x - at.x, player.position.z - at.z) - player.yaw; view.push(Number(Math.abs(Math.atan2(Math.sin(off), Math.cos(off))).toFixed(3))); } }
          requestAnimationFrame(look);
        };
        look();
        if (paid) window.__workerClientFlag('sunscar.matriarch.paid');
      }, again);
      const spy = setInterval(() => { void page.evaluate(() => [window.__said, window.__introView]).then(([lines, view]) => { said = lines; trail = view; return undefined; }).catch(() => undefined); }, 500);
      page.once('close', () => { clearInterval(spy); });
    });
    const line = (said ?? []).filter(text => /bowl erupts|storm|Matriarch|coins/iu.test(text)), summons = line.filter(text => text.includes('The bowl erupts')).length;
    note(`Matriarch, ${again ? 'paid before' : 'first win'}: one summons, and her win's line`, refused === 0 && summons === 1, { passed, refused, line, turned: (trail ?? []).slice(0, 8), frames: trail?.length ?? 0 });
  }
}

if (only.includes('phases')) {
  // Softer blows than N2's above, so the King lives through his phases and each one is a row's move. The turn in the room's intro eases: the first sample stands well off.
  const shard = await open('pine-hollow', '&bossGod=1'), { page } = shard, [x, z] = [150, -30];
  await page.evaluate(() => { window.__workerClientHits(15); window.__workerClientTime('night'); });
  await page.waitForTimeout(2500);
  await place(page, x, await groundAt(page, x, z) + 1, z + 2);
  const id = await until(page, () => page.evaluate(() => window.__workerClientFights().find(row => /king/u.test(row.id))?.id ?? null), 20);
  await page.evaluate(() => { const { player } = window.__wildshard.world; player.yaw += 2.4; });
  await page.evaluate(want => {
    const moves = window.__moves = []; let last = '';
    const look = () => { const row = window.__workerClientFights().find(entry => entry.id === want), now = row === undefined ? 'none' : `${row.state}:${String(row.phase)}:${row.hp.toFixed(1)}`; if (now !== last) { last = now; moves.push(now); } requestAnimationFrame(look); };
    look();
  }, id);
  await until(page, async () => (await fight(page, id))?.state === 'intro', 40, 80);
  const turned = await introView(page, id), phases = [];
  const end = Date.now() + 240_000;
  // A win is judged before a phase, so a blow that takes the whole bar skips them, and a soft one loses to him: `by` sits between, found by trial.
  let row = await fight(page, id);
  while (row?.state !== 'victory' && (row?.phase ?? 0) < 1 && Date.now() < end) {
    if (phases.at(-1) !== row?.phase) phases.push(row?.phase);
    row = await blows(page, id, 'victory', 2);
  }
  phases.push(row?.phase);
  await page.waitForTimeout(1200);
  const heard = await tape(page), music = await score(page), feed = heard.filter(line => line.startsWith('killFeed'));
  note('the King\'s phases: a feed line and a score phase each, off the row', phases.length >= 2 && feed.some(line => line.includes('·')) && music.includes('phase:2'), { scored: music.filter(line => line.startsWith('phase:')), id, phases, moves: await page.evaluate(() => window.__moves), state: row?.state, falls: (await report(page)).falls, feed, music: music.slice(-14), errors: shard.errors.slice(0, 3) });
  note('a room\'s intro eases the view to the body', turned.length >= 3 && nearly(turned[0], turned.at(-1)) && (turned[0] ?? 0) > (turned.at(-1) ?? 0), { turned });
  await close(shard);
}

if (only.includes('longroom')) {
  // A room holds the world's ticks. A page that goes on acking through it spends credit no tick refills, and the room drops it at CLIENT_FLOOD_DEBT.
  const shard = await open('driftwood-isle'), { page } = shard, seconds = Number(arg('room', '140'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__wildshard.world.hud.onArena(); });
  await until(page, () => page.evaluate(() => window.__wildshard.world.arena?.active === true), 30);
  const from = await report(page);
  await page.waitForTimeout(seconds * 1000);
  const inRoom = await report(page);
  await page.evaluate(() => { window.__wildshard.world.arena.exit(); });
  await page.waitForTimeout(3000);
  const back = await report(page);
  await page.waitForTimeout(3000);
  const later = await report(page);
  note(`a ${String(seconds)} s practice room keeps its session`, (back.closed ?? null) === null && (later.closed ?? null) === null && later.ticksPerSecond > 0, { seconds, frames: inRoom.frames - from.frames, closed: [inRoom.closed ?? null, back.closed ?? null, later.closed ?? null], ticksPerSecond: later.ticksPerSecond, errors: shard.errors.slice(0, 3) });
  await close(shard);
}

if (only.includes('day')) {
  const shard = await open('driftwood-isle'), { page } = shard;
  await page.waitForTimeout(1500);
  const read = () => page.evaluate(() => ({ row: window.__workerClient().day, page: window.__wildshard.world.game.sky.dayNight?.phase ?? null }));
  await page.evaluate(() => { window.__wildshard.world.hud.onArena(); });
  await until(page, () => page.evaluate(() => window.__wildshard.world.arena?.active === true), 30);
  const entered = await read();
  await page.waitForTimeout(25_000);
  const left = await read();
  await page.evaluate(() => { window.__wildshard.world.arena.exit(); });
  await page.waitForTimeout(2500);
  const back = await read();
  note('a day goes on through a practice room, and the page\'s sky keeps it', back.row !== null && back.page !== null && back.row > entered.row + 0.005 && Math.abs(back.row - back.page) < 0.004 && back.page >= left.page, { entered, left, back, errors: shard.errors.slice(0, 3) });
  await close(shard);
}

await browser.close();
console.log(JSON.stringify({ gate: 'worker-client-moments', failed }));
process.exit(failed === 0 ? 0 : 1);
