// MMO failure modes (meta docs/plans/MMO-FAILURE-MODES-PLAN.md; Jake, 2026-11-10: "It can't be silently broken. It needs to have a
// modal that's like our connection dropped or reconnected to the MMO, or like phone is offline, can't play"). Prototypes only: every
// screen a player could see when the world's link fails, drawn over the real page, opened from Settings ▸ Developer ▸ Failure screens.
// Nothing here is wired to a real failure (a later plan row does that), and nothing loads unless Developer is on: the entry imports
// this module on the `ws:failscreen` event alone. It wears the error modal's glass (src/client/engine/ui/ErrorModal.ts), the reload
// cover's ring (reloadCover.ts) and the Connection doctor's page (src/client/host/online/doctorView.ts), with its own styles.
import { Scope } from '@wildshard/engine/app/scope';

/** How a screen sits on the page. The plan's five UI styles: a **page** is the whole screen, before or instead of the world; a **card**
 *  is a modal over the dimmed world; a **hold card** is a card with `blocked` set, the sibling a banner opens when the player taps
 *  something that state can't do; a **banner** (`strip`) is the tab at the top while play goes on; a **notice** is a small word that
 *  never blocks, in the top band (`chip`) or by the thing it's about (`tip`, under the chat). `loading` is a line on the existing loading
 *  card. Pages beat cards beat banners beat notices, and a notice waits while a banner is up. */
export type FailKind = 'page' | 'card' | 'strip' | 'chip' | 'loading' | 'tip';
type Tone = 'info' | 'warn' | 'bad' | 'good';
type Icon = 'offline' | 'server' | 'refresh' | 'update' | 'users' | 'tabs' | 'key' | 'save' | 'mic' | 'moon' | 'download' | 'doctor' | 'hand';

interface FailAction { readonly label: string; readonly primary?: true; readonly busy?: string }
/** One screen as the player sees it. `countdown` counts down by itself and `status` holds `{n}` for it. */
interface FailScreen {
  readonly kind: FailKind; readonly tone: Tone; readonly icon?: Icon;
  readonly tag?: string; readonly title: string; readonly body?: string;
  readonly status?: string; readonly spinner?: true; readonly countdown?: number;
  readonly actions?: readonly FailAction[];
  /** What happened, in the words a tester reads: under a collapsed Details on a card, small on a page. */
  readonly detail?: string;
  /** A second paragraph: how to fix it by hand. */
  readonly help?: string;
  /** The chip's meter: signal bars lit, of 4. */
  readonly bars?: number;
  /** A blocked-action card: what the player tapped, echoed at the top so they know it was heard. */
  readonly blocked?: string;
  /** Live progress as short cells (try 3, next dial in {n} s, back in ~20 s). `{n}` is the countdown. */
  readonly facts?: readonly string[];
  /** A clock running out (J114's 30 s hold, the 120 s give-up): a bar that empties, and its label with `{h}` for the seconds left. */
  readonly hold?: { readonly left: number; readonly of: number; readonly label: string };
  /** What happens by itself, so the player knows they needn't do anything. */
  readonly auto?: string;
}
/** One failure in the catalogue: what breaks, and the screen it shows. A blocked-action sibling names its banner or notice in `pair`
 *  and draws over it: the card a player gets on tapping something that state can't do. */
export interface Failure { readonly id: string; readonly group: string; readonly name: string; readonly screen: FailScreen; readonly pair?: string }

const CHECK: FailAction = { label: 'Check connection' }, TITLE: FailAction = { label: 'Title screen' };
const UNREACHABLE_BODY = 'Your internet works, but the world server isn\'t answering. It may be restarting. We\'ll keep trying by ourselves.';
const unreachable = (detail: string, help?: string): FailScreen => ({
  kind: 'card', tone: 'warn', icon: 'server', tag: 'Server', title: 'Can\'t reach the world', body: UNREACHABLE_BODY,
  status: 'Next try in {n} s · try 4', countdown: 8, actions: [{ label: 'Try now', primary: true, busy: 'Trying…' }, CHECK, TITLE], detail, ...help === undefined ? {} : { help },
});
const reconnecting = (status: string): FailScreen => ({ kind: 'strip', tone: 'warn', title: 'Reconnecting', status, spinner: true });
const paused = (status: string, countdown: number): FailScreen => ({
  kind: 'loading', tone: 'warn', title: 'Driftwood Isle', status, countdown, actions: [{ label: 'Retry now', busy: 'Retrying…' }],
});

const WAIT: FailAction = { label: 'Keep waiting' }, TRY_NOW: FailAction = { label: 'Try now', primary: true, busy: 'Dialling…' };
/** The card a player gets on tapping something the dropped link can't do: what they tapped, the dial's progress, J114's hold. */
const linkBlocked = (blocked: string, body: string, facts: readonly string[], countdown: number, held: number, detail: string): FailScreen => ({
  kind: 'card', tone: 'warn', icon: 'hand', tag: 'Reconnecting', title: 'Not connected yet', blocked, body, facts, countdown,
  hold: { left: held, of: 30, label: 'Your character is held for {h} s more' },
  auto: 'This closes by itself when the link is back. Tap again then: we never send a tap late.', actions: [TRY_NOW, WAIT], detail,
});

