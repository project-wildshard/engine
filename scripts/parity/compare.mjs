import { array, equal, flatten, get, number, object, set, string } from './value.mjs';
import { budgetChecks } from './budgets.mjs';
/** @typedef {import('./value.mjs').Value} Value */
/** @typedef {import('./value.mjs').RecordValue} RecordValue */
/** @typedef {{field:string, baseline:Value|undefined, now:Value|undefined, band:string, verdict:string, class:string}} Verdict */
/** @typedef {{pending?:RecordValue[], quarantine?:RecordValue[], renames?:RecordValue[], ambientInfo?:string[], lanePending?:boolean, now?:string, ignore?:string[]}} CompareOptions */

/** Partial captures do not share the full sequence's scheduler frame boundaries.
 * Keep their sound observations in artifacts, but compare them only on complete
 * captures. Gameplay, audio ownership and disposal checks retain their gates.
 * @param {string|undefined} only @param {boolean} [fast] @returns {string[]} */
export function captureIgnore(only, fast = false) {
  const ignored = only === 'fingerprint+poses' ? ['walk', 'combat', 'pauseResume', 'leak'] :
    only === 'walk+combat+leak' ? ['poses'] : [];
  if (only === 'fingerprint+poses' || only === 'walk+combat+leak' || fast) ignored.push('walk.sounds', 'combat.sounds');
  return ignored;
}
/** @param {string} pattern @param {string} path */
export function matches(pattern, path) {
  const re = pattern.split('*').map((p) => p.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('.*');
  return new RegExp(`^${re}(?:\\.|$)`).test(path);
}
/** Maps only structural baseline fields. List ordering is deliberately preserved.
 * @param {RecordValue} baseline @param {RecordValue} current @param {RecordValue[]} maps */
export function renameBaseline(baseline, current, maps) {
  const b = structuredClone(baseline);
  for (const map of maps) {
    const shardSystems = object(object(map.shardSystems)[string(get(current, 'boot.shard'))]);
    const systems = object(map.systems), phaseSystems = object(map.phaseSystems), saves = object(map.saves), registry = object(map.registry);
    // phase keys hold dots ('fixed.pre'): assign on the systems object itself, never through a dotted set() path,
    // which would build a nested 'fixed' key (E357 lead: it turned every record red on boot.systems.fixed)
    const bootSystems = object(get(b, 'boot.systems'));
    for (const [phase, list] of Object.entries(bootSystems)) bootSystems[phase] = array(list).map((id) => object(shardSystems[phase])[string(id)] ?? object(phaseSystems[phase])[string(id)] ?? systems[string(id)] ?? id);
    for (const path of ['boot.saves.read', 'boot.saves.written', 'combat.loot.written']) {
      const list = get(b, path); if (list !== undefined) set(b, path, array(list).map((id) => {
        const key = string(id), prefix = /^(local:|session:)/.exec(key)?.[0] ?? '';
        return saves[key] ?? (prefix + string(saves[key.slice(prefix.length)] ?? key.slice(prefix.length)));
      }));
    }
    if (get(b, 'boot.registry') !== undefined) {
      const renamed = object(registry.renamed), added = array(registry.added).map(string), removed = array(registry.removed).map(string);
      const pieces = array(get(b, 'boot.registry')).map((p) => Object.assign(object(p), {id: renamed[string(object(p).id)] ?? object(p).id ?? ''}));
      const retained = pieces.filter((p) => !removed.some((pat) => matches(pat, string(p.id))));
      const ids = new Set(retained.map((p) => string(p.id)));
      const additions = array(get(current, 'boot.registry')).filter((p) => {
        const id = string(object(p).id);
        if (ids.has(id) || !added.some((pat) => matches(pat, id))) return false;
        ids.add(id);
        return true;
      });
      set(b, 'boot.registry', [...retained, ...additions].sort((a, c) => string(object(a).id).localeCompare(string(object(c).id))));
    }
  }
  return b;
}
/** @param {string} p */
function measured(p) { return /^(boot\.(render\.(programs|memory\.)|gpuBytes\.)|poses\.[^.]+\.(pos|calls$|tris$)|walk\.legs\.[^.]+\.(end|maxY$)|combat\.hitsToKill)/.test(p); }
/** A measured field's band is 2 × its recorded run-to-run spread (max − min of the baseline's recording runs, 03 §8):
 * exact when the runs agreed. E388 deleted the per-field floors that sat on top (tris 1 %, maxY 0.3 m, pos 0.05 m,
 * calls 2, end 1 m, GPU bytes 1 MiB, hitsToKill 1): no measurement backed them, and every recorded spread of these
 * fields in both lanes' baselines is 0, so they never widened a band.
 * @param {Value|undefined} expected @param {Value|undefined} actual @param {Value|undefined} noise */
function numericBand(expected,actual,noise) {
  const width=/** @param {number} spread */(spread)=>2*spread;
  if(Array.isArray(expected)) {
    const widths=expected.map((_,i)=>width(number(Array.isArray(noise)?noise[i]:noise??0)));
    return {pass:Array.isArray(actual)&&expected.length===actual.length&&expected.every((v,i)=>Number.isFinite(number(actual[i]))&&Math.abs(number(actual[i])-number(v))<=widths[i]),band:`± ${JSON.stringify(widths)}`};
  }
  const band=width(number(noise??0));
  return {pass:typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-number(expected))<=band,band:`± ${band}`};
}
/** @param {string} p */
// X22 (G415/G416): exact resource, scene, step, system and HUD counts are information, not gates. They tracked every
// content change rather than a glitch; errors, stuck walks, combat, pause, leaks, budgets and the pose SSIM floors gate.
function info(p) { return /^(harness$|sha$|recorded$|browser$|spread|selfMin|verdict|boot\.(?:sha|build|browser|playMs|stepMs|heapMB|gpuBytes|render|scene\.(?:named|totals)|steps|systems|hud)(?:\.|$)|poses\.[^.]+\.(fps|frameP|cpuP|frames|creatureBoxes|boxes|shot|calls$|tris$)|walk\.legs\.[^.]+\.(seconds|trace)|leak\.scope)/.test(p); }
/** @param {RecordValue} value */
export function normalize(value) {
  const result = structuredClone(value);
  for (const path of ['poses', 'walk.legs']) {
    const list = get(result, path);
    if (Array.isArray(list)) set(result, path, Object.fromEntries(list.map((v) => [string(object(v).name), v])));
  }
  return result;
}
/** Every entry names an owner, an ask, a reason and its own expiry; an expired entry turns the gate red.
 * E388 deleted the invented caps on top (at most 5 entries, at most 3 days): the owner's ask sets the date.
 * @param {RecordValue[]} entries @param {string} today */
