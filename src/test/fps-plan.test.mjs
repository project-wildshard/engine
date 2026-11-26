import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fpsPlan } from '../scripts/fps/plan.mjs';
import { routeFor } from '../scripts/memory/iphone/route.mjs';

test('quick mode covers five profiles in one cold route each, with complete turns, waypoints and the original village dwell', () => {
  const quick = fpsPlan();
  expect(Object.keys(quick.profiles)).toHaveLength(5);
  expect(Object.values(quick.profiles).map(specs => specs.length)).toEqual([1, 1, 1, 1, 1]);
  expect(quick).toMatchObject({ mode:'quick', scope:'quick', count:1, warm:false, limitMs:1_200_000 });
  expect(quick.route.map(({name, seconds}) => [name, seconds])).toEqual([
    ['dock spawn', 30], ['beach', 25], ['village', 40],
  ]);
  expect(quick.route.map(({seconds:_seconds,...leg})=>leg)).toEqual(
    routeFor('driftwood-fps').slice(0,3).map(({seconds:_seconds,...leg})=>leg));
  // All five cold routes fit one nine-minute capture lease with boot headroom.
  expect(quick.route.reduce((sum,leg)=>sum+leg.seconds,0)*5).toBe(475);
  expect(quick.route[2]).toMatchObject({points:routeFor('driftwood-fps')[2].points, dwell:{seconds:20}});
});

test('qualification preserves every original window, variant, repeat and final warm arm', () => {
  const before = JSON.stringify(routeFor('driftwood-fps'));
  fpsPlan();
  const full = fpsPlan({qualify:true});
  expect(full).toMatchObject({mode:'qualify',scope:'route',count:3,warm:true,limitMs:null});
  expect(Object.values(full.profiles).map(specs => specs.length)).toEqual([1, 1, 1, 2, 4]);
  expect(full.route).toEqual(routeFor('driftwood-fps'));
  expect(JSON.stringify(full.route)).toBe(before);
  expect(Object.values(full.profiles).flat().length * full.count * full.route.length).toBe(135);
  for (const options of [{runs:'1'}, {runs:'2'}, {dockOnly:true}, {coldOnly:true}])
    expect(() => fpsPlan({qualify:true,...options})).toThrow('--qualify requires');
});

test('the command defaults to quick and explicitly selects full qualification', () => {
  const dry = args => JSON.parse(execFileSync(process.execPath,
    ['src/scripts/fps/table.mjs', '--dry-run', ...args], {encoding:'utf8'}));
  const quick = dry([]), full = dry(['--qualify']);
  expect(quick).toMatchObject({mode:'quick',count:1,warm:false});
  expect(quick.plan).toHaveLength(5);
  expect(quick.route).toHaveLength(3);
  expect(full).toMatchObject({mode:'qualify',count:3,warm:true});
  expect(full.plan).toHaveLength(9);
  expect(full.route).toHaveLength(5);
});

test('dry planning works without a Mac hardware model on non-macOS CI', () => {
  const entry = resolve('src/scripts/fps/table.mjs');
  const script = "Object.defineProperty(process,'platform',{value:'linux'});";
  const plan = JSON.parse(execFileSync(process.execPath,
    ['--import',`data:text/javascript,${encodeURIComponent(script)}`,entry,'--dry-run'],{encoding:'utf8'}));
  expect(plan).toMatchObject({host:'dry-run',mode:'quick'});
  expect(plan.plan).toHaveLength(5);
});


test('explicit reduced qualification retains three cold runs and warm sampling with a non-nightly scope', () => {
  const diagnostic = fpsPlan({qualify:true,windows:'1'});
  expect(diagnostic).toMatchObject({mode:'qualify',scope:'subset',count:3,warm:true,limitMs:null});
  expect(diagnostic.route).toEqual(routeFor('driftwood-fps').slice(0,1));
  const plan = JSON.parse(execFileSync(process.execPath,
    ['src/scripts/fps/table.mjs','--dry-run','--qualify','--profiles','phone-lpm-low','--windows','1'],{encoding:'utf8'}));
  expect(plan).toMatchObject({mode:'qualify',count:3,warm:true});
  expect(plan.plan).toHaveLength(1);
  expect(plan.route).toHaveLength(1);
  for (const options of [{windows:'1'}, {qualify:true,windows:'0'}, {qualify:true,windows:'6'}, {qualify:true,windows:'1.5'}])
    expect(() => fpsPlan(options)).toThrow('--windows requires');
});