/** Every failure, in the plan's order. */
export const FAILURES: readonly Failure[] = [
  { id: 'offline-launch', group: 'Device', name: 'Offline at launch', screen: {
    kind: 'page', tone: 'warn', icon: 'offline', tag: 'No internet', title: 'You\'re offline',
    body: 'Project Wildshard needs the internet to reach the world. Turn on Wi-Fi or mobile data, and we\'ll connect as soon as you\'re back.',
    status: 'Waiting for a network', spinner: true, actions: [{ label: 'Try again', primary: true, busy: 'Trying…' }, CHECK],
    detail: 'navigator.onLine false · release file not fetched' } },
  { id: 'offline-play', group: 'Device', name: 'Offline mid-play', screen: {
    kind: 'card', tone: 'warn', icon: 'offline', tag: 'Connection dropped', title: 'You\'re offline',
    body: 'Your phone lost its internet. The world holds your character for 30 seconds, and your progress is saved on the server.',
    status: 'Reconnecting by itself when the network is back', spinner: true, actions: [CHECK, TITLE],
    detail: '"offline" event · last frame 3 s ago · dialling waits for "online"' } },
  { id: 'background-short', group: 'Device', name: 'Back from the background (under 30 s)', screen: reconnecting('Welcome back') },
  { id: 'background-short-blocked', group: 'Device', pair: 'background-short', name: '↳ Tapped while back from the background', screen: {
    kind: 'card', tone: 'info', icon: 'moon', tag: 'Welcome back', title: 'One moment', blocked: 'Interact',
    body: 'Your phone paused the game while it was away, so the link went quiet. We\'re reconnecting now: it usually takes a second or two.',
    facts: ['Try 1', 'Back in ~{n} s'], countdown: 2, auto: 'This closes by itself when you\'re back in. Nothing was lost.', actions: [WAIT],
    detail: 'hidden 12 s · Redial.check() on visible · dial 1 open' } },
  { id: 'background-long', group: 'Device', name: 'Back from the background (over 30 s)', screen: {
    kind: 'card', tone: 'info', icon: 'moon', tag: 'Away', title: 'Welcome back',
    body: 'You were away for 4 minutes, so the world let your character go. You\'ll rejoin at your last save point.',
    status: 'Rejoining', spinner: true, actions: [TITLE], detail: 'hidden 4 min · J114 hold 30 s passed · resume, not the same body' } },

  { id: 'unreachable', group: 'Server', name: 'Server unreachable, Funnel down', screen: unreachable('socket closed 1006 before open, 4 dials · /health: no answer') },
  { id: 'dns', group: 'Server', name: 'DNS failure', screen: unreachable('rooms address not found (the doctor\'s health check: TypeError, no status)') },
  { id: 'tls', group: 'Server', name: 'TLS failure', screen: unreachable('secure connection failed before any status',
    'If this keeps happening, check that your phone\'s date and time are set automatically.') },
  { id: 'upgrade-refused', group: 'Server', name: 'Socket upgrade refused (502 / 503)', screen: unreachable('the gateway answered 502 instead of opening the link: the server process is down') },
  { id: 'restart', group: 'Server', name: 'Server restart mid-session', screen: { kind: 'strip', tone: 'info', title: 'Restarting', status: 'the world is back in a moment', spinner: true } },
  { id: 'restart-blocked', group: 'Server', pair: 'restart', name: '↳ Pressed Play while restarting', screen: {
    kind: 'card', tone: 'info', icon: 'refresh', tag: 'Restarting', title: 'The world is restarting', blocked: 'Play',
    body: 'Play needs the world, and it\'s restarting right now. It\'s usually back within 30 seconds.',
    facts: ['Try 4', 'Next dial in {n} s', 'Back in ~20 s'], countdown: 3,
    auto: 'Play goes ahead by itself as soon as the world is back: wait here, or cancel and look around the title.',
    actions: [{ label: 'Keep waiting', primary: true }, { label: 'Cancel' }], detail: 'close "restart" (4005) · 4 dials · /health 503' } },
  { id: 'deploy', group: 'Server', name: 'Deploy mid-session (J174 countdown)', screen: {
    kind: 'strip', tone: 'info', title: 'World update', status: 'in {n} s · your progress is saved', countdown: 42 } },
  { id: 'deploy-blocked', group: 'Server', pair: 'deploy', name: '↳ Pressed Enter world as the update starts', screen: {
    kind: 'card', tone: 'info', icon: 'update', tag: 'World update', title: 'An update is about to start', blocked: 'Enter world',
    body: 'Going in now would give you a few seconds before the update moves everyone. Your progress is saved either way.',
    facts: ['Update in {n} s', 'Back ~40 s after'], countdown: 8,
    auto: 'Enter world goes ahead by itself once the new version is up. The new files are already downloading.',
    actions: [{ label: 'Enter after the update', primary: true, busy: 'Waiting…' }, { label: 'Enter now anyway' }], detail: 'countdown control word: 8 s · preload started' } },
  { id: 'release-5xx', group: 'Server', name: 'Release file 500 / 502 / 503', screen: {
    kind: 'page', tone: 'warn', icon: 'server', tag: 'World directory', title: 'Can\'t find the world',
    body: 'The file that says where the world lives isn\'t answering (503). Nothing is wrong with your phone.',
    status: 'Trying again in {n} s', countdown: 8, actions: [{ label: 'Try now', primary: true, busy: 'Trying…' }, CHECK],
    detail: 'GET release.json → 503 · try 3 of ∞ · waits 2, 4, 8, 16, 30 s' } },
  { id: 'release-429', group: 'Server', name: 'Release file 429', screen: {
    kind: 'page', tone: 'info', icon: 'users', tag: 'Busy', title: 'Lots of players joining',
    body: 'Everyone is arriving at once. Hang on: we\'ll try again by ourselves, you don\'t need to do anything.',
    status: 'Trying again in {n} s', countdown: 20, actions: [{ label: 'Try now', primary: true, busy: 'Trying…' }],
    detail: 'GET release.json → 429 · Retry-After 20' } },
  { id: 'release-404', group: 'Server', name: 'Release file 404: the channel isn\'t open', screen: {
    kind: 'page', tone: 'info', icon: 'moon', tag: 'Not open yet', title: 'The world isn\'t open yet',
    body: 'There\'s no world on this address yet. Check back soon: we\'ll look again every minute by ourselves.',
    status: 'Looking again in {n} s', countdown: 60, actions: [{ label: 'Try now', primary: true, busy: 'Trying…' }, CHECK],
    detail: 'GET release.json → 404 · channel staging · every 60 s' } },
  { id: 'captive-portal', group: 'Server', name: 'Captive portal (hotel or airport wifi)', screen: {
    kind: 'page', tone: 'warn', icon: 'key', tag: 'Wi-Fi sign-in', title: 'This network wants you to sign in',
    body: 'The Wi-Fi you\'re on shows its own page before it lets you online. Open it, sign in or accept, and come back here.',
    status: 'Trying again when you\'re back', spinner: true, actions: [{ label: 'Open the sign-in page', primary: true, busy: 'Opening…' }, { label: 'Try again', busy: 'Trying…' }],
    detail: 'GET release.json → 200 text/html, not the signed file (a portal)' } },
  { id: 'release-unsigned', group: 'Server', name: 'Release file fails its signature', screen: {
    kind: 'page', tone: 'bad', icon: 'key', tag: 'Can\'t verify', title: 'Couldn\'t check the world',
    body: 'The file that says where the world lives didn\'t carry our signature. We won\'t connect to a world we can\'t verify.',
    actions: [{ label: 'Try again', primary: true, busy: 'Trying…' }, CHECK, { label: 'Copy details', busy: 'Copied' }],
    help: 'On public Wi-Fi? A network that changes pages can cause this. Try mobile data.', detail: 'release.json: bad signature · reported' } },
  { id: 'version-http', group: 'Server', name: 'version.json fails (Developer only)', screen: {
    kind: 'chip', tone: 'warn', title: 'Update check failed', status: '503 · next in 5 min', detail: 'Developer only: players see nothing, play is not affected' } },
  { id: 'doctor-http', group: 'Server', name: 'Connection doctor page fails', screen: {
    kind: 'card', tone: 'warn', icon: 'doctor', tag: 'Connection doctor', title: 'The check didn\'t open',
    body: 'The connection check page didn\'t load (502). The game is still running: go back, and try the check again in a minute.',
    actions: [{ label: 'Back to the game', primary: true }, { label: 'Copy details', busy: 'Copied' }], detail: 'GET /doctor/?sw=0 → 502 (checked before leaving the page)' } },

  { id: 'drop', group: 'Link', name: 'Socket dropped mid-play', screen: reconnecting('try 2') },
  { id: 'drop-blocked', group: 'Link', pair: 'drop', name: '↳ Tapped Talk while reconnecting', screen: linkBlocked('Talk',
    'Talking needs the world, and the link dropped 3 s ago. We\'re dialling again by ourselves.', ['Try 2', 'Next dial in {n} s'], 2, 27,
    'close 1006 · last frame 3.1 s ago · dial 2 of ∞ · hold ends at 30 s') },
  { id: 'reset', group: 'Link', name: 'Connection reset (ECONNRESET)', screen: reconnecting('try 1') },
  { id: 'reset-blocked', group: 'Link', pair: 'reset', name: '↳ Pressed Send while reconnecting', screen: {
    ...linkBlocked('Send', 'The link was cut a moment ago. Your message is kept, marked unsent, and nothing you typed is lost.', ['Try 1', 'Next dial in {n} s'], 1, 29,
      'close 1006 (reset) · 1 chat line held · sends in order on the first frame back'),
    title: 'Your message will send when you\'re back', auto: 'It sends itself as soon as the link is back. Chat is the one thing we hold; game taps are never sent late.',
    actions: [{ label: 'Keep waiting', primary: true }, { label: 'Don\'t send it' }] } },
  { id: 'half-open', group: 'Link', name: 'Half-open socket, no frames', screen: reconnecting('no word from the world for 3 s') },
  { id: 'half-open-blocked', group: 'Link', pair: 'half-open', name: '↳ Tapped Pick up on a silent link', screen: linkBlocked('Pick up',
    'Picking up needs the world, and it hasn\'t answered for 3 s. We closed the silent link and are dialling a new one.', ['Try 1', 'Next dial in {n} s'], 1, 26,
    'no frame for 3 s · closed "stalled" (4004) · dial 1') },
  { id: 'reconnected', group: 'Link', name: 'Back after a drop', screen: { kind: 'chip', tone: 'good', title: 'Reconnected', status: 'you\'re back where you were' } },
  { id: 'resuming', group: 'Link', name: 'Still down after 35 s', screen: {
    kind: 'strip', tone: 'warn', title: 'Still reconnecting', status: 'you\'ll rejoin at your last save', spinner: true } },
  { id: 'resuming-blocked', group: 'Link', pair: 'resuming', name: '↳ Tapped Talk after 35 s down', screen: {
    kind: 'card', tone: 'warn', icon: 'server', tag: 'Still reconnecting', title: 'Still reconnecting', blocked: 'Talk',
    body: 'The link has been down for 41 s, so the world let your character go. You\'ll rejoin at your last save (14:02).',
    facts: ['Try 9', 'Next dial in {n} s'], countdown: 4, hold: { left: 79, of: 120, label: 'We keep trying for {h} s more' },
    auto: 'You\'re put back by yourself the moment the world answers.', actions: [TRY_NOW, TITLE], detail: '9 dials · last frame 41 s ago · J114 hold passed' } },
  { id: 'lost', group: 'Link', name: 'Gave up after 2 minutes', screen: {
    kind: 'card', tone: 'bad', icon: 'server', tag: 'Connection lost', title: 'Couldn\'t reconnect',
    body: 'We tried for 2 minutes. Everything up to 14:02 is saved on the server, so nothing is lost.',
    actions: [{ label: 'Try again', primary: true, busy: 'Reconnecting…' }, CHECK, TITLE], detail: '38 dials · last frame 14:02:11 · last close 1006' } },
  { id: 'slow', group: 'Link', name: 'High latency', screen: { kind: 'chip', tone: 'warn', title: 'Slow connection', status: '480 ms', bars: 1 } },
  { id: 'lossy', group: 'Link', name: 'Packet loss and jitter', screen: { kind: 'chip', tone: 'warn', title: 'Unstable connection', status: 'others may jump', bars: 2 } },
  { id: 'staging', group: 'Link', name: 'Wrong environment: staging', screen: {
    kind: 'chip', tone: 'info', title: 'Staging', status: 'not the live world' } },

  { id: 'version-skew', group: 'Build', name: 'Page and server builds differ', screen: {
    kind: 'page', tone: 'info', icon: 'refresh', tag: 'Update', title: 'A new version is out',
    body: 'The world moved to a new version. Reload to keep playing: you\'ll be back where you were.',
    actions: [{ label: 'Reload', primary: true, busy: 'Reloading' }], detail: 'this page a1b2c3d · the world f9e8d7c · close "reload"' } },
  { id: 'too-old', group: 'Build', name: 'Client too old, force update (J219)', screen: {
    kind: 'page', tone: 'bad', icon: 'update', tag: 'Update required', title: 'Your game is too old',
    body: 'This copy of Project Wildshard is more than 5 versions behind, so it can\'t join the world. Update to keep playing. Your progress is safe on the server.',
    actions: [{ label: 'Update now', primary: true, busy: 'Updating' }],
    help: 'Still seeing this after updating? If you added the game to your home screen, close it fully from the app switcher and open it again.',
    detail: 'your version a1b2c3d · the world f9e8d7c · 7 versions behind, 5 are kept (J219)' } },

  { id: 'full', group: 'World', name: 'World is full (J178, J213)', screen: {
    kind: 'card', tone: 'warn', icon: 'users', tag: 'World is full', title: 'The world is full',
    body: 'All 32 places are taken. We\'ll ask every 30 seconds and let you in as soon as someone leaves.',
    status: 'Next try in {n} s', countdown: 24, actions: [CHECK, TITLE], detail: 'close "full" (4002) · 3 tries so far' } },
  { id: 'replaced', group: 'World', name: 'Open in another tab', screen: {
    kind: 'card', tone: 'info', icon: 'tabs', tag: 'Another tab', title: 'Playing somewhere else',
    body: 'This world is open in another tab or on another device. Only one can play at a time.',
    actions: [{ label: 'Play here', primary: true, busy: 'Joining…' }, TITLE], detail: 'close "replaced" (4003)' } },
  { id: 'refused', group: 'World', name: 'The server sends this player away', screen: {
    kind: 'card', tone: 'bad', icon: 'server', tag: 'Turned away', title: 'The world turned this connection away',
    body: 'The server ended this link and won\'t take it back by itself. Your progress up to 14:02 is saved.',
    actions: [{ label: 'Play again', primary: true, busy: 'Joining…' }, { label: 'Copy details', busy: 'Copied' }, TITLE], detail: 'close "refused" (4001) · reason: hello name rejected' } },
  { id: 'banned', group: 'World', name: 'Kicked or banned by a moderator', screen: {
    kind: 'card', tone: 'bad', icon: 'users', tag: 'Removed', title: 'You were removed from the world',
    body: 'A moderator took you out of the world until 14:02 tomorrow. You can still look around the title and your settings.',
    actions: [TITLE, { label: 'Copy details', busy: 'Copied' }], detail: 'close "banned" · until 2026-11-11 14:02 · ref 7f3a' } },

  { id: 'auth-expired', group: 'Account', name: 'Sign-in expired', screen: {
    kind: 'card', tone: 'info', icon: 'key', tag: 'Signed out', title: 'Please sign in again',
    body: 'Your sign-in ran out. Sign in to rejoin: your character and progress are safe.',
    actions: [{ label: 'Sign in', primary: true, busy: 'Opening…' }, TITLE], detail: 'door refused the session: expired' } },
  { id: 'auth-failed', group: 'Account', name: 'Sign-in failed at the provider', screen: {
    kind: 'card', tone: 'warn', icon: 'key', tag: 'Sign-in', title: 'Sign-in didn\'t work',
    body: 'Google didn\'t sign you in. Try again, or choose another way to sign in.',
    actions: [{ label: 'Try again', primary: true, busy: 'Opening…' }, { label: 'Other ways to sign in' }, { label: 'Play as a guest' }], detail: 'provider error: access_denied' } },
  { id: 'api-5xx', group: 'Account', name: 'Account API 500 / 502 / 503', screen: {
    kind: 'card', tone: 'warn', icon: 'server', tag: 'Accounts', title: 'Accounts are down',
    body: 'Our account service isn\'t answering (502), so sign-in can\'t finish. You can play as a guest meanwhile.',
    status: 'Trying again in {n} s', countdown: 15, actions: [{ label: 'Try now', primary: true, busy: 'Trying…' }, { label: 'Play as a guest' }],
    detail: 'POST api /auth → 502 · names, reports and telemetry wait in their queues' } },

  { id: 'save-slow', group: 'Saves', name: 'A save is late', screen: { kind: 'chip', tone: 'warn', title: 'Saving', status: 'retrying' } },
  { id: 'save-slow-blocked', group: 'Saves', pair: 'save-slow', name: '↳ Pressed Leave while a save is late', screen: {
    kind: 'card', tone: 'warn', icon: 'save', tag: 'Saving', title: 'Saving your last moves', blocked: 'Leave the world',
    body: 'The server is late saving your last 20 seconds. Leave now and you could lose them; wait a moment and nothing is lost.',
    facts: ['Save try 2', 'Next in {n} s'], countdown: 3, auto: 'With Leave when saved, you leave by yourself as soon as the save lands.',
    actions: [{ label: 'Leave when saved', primary: true, busy: 'Waiting for the save…' }, { label: 'Leave now' }, { label: 'Keep playing' }],
    detail: 'save ack late 6 s · last saved 14:02:11' } },
  { id: 'save-failed', group: 'Saves', name: 'Saves fail to persist', screen: {
    kind: 'card', tone: 'bad', icon: 'save', tag: 'Saves', title: 'Progress isn\'t saving',
    body: 'The server can\'t save right now. You can keep playing, but anything after 14:02 may be lost if you leave.',
    status: 'Retrying every 10 s', spinner: true, actions: [{ label: 'Keep playing', primary: true }, { label: 'Leave the world' }],
    detail: 'server: saves_production write failed 6 times since 14:02' } },

  { id: 'voice-failed', group: 'Voice', name: 'Voice relay (TURN) failed', screen: {
    kind: 'tip', tone: 'bad', icon: 'mic', title: 'Voice couldn\'t connect on this network.', status: 'Text chat still works.', actions: [{ label: 'Try again', busy: 'Trying…' }] } },
  { id: 'voice-failed-blocked', group: 'Voice', pair: 'voice-failed', name: '↳ Tapped the mic after voice failed', screen: {
    kind: 'card', tone: 'warn', icon: 'mic', tag: 'Voice', title: 'Voice can\'t connect here', blocked: 'Talk (voice)',
    body: 'This network blocks the relay that voice needs. It isn\'t your microphone. Text chat still works.',
    facts: ['3 relays tried', 'Next try in {n} s'], countdown: 20, auto: 'We try again by ourselves, and at once when you change network.',
    actions: [{ label: 'Try again', primary: true, busy: 'Trying…' }, { label: 'Use text chat' }], detail: 'voice state failed · ICE: no relay candidate' } },

  { id: 'packs-5xx', group: 'Downloads', name: 'Packs 500 / 502 / 503', screen: paused('Download paused · server error (503) · retrying in {n} s', 4) },
  { id: 'packs-429', group: 'Downloads', name: 'Packs 429', screen: paused('Download paused · server busy · retrying in {n} s', 15) },
  { id: 'book-5xx', group: 'Downloads', name: 'Signed book fails', screen: paused('The world\'s book didn\'t arrive (500) · retrying in {n} s', 2) },
  { id: 'storage-full', group: 'Downloads', name: 'Storage full', screen: {
    ...paused('Storage is full · the world will load more slowly · free space in Settings ▸ Downloads', 0), status: 'Storage is full · the world will load more slowly. Free space in Settings ▸ Downloads.',
    actions: [{ label: 'Keep going' }] } },
  { id: 'download-failed', group: 'Downloads', name: 'Downloads give up', screen: {
    kind: 'page', tone: 'bad', icon: 'download', tag: 'Download failed', title: 'The world didn\'t download',
    body: 'We tried 5 times and the files didn\'t arrive (503). What\'s already downloaded is kept, so the next try is quicker.',
    actions: [{ label: 'Try again', primary: true, busy: 'Reloading' }, CHECK, { label: 'Copy diagnostics', busy: 'Copied' }],
    detail: 'packs/driftwood-isle/terrain.pack → 503 × 5 · 61% downloaded' } },
];

