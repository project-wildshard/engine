import {expect,test} from 'vitest';
import {grassCards} from '../src/client/game/looks/grassPresentation';
import {GRASS_ROWS} from './fixtures/liveRenderRows';

// QA 11-24 row 70 (J510): a grass without card clumps (Nalati draws real blades to the camera) draws only blades and
// flowers; the format admits its card rows all together or none.
const cardless=()=>{
  const rows=structuredClone(GRASS_ROWS);
  for(const tier of [rows.phone,rows.desktop]){Reflect.deleteProperty(tier,'cards');Reflect.deleteProperty(tier.scenes,'cards');}
  Reflect.set(rows.view,'looks',rows.view.looks.slice(0,2));Reflect.deleteProperty(rows.view,'cardsHeight');
  return rows;
};
test('a grass without cards asks for no card scene, look or atlas',()=>{
  expect(grassCards(cardless(),'phone')).toBeNull();
  expect(grassCards(cardless(),'desktop')).toBeNull();
});
test('a grass with cards keeps its card look, scene, field and eye height',()=>{
  const rows=structuredClone(GRASS_ROWS),scene={file:'look/grass/phone-cards.json.z'};
  Reflect.set(rows.view,'looks',[rows.view.looks[0],rows.view.looks[1],'grass-cards']);Reflect.set(rows.view,'cardsHeight',6);
  Reflect.set(rows.phone,'cards',{T:2,s:0.2});Reflect.set(rows.phone.scenes,'cards',scene);
  expect(grassCards(rows,'phone')).toEqual({look:'grass-cards',scene,field:{T:2,s:0.2},height:6});
});
