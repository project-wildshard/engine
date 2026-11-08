import { readFileSync } from 'node:fs';
import {MessageChannel} from 'node:worker_threads';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const epoch = JSON.parse(readFileSync(new URL('../save-epoch.json', import.meta.url), 'utf8')).saveEpoch;
const prefix = `wildshard.save.v2@${epoch}.`;
function script(attribute) {
  const body = html.match(new RegExp(`<script ${attribute}>([\\s\\S]*?)</script>`))?.[1];
  if (!body) throw new Error(`Missing inline ${attribute}`);
  return body;
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function retry(sessionStorage) {
  let timer, reloads = 0;
  runInNewContext(script('data-loading-first-paint'), {
    document: { documentElement: { hasAttribute: () => false }, querySelector: () => ({}) },
    sessionStorage, location: { reload: () => { reloads++; } },
    setTimeout: callback => { timer = callback; },
  });
  timer();
  return reloads;
}
test('the real pre-module retry and runtime share one epoch guard', () => {
  const session = storage();
  expect(retry(session)).toBe(1);
  expect(JSON.parse(session.getItem(`${prefix}session`)).keys['boot.selfReload']).toBeDefined();
  expect(retry(session)).toBe(0);
  expect(session.getItem('wildshard.save.v2.session')).toBeNull();
});
test('the pre-module clock consumes the current epoch title handoff', () => {
  const fields = { clock: {}, slug: {}, tier: {} };
  const card = { dataset: {}, querySelector: selector => fields[selector.match(/"(.*?)"/)[1]] };
  const arrival = { slug: 'pine-hollow', at: Date.now(), name: 'Pine Hollow', tier: 'Explorer' };
  runInNewContext(script('data-loading-clock'), {
    window:{}, document: { querySelector: () => card, getElementById: () => null }, location: { search: '?chunk=pine-hollow' }, URLSearchParams,
    sessionStorage: storage({ [`${prefix}session`]: JSON.stringify({ keys: { titleArrival: { data: arrival } } }) }),
    localStorage: storage(), performance: { now: () => 20, timeOrigin: arrival.at }, setInterval: () => 1,
  });
  expect(fields.slug.textContent).toBe('Pine Hollow');
  expect(fields.tier.textContent).toBe('Explorer');
  expect(fields.clock.textContent).toBe('00:00.0');
});

// The actual measurement ingress, using a native message port. These are
// diagnostic records, not gameplay readiness or completion events.
test('service-worker requests retain every phase without exhausting the timeline',async()=>{
  const channel=new MessageChannel(),pageEvents=new EventTarget(),page={};
  const received=new Promise(resolve=>{channel.port1.addEventListener('message',()=>{queueMicrotask(()=>{resolve(undefined);});},{once:true});});
  runInNewContext(script('data-boot-timing'),{window:page,navigator:{serviceWorker:channel.port1},
    document:{visibilityState:'visible'},location:{href:'http://localhost/'},performance,
    addEventListener:pageEvents.addEventListener.bind(pageEvents),setInterval,clearInterval});
  const timing=/** @type {import('../src/shared/engine/boot/timing').BootTiming} */(Reflect.get(page,'__bootTiming'));
  const operations=['sw:handler-received','sw:cache-open','sw:cache-miss','sw:network-fetch-to-headers','sw:body-and-cache-publication','sw:response-delivery-decision'];
  const records=Array.from({length:1200},(_,request)=>operations.map((operation,phase)=>({operation,origin:performance.timeOrigin,
    url:`http://localhost/asset-${request}`,client:'fixture',start:request*10+phase,end:request*10+phase+.25,result:'complete'}))).flat();
  try{
    channel.port1.start();channel.port2.postMessage({__engineBootTiming:1,serviceWorker:true,records});await received;
    const requests=timing.entries.filter(row=>row.operation==='sw:request');
    expect(requests).toHaveLength(1200);expect(timing.entries.length).toBeLessThan(1300);
    expect(requests.every(row=>Array.isArray(row.detail['phases'])&&row.detail['phases'].length===6)).toBe(true);
    expect(requests[73]).toMatchObject({start:730,end:735.25,result:'complete'});
    expect(requests[73]?.detail['phases']).toEqual(operations.map((operation,phase)=>({operation,start:730+phase,end:730+phase+.25,result:'complete'})));
    expect(timing.overflow?.['entries']).toBeUndefined();timing.finish();
    expect(timing.entries.at(-1)?.operation).toBe('app:loader-complete');
  }finally{timing.finish();channel.port1.close();channel.port2.close();}
});
