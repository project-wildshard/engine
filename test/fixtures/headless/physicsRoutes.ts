// oxlint-disable-next-line import/no-nodejs-modules -- Replay the maintained physics ruler routes without rewriting them.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';

const coordinate=v.pipe(v.number(),v.finite());
const legSchema=v.object({name:v.string(),start:v.object({x:coordinate,z:coordinate,y:v.exactOptional(coordinate),yaw:coordinate,hover:v.exactOptional(v.boolean())}),
  timeout:v.optional(v.pipe(coordinate,v.minValue(1),v.maxValue(240)),60),
  inside:v.exactOptional(v.object({x0:coordinate,x1:coordinate,z0:coordinate,z1:coordinate,floor:coordinate})),
  waypoints:v.pipe(v.array(v.object({x:coordinate,z:coordinate,jump:v.exactOptional(v.union([v.boolean(),v.number()])),jumpAt:v.exactOptional(coordinate)})),v.minLength(1))});
const source:unknown=JSON.parse(readFileSync(process.env['WS_PHYSICS_ROUTE']??'scripts/physics-route.json','utf8'));
const repeat=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10)),Number(process.env['WS_PHYSICS_REPEAT']??'1'));
const shard=process.env['WS_PHYSICS_SHARD']??'',name=process.env['WS_PHYSICS_LEG']??'';
export const physicsRoutes=Object.entries(v.parse(v.record(v.string(),v.unknown()),source)).filter(([slug])=>!slug.startsWith('$')&&(shard===''||slug===shard))
  .flatMap(([slug,raw])=>v.parse(v.array(legSchema),raw).filter(leg=>name===''||leg.name===name)
    .flatMap(leg=>Array.from({length:repeat},()=>({slug,leg}))));
if(physicsRoutes.length===0)throw new Error('No native physics route matches the selection');
