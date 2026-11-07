import { writeSaveFixture } from './debug-settings.mjs';
import { gridFloorPlans } from './frame-floor-grid.mjs';

/** Pre-release capture only: seed the existing expiring tap intent, without enabling Developer or changing admission.
 * @param {{instance:string,slug:string}} home */
export function publicGridIntentCode(home) {
  return `(() => {const target={...${JSON.stringify(home)},at:Date.now()};const write=${writeSaveFixture.toString()};write({scope:'session',key:'gridIntent',data:target});write({scope:'device',key:'gridIntent.once',data:target});})()`;
}

/** A single initial home approach, followed by real-input road and template-centre legs.
 * @param {Pick<import('./frame-floor-grid.mjs').FloorGridState,'home'|'cells'|'pitch'>} state */
export function publicGridPlans(state) {
  const entry = gridFloorPlans(state, 'template').at(0);
  if (!entry?.start) throw new Error('Public grid needs its home approach');
  const cell = state.cells.find(row => row.instance === entry.to), end = entry.waypoints.at(-1);
  if (!cell || !end) throw new Error('Public grid needs a template destination');
  const road = entry.waypoints.length > 2 ? entry.waypoints.slice(0, 2)
    : [{x:(entry.start.x+end.x)/2,z:(entry.start.z+end.z)/2}];
  const centre = {x:cell.cell[0]*(state.pitch ?? 555),z:cell.cell[1]*(state.pitch ?? 555)};
  // The southern approach to the template centre meets the grey hut's back wall
  // at local z=-15. Walk around its west side; keep every segment real input.
  const interior = end.x === centre.x && end.z < centre.z
    ? [{x:centre.x-8,z:centre.z-25},{x:centre.x-8,z:centre.z},centre] : [centre];
  return [{name:'public-road',from:entry.from,to:null,borrowedHome:state.home,start:entry.start,waypoints:road,requiredResidents:[]},
    {name:'public-template',from:null,to:entry.to,waypoints:[...entry.waypoints.slice(entry.waypoints.length > 2 ? 2 : 0),
      ...interior],requiredResidents:[cell.instance]}];
}

/** Serialized read-only witness: effective mode, catalogue, runtime residents and the platform's own refusal receipt. */
export function readPublicGridWitness() {
  const grid = window.__wildshard.shard.grid;
  const device = JSON.parse(localStorage.getItem('wildshard.save.v2.device') ?? '{}');
  const session = JSON.parse(sessionStorage.getItem('wildshard.save.v2.session') ?? '{}');
  const state = grid.state();
  return {developer:Object.hasOwn(document.documentElement.dataset,'dev'),savedDeveloper:device.keys?.devMode?.data,
    state,refusals:session.keys?.shardRefusals?.data ?? {},homeResidency:grid.residency().home,
    cellLoading:state.cellLoading===null ? null : {instance:state.cellLoading,issue:state.live.live.issues[state.cellLoading] ?? null},
    runtimeLevel:window.__wildshard.world.game.level.id};
}

/** The slugs the public catalogue may hold (G258, G270). */
const PUBLIC_SLUGS = new Set(['driftwood-isle','_template','pine-hollow','nalati-grasslands','far-reach','sunscar-dunes']);

/** G258 / G270: the five real shards and Template 1 are public; Blender Template (Developer) and Nine Dragon (DEVSERVER) are not.
 * @param {import('./public-grid.mjs').PublicGridWitness} witness @param {boolean} requireTemplate */
export function publicGridWitnessFailures(witness, requireTemplate) {
  const failures = [], state = witness.state;
  if (witness.developer || witness.savedDeveloper !== false) failures.push('Developer is not saved and effective OFF');
  if (state.home !== 'driftwood-isle' || witness.runtimeLevel !== 'platform.grid') failures.push('Public grid is not the owned platform shell');
  if (witness.homeResidency?.instance !== state.home || !Number.isSafeInteger(witness.homeResidency.bytes) || witness.homeResidency.bytes <= 0) failures.push('Grid home has no positive admitted residency claim');
  if (state.cells.some(row => !PUBLIC_SLUGS.has(row.slug))) failures.push('Developer-only region is present in the public catalogue');
  if (state.live.live.residents.some(id => !state.cells.some(row => row.instance === id && PUBLIC_SLUGS.has(row.slug)))) failures.push('An unlisted region became a runtime resident');
  if (requireTemplate && !state.cells.some(row => row.slug === '_template' && row.instance === state.inside
    && row.instance === state.live.live.current && state.live.live.residents.includes(row.instance))) failures.push('Public template entry and residency were not witnessed');
  return failures;
}