export function validateQuarantine(entries, today) {
  /** @type {string[]} */ const errors = [];
  for (const e of entries) {
    const start = Date.parse(string(e.since)), end = Date.parse(string(e.until));
    if (!string(e.owner) || !/^E\d+$/.test(string(e.ask)) || !string(e.why) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) errors.push(`invalid quarantine: ${string(e.id)}`);
    if (string(e.until) < today) errors.push(`quarantine expired: ${string(e.id)}`);
    if (/\/(boot\.(errors|renderer|facade)|boot.scene.totals.batched|walk\.(stuck|touch)|.*\.stuck|.*\.out|combat\.(swing|shot)|pauseResume|leak|budgets)/.test(string(e.id))) errors.push(`class D cannot be quarantined: ${string(e.id)}`);
  }
  return errors;
}
/** Pure comparison, used by capture, recording validation, and fixtures.
 * @param {RecordValue} rawBaseline @param {RecordValue} rawCurrent @param {CompareOptions} [options] */
export function compare(rawBaseline, rawCurrent, options = {}) {
  const current = normalize(rawCurrent), baseline = renameBaseline(normalize(rawBaseline), current, options.renames ?? []);
  const bf = flatten(baseline), cf = flatten(current), spreads = object(rawBaseline.spread), selfMin = object(rawBaseline.selfMin);
  /** @type {Verdict[]} */ const rows = [];
  const shard = string(get(current, 'boot.shard')), tier = string(get(current, 'boot.tier')), lane = string(get(current, 'boot.lane'));
  /** @param {string} field @param {Value|undefined} before @param {Value|undefined} now @param {string} cls @param {boolean} pass @param {string} band */
  function emit(field, before, now, cls, pass, band) {
    if(cls!=='D' && (options.ignore??[]).some((p)=>matches(p,field)))return;
    let verdict = pass ? 'green' : 'red';
    if (cls === 'C') verdict = 'info';
    else if (cls !== 'D') {
      const pending = (options.pending ?? []).find((e) => string(e.shard) === shard && array(e.fields).some((p) => matches(string(p), field)));
      if (pending) {
        const expect = object(pending.expect)[`${tier}/${field}`];
        if (lane !== 'm5' || pending.expect === null || expect === undefined) verdict = 'pending';
        else { const imageBand=/^poses\.[^.]+\.ssim$/.test(field)?1-Math.min(0.99,number(selfMin[field.split('../parity')[1]??'']??1)-0.01):null;const inside=imageBand!==null?typeof now==='number'&&Math.abs(now-number(expect))<=imageBand:measured(field)?numericBand(expect,now,spreads[field]).pass:equal(now,expect);verdict=inside?'pending':'red'; }
      } else if (before === undefined) verdict = 'new';
      if (options.lanePending) verdict = 'lane-pending';
      if ((options.quarantine ?? []).some((e) => string(e.id) === `${shard}/${tier}/${field}`)) verdict = 'quarantined';
    }
    rows.push({field, baseline:before, now, class:cls, band, verdict});
  }
  for (const error of validateQuarantine(options.quarantine ?? [], options.now ?? new Date().toISOString().slice(0, 10))) emit('quarantine', undefined, error, 'D', false, 'valid, unexpired');
  // D checks run even with no baseline, pending board or quarantine.
  const d = /** @type {Array<[string, boolean, string]>} */ ([
    ['boot.errors', array(get(current, 'boot.errors')).length === 0, '[]'],
    ['boot.renderer', string(get(current, 'boot.renderer')).includes('ANGLE (Apple, ANGLE Metal Renderer'), 'ANGLE Metal'],
    ['boot.scene.totals.batched', Number.isInteger(get(current, 'boot.scene.totals.batched')) && number(get(current, 'boot.scene.totals.batched')) >= 0 && (shard === 'nine-dragon-stack' ? get(current, 'boot.scene.totals.batched') === 0 : get(baseline, 'boot.scene.totals.batched') === undefined || number(get(current, 'boot.scene.totals.batched')) <= number(get(baseline, 'boot.scene.totals.batched'))), shard === 'nine-dragon-stack' ? '0 (facade prohibition)' : get(baseline, 'boot.scene.totals.batched') === undefined ? 'record initial count (B15)' : `≤ ${number(get(baseline, 'boot.scene.totals.batched'))} (B15 ratchet)`],
  ]);
  if (get(current, 'boot.facade') !== undefined) d.push(['boot.facade', get(current, 'boot.facade.multiDraw') === true && get(current, 'boot.facade.batches') === 0 && number(get(current, 'boot.facade.instances')) > 0, 'multiDraw available; 0 batches; >0 instances']);
  if (get(current, 'walk') !== undefined) d.push(['walk.stuck', get(current, 'walk.stuck') === 0, '0']);
  for (const [name, leg] of Object.entries(object(get(current, 'walk.legs')))) {
    d.push([`walk.legs.${name}.stuck`, array(object(leg).stuck).length === 0, '[]']);
    if (object(leg).out !== undefined) d.push([`walk.legs.${name}.out`, object(leg).out === 0, '0']);
  }
  const touch = get(current, 'walk.touch');
  if (touch !== undefined) d.push(['walk.touch', number(object(touch).moved) >= 2 && number(object(touch).yawDelta) !== 0 && object(touch).dodged === true && (object(touch).used === true || object(touch).used === 'n/a'), 'moved ≥2; yaw changed; dodge; use']);
  for (const step of ['swing', 'shot', 'shot2']) {
    const v = get(current, `combat.${step}`); if (v === undefined || v === 'n/a') continue;
    const s = object(v);
    d.push([`combat.${step}`, number(s.hits) >= 1 && number(s.hitWithinS) <= number(s.hitLimit) && (s.killLimit === null || (s.killed === true && number(s.killWithinS) <= number(s.killLimit))), 'hit and kill within limits']);
  }
  const pause = get(current, 'pauseResume');
  if (pause !== undefined) d.push(['pauseResume', array(object(pause).diff).length === 0 && (get(current, 'boot.appStates') === undefined || (array(object(pause).appStates)[0] === 'paused' && array(object(pause).appStates)[1] === object(pause).returnState)), 'no state drift; resumed prior state']);
  for (const prefix of ['leak', 'leak.weather']) {
    const errors = get(current, `${prefix}.disposalErrors`);
    if (errors !== undefined) emit(`${prefix}.disposalErrors`, [], errors, 'D', equal(errors, []), 'no disposal failures');
  }
  for (const [path, after] of Object.entries(flatten(get(current, 'leak.after')))) d.push([`leak.${path}`, equal(after, get(current, `leak.before.${path}`)), 'B1 = B0']);
  for (const [path, after] of Object.entries(flatten(get(current, 'leak.weather.after')))) d.push([`leak.weather.${path}`, equal(after, get(current, `leak.weather.before.${path}`)), 'weather B1 = B0']);
  for (const [path, pass, band] of d) {
    const prefix=path.startsWith('leak.weather.')?'leak.weather.':path.startsWith('leak.')?'leak.':null;
    emit(path, prefix?get(current,`${prefix}before.${path.slice(prefix.length)}`):get(baseline,path), prefix?get(current,`${prefix}after.${path.slice(prefix.length)}`):get(current,path), 'D', pass, band);
  }
  for (const check of budgetChecks(current)) emit(check.field, check.limit, check.observed, 'D', check.pass, `≤ ${check.limit}`);
  // X22: a baseline sound that stopped playing is a glitch; its exact count is not (similar, not identical: G415)
  for(const path of ['walk.sounds.event','combat.sounds.event'])if(get(current,path)!==undefined || get(baseline,path)!==undefined)emit(path,get(baseline,path),get(current,path),'A',Object.keys(object(get(baseline,path)??{})).every((kind)=>number(object(get(current,path)??{})[kind]??0)>0),'baseline kinds still play');
  for (const path of new Set([...Object.keys(bf), ...Object.keys(cf)])) {
    if (d.some(([p]) => matches(p, path)) || matches('walk.sounds.event',path) || matches('combat.sounds.event',path) || path.startsWith('budgets.') || path.startsWith('leak.') || (options.ignore ?? []).some((p) => matches(p, path))) continue;
    const a = bf[path], b = cf[path];
    if (info(path)) { emit(path, a, b, 'C', true, 'information'); continue; }
    if (path.endsWith('.ambient')) {
      const ignored = options.ambientInfo ?? [], missing = array(a).filter((id) => !ignored.includes(string(id)) && !array(b).includes(id));
      emit(path, a, b, 'A', missing.length === 0, 'no baseline scheduler missing'); continue;
    }
    if (/^poses\.[^.]+\.ssim$/.test(path)) {
      // X22 (G416): the phone's pose SSIM is the visual gate; desktop references are not stored (over the preview cap)
      if (string(get(current, 'boot.tier')) === 'desktop') { emit(path, a, b, 'C', true, 'information (desktop)'); continue; }
      const pose = path.split('../parity')[1] ?? '', limit = Math.min(0.99, number(selfMin[pose] ?? 1) - 0.01);
      emit(path, a, b, 'B', number(b) >= limit, `≥ ${limit}`); continue;
    }
    if (measured(path) && (typeof a === 'number' || Array.isArray(a))) {
      const band=numericBand(a,b,spreads[path]);
      emit(path, a, b, 'B', band.pass, band.band);
    } else emit(path, a, b, 'A', equal(a, b), 'exact');
  }
  return {verdict: rows.some((r) => r.verdict === 'red') ? 'red' : rows.some((r) => r.verdict === 'lane-pending') ? 'lane-pending' : rows.some((r) => r.verdict === 'pending') ? 'pending' : 'green', rows};
}
