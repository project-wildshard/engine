import * as v from 'valibot';

const finite = v.pipe(v.number(), v.finite());
const name = v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));
const point = v.tuple([finite, finite, finite]);
const world = v.strictObject({eye:point,look:point,fov:finite});
const view = v.strictObject({n:finite,name,label:v.string(),player:v.tuple([finite,finite]),eye:point,look:point,
  hfov:v.literal(62),aspect:v.literal('2:3'),world,inside:v.nullable(name),note:v.optional(v.string())});
const schema = v.strictObject({schema:v.literal('golden-cameras/1'),slug:name,instance:name,
  origin:v.strictObject({x:finite,z:finite}),pitch:finite,convention:v.string(),views:v.pipe(v.array(view),v.length(8))});

/** Keep the historical world coordinates as provenance and reject corrupt local/world pairs.
 * @param {unknown} input */
export function parsePlotGoldens(input) {
  const plan = v.parse(schema,input);
  if (plan.pitch <= 500 || !plan.slug.startsWith('open-plot-') || new Set(plan.views.map(row=>row.name)).size !== 8)
    throw new Error('Invalid golden plot identity');
  for (const [index,row] of plan.views.entries()) {
    const camera = plotGoldenCamera(row,plan.origin);
    if (row.n !== index+1 || row.player.some(word=>Math.abs(word)>250) || !row.eye.some((word,i)=>word !== row.look[i])
      || Math.abs(camera.fov-row.world.fov)>1e-6
      || camera.eye.some((word,i)=>Math.abs(word-row.world.eye[i])>1e-6)
      || camera.look.some((word,i)=>Math.abs(word-row.world.look[i])>1e-6)) throw new Error('Golden camera provenance differs');
  }
  return plan;
}

/** @param {{eye:readonly number[],look:readonly number[],hfov:number}} row
 * @param {{x:number,z:number}} origin */
export function plotGoldenCamera(row,origin) {
  return {eye:[row.eye[0]+origin.x,row.eye[1],row.eye[2]+origin.z],
    look:[row.look[0]+origin.x,row.look[1],row.look[2]+origin.z],
    fov:2*Math.atan(Math.tan(row.hfov*Math.PI/360)/(2/3))*180/Math.PI};
}

/** Resolve by product identity, never the pre-G986 instance or world origin.
 * @param {ReturnType<typeof parsePlotGoldens>} plan
 * @param {Pick<import('../frame-floor-grid.mjs').FloorGridState,'pitch'|'cells'>} grid */
export function plotGoldenPlacement(plan,grid) {
  const cells=grid.cells.filter(row=>row.slug===plan.slug), pitch=grid.pitch;
  if (cells.length!==1 || pitch===undefined || !Number.isFinite(pitch) || pitch<=500) throw new Error('Golden plot needs one served cell and explicit pitch');
  const cell=cells[0];
  if (cell===undefined) throw new Error('Missing golden plot');
  return {instance:cell.instance,origin:{x:cell.cell[0]*pitch,z:cell.cell[1]*pitch},pitch,
    sourceInstance:plan.instance,sourceOrigin:plan.origin};
}