const ICONS: Readonly<Record<Icon, string>> = {
  offline: '<path d="M2 8.5a15 15 0 0 1 5-3M10.5 4.6A15 15 0 0 1 22 8.5M5 12a10 10 0 0 1 4-2.3M15 10a10 10 0 0 1 4 2M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/><path d="M3 3l18 18"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  update: '<circle cx="12" cy="12" r="9"/><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>',
  tabs: '<rect x="3" y="6" width="14" height="13" rx="1"/><path d="M7 6V4h14v13h-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  doctor: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.3 15.6a1.6 1.6 0 0 1 2.4-2.1L8 15.5"/>',
};

const CSS = `
.ws-fail{--c:#8fe3ff;--a:#ffb547;--r:#ff7a6c;--g:#7ef0b0;--t:var(--a);box-sizing:border-box;color:#e6f2f8;font:12px/1.5 'JetBrains Mono','SF Mono',Menlo,monospace;-webkit-user-select:none;user-select:none}
.ws-fail *{box-sizing:border-box}
.ws-fail[data-tone=info]{--t:var(--c)}.ws-fail[data-tone=bad]{--t:var(--r)}.ws-fail[data-tone=good]{--t:var(--g)}
.ws-fail button{appearance:none;-webkit-appearance:none;width:100%;min-height:48px;padding:13px 16px;cursor:pointer;font:700 12px/1 'JetBrains Mono',Menlo,monospace;letter-spacing:.22em;text-transform:uppercase;border:1px solid rgba(143,227,255,.35);background:rgba(143,227,255,.06);color:var(--c);touch-action:manipulation;display:flex;align-items:center;justify-content:center;gap:8px}
.ws-fail button.go{border-color:var(--c);background:rgba(143,227,255,.18);color:#fff;box-shadow:0 0 18px rgba(143,227,255,.18)}
.ws-fail button:active{background:rgba(143,227,255,.26)}.ws-fail button:disabled{opacity:.6}
.ws-fail button:focus{outline:none}.ws-fail button:focus-visible{outline:1px solid var(--c);outline-offset:3px}
.ws-fail .ring{flex:none;display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:ws-fail-spin .8s linear infinite}
@keyframes ws-fail-spin{to{transform:rotate(360deg)}}
.ws-fail-scrim{position:fixed;inset:0;z-index:2147482400;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:rgba(4,9,14,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.ws-fail-page{position:fixed;inset:0;z-index:2147482600;display:flex;flex-direction:column;overflow-y:auto;background:radial-gradient(ellipse at 50% 30%,#0d1a26 0%,#06090f 60%,#030508 100%)}
.ws-fail-page::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,rgba(143,227,255,.025) 0 1px,transparent 1px 3px);pointer-events:none}
.ws-fail-word{padding:calc(28px + env(safe-area-inset-top,0px)) 20px 0;font:700 30px/1 Rajdhani,'Bahnschrift','DIN Alternate',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff}
.ws-fail-word b{color:var(--c)}
.ws-fail-mid{flex:1;display:flex;align-items:center;justify-content:center;padding:20px 16px}
.ws-fail-box{position:relative;width:min(440px,100%);max-height:100%;overflow:auto;padding:22px 18px 16px;background:rgba(13,27,38,.82);border:1px solid rgba(143,227,255,.35);box-shadow:0 24px 80px rgba(0,0,0,.55);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.ws-fail-page .ws-fail-box{background:rgba(6,10,18,.55)}
.ws-fail-box>i{position:absolute;width:12px;height:12px;border:0 solid var(--c);pointer-events:none}
.ws-fail-box>i.tl{top:-1px;left:-1px;border-top-width:2px;border-left-width:2px}.ws-fail-box>i.tr{top:-1px;right:-1px;border-top-width:2px;border-right-width:2px}
.ws-fail-box>i.bl{bottom:-1px;left:-1px;border-bottom-width:2px;border-left-width:2px}.ws-fail-box>i.br{bottom:-1px;right:-1px;border-bottom-width:2px;border-right-width:2px}
.ws-fail-icon{width:44px;height:44px;margin:0 0 14px;padding:9px;border:1px solid var(--t);color:var(--t);box-shadow:0 0 18px color-mix(in srgb,var(--t) 30%,transparent)}
.ws-fail-icon svg,.ws-fail-tip svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ws-fail-tag{margin:0 0 10px;font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:var(--c)}
.ws-fail-tag::before{content:'';display:inline-block;width:6px;height:6px;margin:0 10px 1px 0;background:var(--t);box-shadow:0 0 8px var(--t);vertical-align:middle}
.ws-fail h1{margin:0 0 10px;font:700 24px/1.1 Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#fff}
.ws-fail-body{margin:0 0 14px;font-size:13px;line-height:1.55;color:rgba(230,242,248,.86)}
.ws-fail-help{margin:-4px 0 14px;padding:8px 10px;border-left:2px solid var(--t);background:rgba(6,10,18,.6);font-size:11.5px;line-height:1.5;color:rgba(230,242,248,.8)}
.ws-fail-status{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--t)}
.ws-fail-rule{height:1px;margin:0 0 14px;background:rgba(143,227,255,.18)}
.ws-fail-col{display:flex;flex-direction:column;gap:8px}
.ws-fail details{margin-top:12px;padding-top:10px;border-top:1px solid rgba(143,227,255,.14)}
.ws-fail summary{cursor:pointer;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(143,227,255,.7);list-style:none}
.ws-fail summary::-webkit-details-marker{display:none}.ws-fail summary::before{content:'+ '}.ws-fail details[open] summary::before{content:'− '}
.ws-fail-detail{margin:8px 0 0;font-size:10.5px;color:rgba(230,242,248,.55);overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.ws-fail-page .ws-fail-detail{margin-top:14px;text-align:center}
.ws-fail-strip{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147482500;width:max-content;max-width:min(560px,calc(100% - 250px));display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 10px;padding:calc(7px + env(safe-area-inset-top,0px)) 16px 8px;background:linear-gradient(rgba(9,18,28,.95),rgba(9,18,28,.88));border:1px solid color-mix(in srgb,var(--t) 40%,transparent);border-top:0;border-bottom:2px solid var(--t);clip-path:polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0 calc(100% - 8px));box-shadow:0 6px 24px rgba(0,0,0,.4);text-align:center;pointer-events:none}
.ws-fail-strip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,transparent,#fff,transparent);opacity:.3;animation:ws-fail-sweep 1.6s ease-in-out infinite}
@keyframes ws-fail-sweep{0%,100%{opacity:.3}50%{opacity:1}}
.ws-fail-strip b{display:flex;align-items:center;gap:8px;font:700 14px/1.1 Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#fff}
.ws-fail-strip>span{font-size:11px;letter-spacing:.04em;color:rgba(230,242,248,.78);font-variant-numeric:tabular-nums}
.ws-fail-strip .ring{color:var(--t)}
.ws-fail-chip{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top,0px));z-index:2147482300;transform:translateX(-50%);display:flex;align-items:center;gap:9px;padding:7px 12px;background:rgba(13,27,38,.86);border:1px solid color-mix(in srgb,var(--t) 55%,transparent);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;max-width:min(460px,calc(100% - 250px));flex-wrap:wrap;justify-content:center;pointer-events:none;animation:ws-fail-in .25s ease-out}
.ws-fail-chip::before{content:'';width:6px;height:6px;background:var(--t);box-shadow:0 0 8px var(--t)}
.ws-fail[data-tone=good].ws-fail-chip::before{content:'✓';width:auto;height:auto;background:none;box-shadow:none;color:var(--g);font-weight:700;letter-spacing:0}
.ws-fail-chip b{color:#fff;font-weight:700}.ws-fail-chip span{color:var(--t);letter-spacing:.08em;text-transform:none}
.ws-fail-chip.dev{top:auto;bottom:calc(64px + env(safe-area-inset-bottom,0px))}
.ws-fail-bars{display:flex;align-items:flex-end;gap:2px;height:12px}.ws-fail-bars i{width:3px;background:rgba(230,242,248,.22)}.ws-fail-bars i.on{background:var(--t)}
@keyframes ws-fail-in{from{opacity:0;transform:translate(-50%,-6px)}}
.ws-fail-load{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom,0px));z-index:2147482300;transform:translateX(-50%);width:min(420px,calc(100% - 32px));padding:16px 14px 14px;background:rgba(6,10,18,.94);border:1px solid rgba(143,227,255,.35);box-shadow:0 10px 40px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.ws-fail-load::before{content:'';position:absolute;left:-1px;top:-1px;width:18px;height:18px;border-left:1px solid var(--c);border-top:1px solid var(--c)}
.ws-fail-load h1{font-size:16px;letter-spacing:.14em;margin:0 0 10px;display:flex;justify-content:space-between}
.ws-fail-load h1 small{font:400 12px 'JetBrains Mono',Menlo,monospace;color:var(--c);letter-spacing:.06em}
.ws-fail-meter{height:4px;margin:0 0 10px;background:rgba(143,227,255,.12)}.ws-fail-meter i{display:block;height:100%;width:61%;background:var(--a);box-shadow:0 0 12px rgba(255,181,71,.5)}
.ws-fail-load .ws-fail-status{margin:0 0 12px;letter-spacing:.04em;text-transform:none;font-size:11.5px}
.ws-fail-load button{min-height:44px}
.ws-fail-tip{position:fixed;left:max(12px,env(safe-area-inset-left));top:calc(136px + env(safe-area-inset-top,0px));z-index:2147482300;display:flex;gap:10px;align-items:center;max-width:min(380px,calc(100% - 24px));padding:7px 7px 7px 12px;background:rgba(13,27,38,.92);box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid color-mix(in srgb,var(--t) 55%,transparent);border-left:3px solid var(--t);font-size:11px;line-height:1.4;animation:ws-fail-rise .25s ease-out}
.ws-fail-tip svg{flex:none;width:18px;height:18px;color:var(--t)}
.ws-fail-tip p{margin:0;color:#fff;font-weight:700;letter-spacing:.04em}.ws-fail-tip p span{display:block;color:rgba(230,242,248,.7);font-weight:400}
.ws-fail-tip button{width:auto;min-height:36px;padding:8px 10px;font-size:10px;letter-spacing:.16em;white-space:nowrap}
.ws-fail-proto{position:fixed;right:max(8px,env(safe-area-inset-right));bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;align-items:center;gap:4px;padding:3px 3px 3px 8px;background:rgba(40,10,40,.9);border:1px dashed #e48bff;color:#f3c8ff;font:600 9.5px/1 'JetBrains Mono',Menlo,monospace;letter-spacing:.14em;text-transform:uppercase}
.ws-fail-proto button{width:26px;min-height:24px;padding:0;border-color:rgba(228,139,255,.5);background:none;color:#f3c8ff;font-size:12px;letter-spacing:0}
.ws-fail-list{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto}
.ws-fail-list h2{margin:14px 0 6px;font:700 12px Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.24em;text-transform:uppercase;color:var(--c)}
.ws-fail-list button{justify-content:space-between;min-height:40px;padding:10px 12px;font-weight:400;letter-spacing:.04em;text-transform:none;color:#e6f2f8;text-align:left}
.ws-fail-list button small{color:rgba(143,227,255,.6);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.ws-fail-want{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:7px 10px;border:1px dashed color-mix(in srgb,var(--t) 60%,transparent);background:color-mix(in srgb,var(--t) 8%,transparent);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(230,242,248,.75)}
.ws-fail-want b{color:#fff;font-weight:700}.ws-fail-want i{margin-left:auto;font-style:normal;color:var(--t)}
.ws-fail-facts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;list-style:none}
.ws-fail-facts li{padding:5px 8px;border:1px solid color-mix(in srgb,var(--t) 45%,transparent);font-size:11px;letter-spacing:.08em;color:var(--t);font-variant-numeric:tabular-nums}
.ws-fail-facts li:first-child{display:flex;align-items:center;gap:7px}
.ws-fail-hold{margin:0 0 12px}.ws-fail-hold p{margin:0 0 5px;font-size:11px;color:rgba(230,242,248,.75);font-variant-numeric:tabular-nums}
.ws-fail-hold div{height:3px;background:rgba(143,227,255,.12)}.ws-fail-hold div i{display:block;height:100%;background:var(--t);box-shadow:0 0 10px var(--t);transition:width 1s linear}
.ws-fail-auto{margin:0 0 14px;padding:8px 10px;border-left:2px solid var(--g);background:rgba(126,240,176,.06);font-size:11.5px;line-height:1.5;color:rgba(230,242,248,.85)}
.ws-fail-auto::before{content:'By itself  ';color:var(--g);font-size:9.5px;letter-spacing:.24em;text-transform:uppercase}
.ws-fail-scrim{animation:ws-fail-fade .16s ease-out}.ws-fail-scrim>.ws-fail-box{animation:ws-fail-rise .2s ease-out}
.ws-fail-page{animation:ws-fail-fade .2s ease-out}
@keyframes ws-fail-tab{from{transform:translate(-50%,-100%)}}.ws-fail-strip{animation:ws-fail-tab .18s ease-out}
@keyframes ws-fail-fade{from{opacity:0}}@keyframes ws-fail-rise{from{opacity:0;transform:translateY(8px)}}@keyframes ws-fail-drop{from{transform:translateY(-100%)}}
.ws-fail-list button.sib{min-height:34px;margin-left:18px;width:calc(100% - 18px);border-style:dashed;color:rgba(230,242,248,.8)}
@media (min-width:700px){.ws-fail-strip{max-width:min(620px,calc(100% - 440px))}.ws-fail-chip{max-width:min(520px,calc(100% - 440px))}.ws-fail-word{padding:34px 44px 0;font-size:44px}.ws-fail-box{padding:28px 26px 20px}.ws-fail h1{font-size:28px}}
@media (prefers-reduced-motion:reduce){.ws-fail,.ws-fail *,.ws-fail .ring,.ws-fail-strip::after{animation:none!important;transition:none!important}}
`;

