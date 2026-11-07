import * as v from 'valibot';
import {placesWithDiscovery} from '../../src/shared/engine/quest/discovery';
import {ChapterViewSchema} from '@wildshard/format/questPageComposition';
import {mountedPlayerOf} from '../../src/server/game/riding/native';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {prepareProductPlan as prepareNalati} from './headless-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Observe the native motor/water modes and run the same admitted discovery
 * law as the page. No input command can assign a mode, pose or discovered flag. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=async preparation=>{
  const base=await prepareNalati(preparation);
  const page=v.parse(ChapterViewSchema,await preparation.product.json('quests/content.json'));
  return {...base,install:(host,context)=>{
    base.install(host,context);
    const mounted=mountedPlayerOf(host);if(mounted===undefined)throw new Error('Nalati world verbs require their native movement owner');
    const places=placesWithDiscovery(structuredClone(page.places),host.flags,text=>context.emit({kind:'hint',text}),()=>[]);
    const snapshot=():string=>JSON.stringify({mode:leadPlayer(host).modes.current(),board:leadPlayer(host).board.on,swim:leadPlayer(host).swim.on,
      crouching:mounted.rider.crouching,sprinting:mounted.rider.sprinting,velocity:leadPlayer(host).velocity.toArray(),
      places:places.points.map(point=>({id:point.id,discovered:places.discovered(point.id)}))});
    host.onStep('nalati.world',()=>{const p=leadPlayer(host).position;places.update(p.x,p.z,p.y);},{snapshot,restore:value=>{
      if(value!==snapshot())throw new Error('World observation differs from its restored native owners');
    }},'afterBodies');
  }};
};
