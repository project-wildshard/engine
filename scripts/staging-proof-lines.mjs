// What the manual staging proofs (e7-doctor-proof, e7-live-staging-proof, e7-voice-staging-proof) accept from a real page. J205:
// staging only. Every other console line, page error or failed request stays a failure; these are exactly the known ones.

/** The rooms hosts whose `/health` is private (MS7 D7): a page's fetch of it is a 404 with no CORS header. */
const ROOMS_HOSTS = new Set(['rooms-staging.wildshard.io', 'rooms.wildshard.io']);

/** The private health address behind a release's rooms socket, or null when the socket is not a rooms host (the Funnel's
 *  /health answers, so its lines are never excused). @param {string} socket */
export function roomsHealthURL(socket) {
  const url = new URL(socket);
  return ROOMS_HOSTS.has(url.host) ? `https://${url.host}/health` : null;
}

/** One line a page gave: its text, and the address it is about where the browser says (a response, a failed request, a
 *  console message's location). @typedef {{text: string, url?: string | undefined}} PageLine */

const quote = (/** @type {string} */ value) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** Whether a line is the browser reporting the page's fetch of the private rooms `/health` (D7), and nothing else: one of the
 *  shapes Chromium and WebKit give for that one refused fetch, each whole. A shape that names no address counts only where the
 *  browser attributes the line to the exact health address. Another status, another address, or any other words fail.
 *  @param {PageLine} line @param {string | null} healthURL */
export function isRoomsHealthLine(line, healthURL) {
  if (healthURL === null) return false;
  const health = quote(healthURL), host = quote(new URL(healthURL).host), origin = 'https://[a-z0-9.-]+';
  const refused = `Origin ${origin} is not allowed by Access-Control-Allow-Origin\\. Status code: 404`;
  // Chromium's CORS refusal (attributed to the page) and WebKit's "Fetch API cannot load", which Playwright may give from the
  // address's second slash on, name the health address themselves.
  const named = [
    `Access to fetch at '${health}' from origin '${origin}' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource\\.`,
    `(?:Fetch API cannot load https:/)?/${host}/health due to access control checks\\.`,
  ];
  // The 404 response, the failed request and "Failed to load resource" say it of the address they are attributed to.
  const attributed = [
    `HTTP 404 ${health}`,
    `Request failed ${health}: (?:net::ERR_FAILED|${refused})`,
    `Failed to load resource: (?:net::ERR_FAILED|the server responded with a status of 404 \\(\\)|${refused})`,
  ];
  const whole = (/** @type {string} */ shape) => new RegExp(`^${shape}$`, 'u').test(line.text);
  return named.some(whole) || (line.url === healthURL && attributed.some(whole));
}

/** WebKit says one refused fetch as two console lines: `Origin <page> is not allowed by Access-Control-Allow-Origin. Status code:
 *  404`, naming no address, then `Fetch API cannot load <address> due to access control checks.` (Playwright gives the second from its
 *  second slash on). The first is excused only when the same page's next line is that second one, about the rooms health. */
const WEBKIT_CORS = /^Origin https:\/\/[a-z0-9.-]+ is not allowed by Access-Control-Allow-Origin\. Status code: 404$/u;

/** Split page lines into the D7 health lines (listed, excused) and every other line (each one a failure). Lines carrying a `name`
 *  come from that page; a WebKit pair is read within one page.
 *  @template {PageLine & {name?: string}} T @param {readonly T[]} lines @param {string | null} healthURL */
export function splitRoomsHealthLines(lines, healthURL) {
  /** @type {T[]} */ const health = [];
  /** @type {T[]} */ const other = [];
  lines.forEach((line, index) => {
    const next = lines.slice(index + 1).find(later => later.name === line.name);
    const paired = (line.url ?? '') === '' && WEBKIT_CORS.test(line.text) && next !== undefined && next.text.endsWith(' due to access control checks.') && isRoomsHealthLine(next, healthURL);
    (paired || isRoomsHealthLine(line, healthURL) ? health : other).push(line);
  });
  return { health, other };
}

/** MP2.4: a seated player reads as `Name#1234` (a tag of 1000 to 9999); a server before MP2.4 shows the bare Name. The
 *  pattern's source, so a page function can take it as a plain string (`new RegExp(source, 'u')`). @param {string} name */
export function playerNameSource(name) { return `^${quote(name)}(?:#[1-9]\\d{3})?$`; }

/** @param {string} shown @param {string} name */
export function isPlayerName(shown, name) { return new RegExp(playerNameSource(name), 'u').test(shown); }

/** A chat line as everyone reads it: the sender's Name, tagged or not, then the text. @param {string} name @param {string} text */
export function chatLinePattern(name, text) { return new RegExp(`${quote(name)}(?:#[1-9]\\d{3})?: ${quote(text)}`, 'u'); }