const STYLE_ID = 'ws-fail-style';
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};
const svg = (icon: Icon): Element => {
  const holder = make('span');
  holder.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
  return holder.firstElementChild ?? holder;
};
const ring = (): HTMLElement => { const node = make('span', 'ring'); node.setAttribute('aria-hidden', 'true'); return node; };

/** Text with `{n}` in it, counted down by the screen's countdown; at zero it starts over, the way a retry would. */
function counted(scope: Scope, screen: FailScreen, node: HTMLElement, text: string): void {
  const from = screen.countdown;
  if (from === undefined || !text.includes('{n}')) { node.textContent = text; return; }
  let left = from;
  const paint = (): void => { node.textContent = text.replace('{n}', String(left)); };
  paint();
  scope.interval(1000, () => { left = left <= 1 ? from : left - 1; paint(); });
}
/** A screen's status line, its ring and its words. */
function statusLine(scope: Scope, screen: FailScreen, node: HTMLElement, spinner = screen.spinner === true): void {
  if (spinner) node.append(ring());
  const words = make('span');
  node.append(words);
  counted(scope, screen, words, screen.status ?? '');
}
/** A blocked-action card's live part: what was tapped, the progress cells, the clock running out and what happens by itself. */
function progress(scope: Scope, screen: FailScreen, box: HTMLElement): void {
  if (screen.facts !== undefined) {
    const list = make('ul', 'ws-fail-facts');
    list.setAttribute('role', 'status');
    for (const [index, fact] of screen.facts.entries()) {
      const cell = make('li'), words = make('span');
      if (index === 0) cell.append(ring());
      cell.append(words); counted(scope, screen, words, fact); list.append(cell);
    }
    box.append(list);
  }
  const hold = screen.hold;
  if (hold !== undefined) {
    const holder = make('div', 'ws-fail-hold'), label = make('p'), track = make('div'), fill = make('i');
    track.append(fill); holder.append(label, track); box.append(holder);
    let left = hold.left;
    const paint = (): void => { label.textContent = hold.label.replace('{h}', String(left)); fill.style.width = `${String(Math.round(left / hold.of * 100))}%`; };
    paint();
    // the clock drains to empty and stops there, as the real hold does
    scope.interval(1000, () => { if (left === 0) return; left--; paint(); });
  }
  if (screen.auto !== undefined) box.append(make('p', 'ws-fail-auto', screen.auto));
}
/** Buttons do what a prototype can: the tapped one turns busy, which is what its real handler will show first (RL3). */
function buttons(scope: Scope, actions: readonly FailAction[]): HTMLElement {
  const column = make('div', 'ws-fail-col');
  for (const action of actions) {
    const button = make('button', action.primary === true ? 'go' : '', action.label);
    button.type = 'button';
    scope.listen(button, 'click', () => {
      if (action.busy === undefined) return;
      button.disabled = true; button.setAttribute('aria-busy', 'true'); button.replaceChildren(ring(), make('span', '', action.busy));
      scope.timeout(2500, () => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = action.label; });
    });
    column.append(button);
  }
  return column;
}
function boxed(scope: Scope, screen: FailScreen): HTMLElement {
  const box = make('div', 'ws-fail-box');
  for (const corner of ['tl', 'tr', 'bl', 'br']) box.append(make('i', corner));
  if (screen.icon !== undefined && screen.blocked === undefined) { const icon = make('div', 'ws-fail-icon'); icon.append(svg(screen.icon)); box.append(icon); }
  if (screen.blocked !== undefined) {
    const want = make('p', 'ws-fail-want');
    want.append('You tapped ', make('b', '', screen.blocked), make('i', '', 'on hold'));
    box.append(want);
  }
  if (screen.tag !== undefined) box.append(make('p', 'ws-fail-tag', screen.tag));
  box.append(make('h1', '', screen.title));
  if (screen.body !== undefined) box.append(make('p', 'ws-fail-body', screen.body));
  if (screen.help !== undefined) box.append(make('p', 'ws-fail-help', screen.help));
  progress(scope, screen, box);
  if (screen.status !== undefined) { const status = make('p', 'ws-fail-status'); status.setAttribute('role', 'status'); statusLine(scope, screen, status); box.append(status); }
  if (screen.actions !== undefined && screen.actions.length > 0) box.append(make('div', 'ws-fail-rule'), buttons(scope, screen.actions));
  if (screen.detail !== undefined && screen.kind === 'card') {
    const details = make('details'), summary = make('summary', '', 'Details');
    details.append(summary, make('p', 'ws-fail-detail', screen.detail));
    box.append(details);
  }
  return box;
}

