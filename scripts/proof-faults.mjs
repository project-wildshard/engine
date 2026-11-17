// ZONE-ENTRY ZE23 (SENTRY-TRIAGE S21's lesson): the check every browser proof shares, so a proof fails whenever the error
// card, the glitch chip or a faulted system shows, not only on an uncaught page error. A frame-loop system's throw never
// reaches `pageerror`: Game.ts catches it and logs `[faults] system "<label>" threw:` (src/shared/engine/core/faults.ts),
// then the card (`#wserr`) or the chip (`#wserr-chip`) goes up (src/client/engine/ui/ErrorModal.ts). Nalati's card hid that
// way for two releases.
//
//   const faults = await watchFaults(page, result.errors, 'A'); // before the page's first goto
//   ...
//   await faults.settle();                                      // before the verdict reads result.errors
//
// The init script logs every card that mounts (`[proof-card] ...`), so a chip that fades by itself, or a card on a document
// a zone entry navigated away from, still fails the run; settle() adds any card on screen that was never logged.

/** The error card and the glitch chip, by the ids ErrorModal.ts gives them. Nothing in the game has the class `ws-err`. */
export const ERROR_CARD = '#wserr, #wserr-chip';

const FAULT = /^\[faults\] (core )?system "([^"]*)" (?:threw:?\s*([\s\S]*)|failed \d+ times: the frame loop stops)/u;
const LISTENER = /^\[faults\] a fault listener threw:?\s*([\s\S]*)/u;
const CARD = /^\[proof-card\] (error card|glitch chip): ([\s\S]*)/u;

/** an error's first line (the stack stays in the page's own log) @param {string | undefined} text */
const firstLine = (text) => (text ?? '').trim().split('\n')[0]?.slice(0, 240) ?? '';

/** One console line → the problem it shows, or null for any other line. @param {string} line @returns {string | null} */
export function faultProblem(line) {
  const fault = FAULT.exec(line);
  if (fault !== null) {
    const [, core, system, error] = fault;
    if (core !== undefined) return `core system "${system ?? ''}" stopped the frame loop`;
    return `system "${system ?? ''}" faulted: ${firstLine(error)}`;
  }
  const listener = LISTENER.exec(line);
  if (listener !== null) return `a fault listener threw: ${firstLine(listener[1])}`;
  const card = CARD.exec(line);
  if (card !== null) return `the ${card[1] ?? ''} showed: ${(card[2] ?? '').trim().slice(0, 240)}`;
  return null;
}

/** Runs in the page (an init script, so in every document): logs each error card and glitch chip once, when it mounts. */
export function recordCards() {
  const w = /** @type {any} */ (window);
  if (w.__wsProofCards === true) return;
  w.__wsProofCards = true;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {Element} el */
  const note = (el) => {
    const kind = el.id === 'wserr' ? 'error card' : el.id === 'wserr-chip' ? 'glitch chip' : '';
    if (kind === '' || seen.has(kind)) return;
    seen.add(kind);
    const line = el.id === 'wserr' ? (el.querySelector('.what')?.textContent ?? el.querySelector('.msg')?.textContent ?? '') : (el.textContent ?? '');
    console.warn(`[proof-card] ${kind}: ${line.trim().slice(0, 240)}`);
  };
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      const el = /** @type {Element} */ (node);
      note(el);
      for (const inner of el.querySelectorAll('#wserr, #wserr-chip')) note(inner);
    }
  }).observe(document, { childList: true, subtree: true });
}

/** Runs in the page: the cards on screen now, as `<kind>: <line>`. @returns {string[]} */
export function cardNow() {
  /** @type {string[]} */
  const rows = [];
  const card = document.getElementById('wserr'), chip = document.getElementById('wserr-chip');
  if (card !== null) rows.push(`error card: ${(card.querySelector('.what')?.textContent ?? card.querySelector('.msg')?.textContent ?? '').trim().slice(0, 240)}`);
  if (chip !== null) rows.push(`glitch chip: ${(chip.textContent ?? '').trim().slice(0, 240)}`);
  return rows;
}

/**
 * Watch one page: every uncaught page error, faulted system and card pushes a line into `errors` (the proof's own list, so
 * its `errors.length === 0` verdict fails on them). Call before the page's first navigation.
 * @param {import('playwright').Page} page @param {string[]} errors @param {string} [who] a prefix naming the page
 * @returns {Promise<{ settle: () => Promise<void> }>}
 */
/** How near a page's navigation a WebKit access-control error counts as a cancelled fetch (SB44). */
const CANCEL_MS = 3000;
export async function watchFaults(page, errors, who = '') {
  /** which cards were already pushed: a chip's line changes once its report is sent (a ✓), it is still the one chip */
  /** @type {Set<string>} */
  const cards = new Set();
  const push = (/** @type {string} */ problem) => {
    const card = /^the (error card|glitch chip) showed/u.exec(problem)?.[1];
    if (card !== undefined) { if (cards.has(card)) return; cards.add(card); }
    errors.push(who === '' ? problem : `${who}: ${problem}`);
  };
  // SB44 (MU19c1b's class): WebKit reports each fetch a page had in flight when it reloads (an update, a resume) as an uncaught
  // `… due to access control checks.`; one within 3 s of the page's own navigation is that cancel, not a fault. The rest still fail.
  /** @type {{ at: number, text: string }[]} */
  const cancels = [];
  /** @type {number[]} */
  const navigations = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(Date.now()); });
  page.on('pageerror', (error) => {
    const text = `uncaught page error: ${error.message.slice(0, 240)}`;
    if (error.message.endsWith(' due to access control checks.')) cancels.push({ at: Date.now(), text }); else push(text);
  });
  page.on('console', (message) => { const problem = faultProblem(message.text()); if (problem !== null) push(problem); });
  await page.addInitScript(recordCards);
  return {
    async settle() {
      for (const { at, text } of cancels.splice(0)) if (!navigations.some((t) => Math.abs(t - at) <= CANCEL_MS)) push(text);
      const onScreen = await page.evaluate(cardNow).catch(() => /** @type {string[]} */ ([]));
      for (const row of onScreen) push(`the ${row.replace(/: /u, ' showed: ')}`);
    },
  };
}
