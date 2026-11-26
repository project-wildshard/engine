import markers from '../shared/engine/app/actorMarkers.json' with { type: 'json' };

const { header: AGENT_HEADER, query: AGENT_QUERY, userAgent: AGENT_UA_TOKEN } = markers;

const LANE = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
const name = () => {
  const lane = process.env.WS_LANE_NAME;
  return lane !== undefined && LANE.test(lane) ? lane : '1';
};

/** Keep the device or engine UA before appending the agent marker.
 * @param {string} base */
export function agentUserAgent(base) {
  if (base.split(/\s+/u).includes(AGENT_UA_TOKEN)) return base;
  const lane = name();
  const marker = lane === '1' ? AGENT_UA_TOKEN : `${AGENT_UA_TOKEN} (${lane})`;
  return `${base.trim()} ${marker}`.trim();
}

/** The marker header plus a marked Node UA: the hourly audit reads only the UA, so a bare
 * `fetch(url, {headers: agentHeaders()})` must carry both (METRICS MT16). Browsers never take these.
 * @returns {Readonly<Record<string, string>>} */
export function agentHeaders() {
  return { [AGENT_HEADER]: name(), 'user-agent': agentUserAgent('node') };
}

/** Open a marked URL in a driver that has no UA or header port.
 * @param {string} address */
export function agentUrl(address) {
  const url = new URL(address);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return address;
  if (url.searchParams.get(AGENT_QUERY)) return address;
  url.searchParams.set(AGENT_QUERY, name());
  return url.href;
}