/** One screen's nodes. */
function render(scope: Scope, screen: FailScreen): HTMLElement {
  const root = make('div', 'ws-fail');
  root.dataset['tone'] = screen.tone; root.dataset['kind'] = screen.kind;
  switch (screen.kind) {
    case 'page': {
      root.classList.add('ws-fail-page'); root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', screen.title);
      const word = make('div', 'ws-fail-word'), middle = make('div', 'ws-fail-mid');
      word.append('Project ', make('b', '', 'Wildshard'));
      const box = boxed(scope, screen);
      if (screen.detail !== undefined) box.append(make('p', 'ws-fail-detail', screen.detail));
      middle.append(box); root.append(word, middle);
      break;
    }
    case 'card':
      root.classList.add('ws-fail-scrim'); root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', screen.title);
      root.append(boxed(scope, screen));
      break;
    case 'strip': {
      root.classList.add('ws-fail-strip'); root.setAttribute('role', 'status');
      const head = make('b');
      if (screen.spinner === true) head.append(ring());
      head.append(screen.title); root.append(head);
      const status = make('span');
      statusLine(scope, screen, status, false);
      root.append(status);
      break;
    }
    case 'chip': {
      root.classList.add('ws-fail-chip'); root.setAttribute('role', 'status');
      if (screen.detail !== undefined) root.classList.add('dev');
      root.append(make('b', '', screen.title));
      if (screen.bars !== undefined) {
        const bars = make('span', 'ws-fail-bars');
        for (let bar = 0; bar < 4; bar++) { const line = make('i', bar < screen.bars ? 'on' : ''); line.style.height = `${String(4 + bar * 3)}px`; bars.append(line); }
        root.append(bars);
      }
      if (screen.status !== undefined) root.append(make('span', '', screen.status));
      break;
    }
    case 'loading': {
      root.classList.add('ws-fail-load'); root.setAttribute('role', 'status');
      const head = make('h1', '', screen.title); head.append(make('small', '', '61%'));
      const meter = make('div', 'ws-fail-meter'); meter.append(make('i'));
      const status = make('p', 'ws-fail-status'); statusLine(scope, screen, status);
      root.append(head, meter, status, buttons(scope, screen.actions ?? []));
      break;
    }
    case 'tip': {
      root.classList.add('ws-fail-tip'); root.setAttribute('role', 'status');
      const words = make('p', '', screen.title); words.append(make('span', '', screen.status ?? ''));
      root.append(svg(screen.icon ?? 'mic'), words, buttons(scope, screen.actions ?? []));
      break;
    }
    default: break;
  }
  return root;
}

