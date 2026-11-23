// @vitest-environment happy-dom
import {expect,test,vi} from 'vitest';
import {Scope} from '@wildshard/engine/app/scope';
import {parseClientPlan} from '@wildshard/format/clientPlan';
import {CLIENT_FEATURES,installClientPhase,pageHomes} from './clientPlan';
import {publishEntryOwner} from '../../../shared/game/shardfile/entryOwners';
import type {ShardContext} from '../plugin/context';
import type {ForestWeatherRig} from '../weather/forest';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';

test('weather diagnostics wait for the original play-phase weather publication',async()=>{
 const scope=new Scope('late-weather-debug'),expose=vi.fn<ShardContext['debug']['expose']>();
 const ctx=legacyDouble<ShardContext>({scope,game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<NonNullable<ShardContext['game']['runtime']>>({})}),
  // installClientPhase paces rows at the product's tier (f1daaa0c), so the product carries a shardfile.
  product:legacyDouble<ShardContext['product']>({slug:'orchard',shardfile:legacyDouble<ShardContext['product']['shardfile']>({runtime:null,budgets:legacyDouble<ShardContext['product']['shardfile']['budgets']>({tier:'small'})})}),debug:{expose}});
 const plan=pageHomes(parseClientPlan({version:1,features:[{kind:'debug.expose',name:'weather',source:{kind:'world-weather',owner:'orchard.weather'}}]}).features);
 try{
  // World bindings run before weather.forest constructs and publishes at play/40.
  await installClientPhase(ctx,plan,'world-bindings',scope);
  expect(expose).not.toHaveBeenCalled();
  expect(CLIENT_FEATURES['weather.forest']).toMatchObject({phase:'play',rank:40});
  expect(CLIENT_FEATURES['debug.expose'].rank).toBeGreaterThan(CLIENT_FEATURES['weather.forest'].rank);
  const weather=legacyDouble<ForestWeatherRig>({});publishEntryOwner(scope,'world-weather','orchard.weather',weather);
  await installClientPhase(ctx,plan,'play',scope);
  expect(expose).toHaveBeenCalledOnce();
  expect(expose.mock.calls[0]?.[0]).toBe('weather');expect(expose.mock.calls[0]?.[1]).toBe(weather);
 }finally{scope.dispose();}
});
