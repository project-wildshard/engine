/** Proof-only substitute for the Vercel telemetry POST endpoint absent from vite preview.
 * Unexpected methods/payloads continue to the real server and remain class-D errors.
 * @param {string} method @param {unknown} payload */
export function telemetryFixtureAccepts(method, payload) {
  if (method !== 'POST' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const build = Reflect.get(payload, 'build'), install = Reflect.get(payload, 'install'), kind = Reflect.get(payload, 'kind');
  if (typeof build !== 'string' || !build || typeof install !== 'string' || !install) return false;
  if (kind === 'session') {
    const heartbeat = Reflect.get(payload, 'heartbeat');
    return typeof heartbeat === 'object' && heartbeat !== null && !Array.isArray(heartbeat) && typeof Reflect.get(heartbeat, 'session') === 'string' && Reflect.get(heartbeat,'session') !== '' && ['clean','crash','context-loss','likely-oom'].includes(Reflect.get(payload,'end'));
  }
  if (kind !== 'analytics') return false;
  const events = Reflect.get(payload, 'events'), names = new Set(['death.cause','quest.step','weapon.used','shard.time','level.time','boss.attempt']);
  return Array.isArray(events) && events.length <= 50 && events.every((event) => {
    if(typeof event !== 'object' || event === null || Array.isArray(event) || !names.has(Reflect.get(event,'name')))return false;
    const data=Reflect.get(event,'data');
    return typeof data==='object' && data!==null && !Array.isArray(data) && (Reflect.get(event,'name')!=='boss.attempt'||['started','won','died','left'].includes(Reflect.get(data,'outcome')));
  });
}