/** The prototype ribbon: which one this is, the next and previous, and away. It is the only part a player would never see. */
function ribbon(scope: Scope, index: number, go: (to: number) => void, close: () => void): HTMLElement {
  const bar = make('div', 'ws-fail ws-fail-proto'), failure = FAILURES[index];
  bar.dataset['failmode'] = failure?.id ?? 'gallery';
  bar.append(make('span', '', failure === undefined ? 'Prototype' : `Prototype · ${failure.id} · ${String(index + 1)}/${String(FAILURES.length)}`));
  const button = (text: string, label: string, act: () => void): void => {
    const node = make('button', '', text); node.type = 'button'; node.setAttribute('aria-label', label); scope.listen(node, 'click', act); bar.append(node);
  };
  button('☰', 'All failure screens', () => { go(-1); });
  // a banner and its blocked-action card are a pair: ⇄ flips between them
  const pair = failure === undefined ? undefined : failure.pair ?? FAILURES.find(other => other.pair === failure.id)?.id;
  if (pair !== undefined) button('⇄', 'Its pair', () => { go(FAILURES.findIndex(other => other.id === pair)); });
  button('‹', 'Previous', () => { go(index < 0 ? FAILURES.length - 1 : (index - 1 + FAILURES.length) % FAILURES.length); });
  button('›', 'Next', () => { go((index + 1) % FAILURES.length); });
  button('✕', 'Close', close);
  return bar;
}
/** Every failure by group: a tap opens its screen. */
function gallery(scope: Scope, go: (to: number) => void): HTMLElement {
  const root = make('div', 'ws-fail ws-fail-scrim'), box = make('div', 'ws-fail-box ws-fail-list');
  root.dataset['tone'] = 'info'; root.dataset['kind'] = 'gallery'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Failure screens');
  for (const corner of ['tl', 'tr', 'bl', 'br']) box.append(make('i', corner));
  box.append(make('p', 'ws-fail-tag', 'Developer · prototypes'), make('h1', '', 'Failure screens'),
    make('p', 'ws-fail-body', 'What a player sees when the world\'s link fails. A ↳ row is its banner\'s blocked-action card: what a tap gets while that banner is up.'));
  let group = '';
  for (const [index, failure] of FAILURES.entries()) {
    if (failure.group !== group) { group = failure.group; box.append(make('h2', '', group)); }
    const button = make('button', failure.pair === undefined ? '' : 'sib', failure.name); button.type = 'button'; button.dataset['failmode'] = failure.id;
    button.append(make('small', '', failure.pair === undefined ? failure.screen.kind : 'card · blocked'));
    scope.listen(button, 'click', () => { go(index); });
    box.append(button);
  }
  root.append(box);
  return root;
}

let open: Scope | null = null;
/** Show one failure's screen by id, or `gallery` for the list. Returns what closes it. Showing another closes this one. */
export function showFailScreen(id: string, parent: HTMLElement = document.body): () => void {
  open?.dispose();
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scope = new Scope('failScreens'), close = (): void => { scope.dispose(); if (open === scope) open = null; before?.focus(); };
  open = scope;
  const style = scope.ownNode(make('style')); style.id = STYLE_ID; style.textContent = CSS; document.head.append(style);
  const go = (to: number): void => { showFailScreen(FAILURES[to]?.id ?? 'gallery', parent); };
  const index = FAILURES.findIndex(failure => failure.id === id), failure = FAILURES[index];
  const under = failure?.pair === undefined ? undefined : FAILURES.find(other => other.id === failure.pair);
  if (under !== undefined) {
    // one clock for the pair: a banner with a countdown counts the card's, so the two never disagree
    const countdown = under.screen.countdown === undefined ? undefined : failure?.screen.countdown ?? under.screen.countdown;
    const banner = render(scope, countdown === undefined ? under.screen : { ...under.screen, countdown });
    // under a card, the banner's own buttons (the voice tip's) can't take focus or taps
    banner.dataset['failmode'] = under.id; banner.inert = true; parent.append(scope.ownNode(banner));
  }
  const shown = failure === undefined ? gallery(scope, go) : render(scope, failure.screen);
  if (failure !== undefined) shown.dataset['failmode'] = failure.id;
  parent.append(scope.ownNode(shown), scope.ownNode(ribbon(scope, index, go, close)));
  // Developer off (src/client/engine/core/devMode.ts's `ws-dev` event) takes the prototype away at once
  scope.listen(window, 'ws-dev', event => { if (event instanceof CustomEvent && event.detail !== true) close(); });
  // a modal takes focus to its first button, as the error modal does; closing hands it back
  if (shown.getAttribute('role') === 'alertdialog' || shown.getAttribute('role') === 'dialog') shown.querySelector('button')?.focus();
  return close;
}
