// E7.5 prep: the Connection doctor's panel. It wears the loading card's look (dark glass, cyan line, Rajdhani heads, JetBrains Mono
// facts) with its own styles, because it must open on a page whose game stylesheet, packs or renderer failed. Phone first: one column,
// every button at least 48 px tall.
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { DOCTOR_CHECKS, doctorReport, runDoctor, type DoctorConfig, type DoctorRow, type DoctorState } from './doctor';

const STYLE_ID = 'ws-doc-style';
const CSS = `
.ws-doc{position:fixed;inset:0;z-index:2147483200;display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
  font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;color:#e6f2f8;background:radial-gradient(ellipse at 50% 30%,#0d1a26 0%,#06090f 60%,#030508 100%);
  -webkit-user-select:text;user-select:text;touch-action:pan-y}
.ws-doc::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,rgba(143,227,255,.025) 0 1px,transparent 1px 3px);pointer-events:none}
.ws-doc *{box-sizing:border-box}
.ws-doc-head{padding:calc(28px + env(safe-area-inset-top,0px)) 20px 0}
.ws-doc-word{font:700 34px/1 Rajdhani,'Bahnschrift','DIN Alternate',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff}
.ws-doc-word b{color:#8fe3ff}
.ws-doc-tag{margin-top:8px;font-size:11px;letter-spacing:.04em;color:rgba(196,220,232,.6)}
.ws-doc-body{flex:1;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 16px 12px}
.ws-doc-panel{position:relative;width:100%;max-width:560px;padding:16px 14px 12px;background:rgba(6,10,18,.55);border:1px solid rgba(143,227,255,.35);
  box-shadow:0 0 0 1px rgba(0,0,0,.35),0 10px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(143,227,255,.12)}
.ws-doc-panel::before{content:'';position:absolute;left:-1px;top:-1px;width:18px;height:18px;border-left:1px solid #8fe3ff;border-top:1px solid #8fe3ff;opacity:.8}
.ws-doc-title{display:flex;align-items:baseline;gap:6px;font:700 16px Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#fff}
.ws-doc-title b{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#8fe3ff}
.ws-doc-clock{margin-left:auto;padding-left:10px;font:400 12px 'JetBrains Mono',Menlo,monospace;letter-spacing:.08em;color:#8fe3ff}
.ws-doc-meta{margin:8px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(143,227,255,.08);font-size:10px;letter-spacing:.06em;color:rgba(196,220,232,.6);overflow-wrap:anywhere}
.ws-doc-bar{height:4px;background:rgba(143,227,255,.12);overflow:hidden}
.ws-doc-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,rgba(143,227,255,.6),#8fe3ff);box-shadow:0 0 12px rgba(143,227,255,.6);transition:width .2s linear}
.ws-doc[data-verdict=fail] .ws-doc-bar i{background:#ff5a4a;box-shadow:0 0 12px rgba(255,90,74,.5)}
.ws-doc[data-verdict=warn] .ws-doc-bar i{background:#ffb547;box-shadow:0 0 12px rgba(255,181,71,.5)}
.ws-doc-rows{list-style:none;margin:12px 0 0;padding:0}
.ws-doc-row{display:grid;grid-template-columns:22px 1fr auto;column-gap:8px;align-items:baseline;padding:9px 0;border-top:1px solid rgba(143,227,255,.08)}
.ws-doc-row:first-child{border-top:0}
.ws-doc-glyph{width:16px;height:16px;align-self:center;display:flex;align-items:center;justify-content:center;font:700 12px/1 'JetBrains Mono',monospace;border:1px solid rgba(143,227,255,.25);color:rgba(196,220,232,.4)}
.ws-doc-name{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(143,227,255,.55)}
.ws-doc-ms{font-size:10px;color:rgba(196,220,232,.45);font-variant-numeric:tabular-nums}
.ws-doc-value{grid-column:2/4;margin-top:3px;font-size:11px;letter-spacing:.03em;color:rgba(196,220,232,.75);overflow-wrap:anywhere}
.ws-doc-hint{grid-column:2/4;margin-top:6px;padding:6px 8px;border-left:2px solid currentColor;font:500 12px/1.45 'JetBrains Mono',monospace;letter-spacing:0;background:rgba(6,10,18,.6)}
.ws-doc-hint:empty{display:none}
.ws-doc-row[data-state=run] .ws-doc-name,.ws-doc-row[data-state=run] .ws-doc-value{color:#fff}
.ws-doc-row[data-state=run] .ws-doc-glyph{border:2px solid #8fe3ff;border-right-color:transparent;border-radius:50%;animation:ws-doc-spin .8s linear infinite}
.ws-doc-row[data-state=pass] .ws-doc-glyph{border-color:#8fe3ff;color:#8fe3ff;box-shadow:0 0 8px rgba(143,227,255,.35)}
.ws-doc-row[data-state=pass] .ws-doc-name{color:#8fe3ff}
.ws-doc-row[data-state=warn] .ws-doc-glyph,.ws-doc-row[data-state=warn] .ws-doc-name,.ws-doc-row[data-state=warn] .ws-doc-hint{border-color:#ffb547;color:#ffb547}
.ws-doc-row[data-state=fail] .ws-doc-glyph,.ws-doc-row[data-state=fail] .ws-doc-name,.ws-doc-row[data-state=fail] .ws-doc-hint{border-color:#ff5a4a;color:#ff7a6c}
.ws-doc-row[data-state=fail] .ws-doc-glyph{background:rgba(255,90,74,.12)}
.ws-doc-row[data-state=skip] .ws-doc-name,.ws-doc-row[data-state=wait] .ws-doc-name{color:rgba(196,220,232,.35)}
.ws-doc-verdict{margin-top:10px;padding-top:10px;border-top:1px solid rgba(143,227,255,.14);font:700 14px Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8fe3ff}
.ws-doc-verdict:empty{display:none}
.ws-doc[data-verdict=fail] .ws-doc-verdict{color:#ff7a6c}
.ws-doc[data-verdict=warn] .ws-doc-verdict{color:#ffb547}
.ws-doc-actions{width:100%;max-width:560px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ws-doc-btn{min-height:52px;padding:12px 14px;appearance:none;-webkit-appearance:none;border:1px solid rgba(143,227,255,.35);background:rgba(6,10,18,.78);color:#fff;
  font:12px 'JetBrains Mono',Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;touch-action:manipulation}
.ws-doc-btn.primary{grid-column:1/3;border-color:#8fe3ff;color:#8fe3ff;font:700 16px Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.18em}
.ws-doc-btn:disabled{opacity:.45}
.ws-doc-btn:focus-visible{outline:2px solid #8fe3ff;outline-offset:3px}
.ws-doc-foot{padding:0 16px calc(14px + env(safe-area-inset-bottom,0px));font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:rgba(196,220,232,.4);text-align:center}
@keyframes ws-doc-spin{to{transform:rotate(360deg)}}
@media (min-width:700px){.ws-doc-head{padding:34px 44px 0}.ws-doc-word{font-size:54px;letter-spacing:.08em}.ws-doc-tag{font-size:13px}.ws-doc-body{justify-content:center}.ws-doc-panel{padding:22px 26px 18px}.ws-doc-title{font-size:20px}}
`;
const GLYPH: Readonly<Record<DoctorState, string>> = { wait: '', run: '', pass: '✓', warn: '!', fail: '✕', skip: '–' };

/** Where the doctor goes when the player is done with it. */
export interface DoctorExit { readonly label: string; readonly go: () => void }
/** The open panel. */
export interface DoctorPanel { readonly root: HTMLElement; readonly finished: Promise<readonly DoctorRow[]>; close: () => void }

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (text !== '') node.textContent = text; return node;
};
/** LS4's clipboard write (src/client/engine/ui/diagnosticsCopy.ts): the tap is the activation the clipboard needs. */
const copyText = async (text: string): Promise<boolean> => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
const clockText = (ms: number): string => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${(ms / 1000 % 60).toFixed(1).padStart(4, '0')}`;

/** Open the doctor over `parent` and run every check. `earlier` is a report the page already had (LS4's Copy diagnostics), which
 *  Copy report carries under the doctor's own lines. */
export function openDoctor(config: DoctorConfig, exit: DoctorExit | null, earlier: string | null = null, parent: HTMLElement = document.body): DoctorPanel {
  const scope = new Scope('doctor.panel');
  if (document.getElementById(STYLE_ID) === null) { const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = CSS; document.head.append(style); }
  document.querySelector('.ws-doc')?.remove();
  const root = make('section', 'ws-doc'), head = make('div', 'ws-doc-head'), word = make('div', 'ws-doc-word'), tag = make('div', 'ws-doc-tag', 'Connection doctor: checks every link between this device and the world, in order.');
  root.id = 'ws-doctor'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Connection doctor');
  word.append('Project ', make('b', '', 'Wildshard'));
  head.append(word, tag);
  const body = make('div', 'ws-doc-body'), panel = make('div', 'ws-doc-panel'), title = make('div', 'ws-doc-title'), clock = make('span', 'ws-doc-clock', '00:00.0');
  title.append(make('span', '', 'Doctor'), make('b', '', config.world === undefined ? 'offline build' : config.cell?.replaceAll('-', ' ') ?? 'online world'), clock);
  const meta = make('div', 'ws-doc-meta', `page ${config.build === '' ? 'unknown build' : config.build.slice(0, 12)}${config.world === undefined ? '' : ` · ${new URL(config.world.release).host}`}`);
  const bar = make('div', 'ws-doc-bar'), fill = make('i', ''), list = make('ol', 'ws-doc-rows'), verdict = make('div', 'ws-doc-verdict');
  verdict.setAttribute('role', 'status');
  bar.append(fill);
  const rows = new Map<string, { row: HTMLLIElement; glyph: HTMLElement; value: HTMLElement; hint: HTMLElement; ms: HTMLElement }>();
  for (const { id, label } of DOCTOR_CHECKS) {
    const row = make('li', 'ws-doc-row'), glyph = make('span', 'ws-doc-glyph'), name = make('span', 'ws-doc-name', label), ms = make('span', 'ws-doc-ms'), value = make('div', 'ws-doc-value', 'waiting'), hint = make('div', 'ws-doc-hint');
    row.dataset['check'] = id; row.dataset['state'] = 'wait'; glyph.setAttribute('aria-hidden', 'true');
    row.append(glyph, name, ms, value, hint); list.append(row);
    rows.set(id, { row, glyph, value, hint, ms });
  }
  panel.append(title, meta, bar, list, verdict);
  const actions = make('div', 'ws-doc-actions'), copy = make('button', 'ws-doc-btn primary', 'Copy report'), again = make('button', 'ws-doc-btn', 'Run again');
  copy.type = 'button'; again.type = 'button';
  actions.append(copy, again);
  if (exit !== null) { const back = make('button', 'ws-doc-btn', exit.label); back.type = 'button'; back.dataset['doctor'] = 'back'; scope.listen(back, 'click', () => { exit.go(); }); actions.append(back); }
  else again.style.gridColumn = '1 / 3';
  body.append(panel, actions);
  root.append(head, body, make('div', 'ws-doc-foot', 'Nothing is sent. Copy report puts it on the clipboard for Jake.'));
  parent.append(root);

  let done: readonly DoctorRow[] = [], run: Scope | null = null;
  const show = (row: DoctorRow): void => {
    const view = rows.get(row.id);
    if (view === undefined || scope.disposed) return;
    view.row.dataset['state'] = row.state; view.glyph.textContent = GLYPH[row.state];
    // FM4b mode 42: a warning that stands for a catalogued failure carries its id (`clock-skew`), as the link's cards do
    if (row.failmode === undefined) delete view.row.dataset['failmode']; else view.row.dataset['failmode'] = row.failmode;
    view.value.textContent = row.state === 'run' ? 'checking…' : row.value;
    view.hint.textContent = row.hint; view.ms.textContent = row.state === 'run' ? '' : `${String(row.ms)} ms`;
  };
  const start = (): Promise<readonly DoctorRow[]> => {
    const started = diagnosticNow();
    run?.dispose(); run = scope.child('doctor.pass');
    const pass = run;
    copy.disabled = true; again.disabled = true; verdict.textContent = ''; delete root.dataset['verdict']; root.dataset['running'] = '';
    for (const { id, label } of DOCTOR_CHECKS) show({ id, label, state: 'wait', value: 'waiting', hint: '', ms: 0 });
    for (const view of rows.values()) view.ms.textContent = '';
    const ticking = pass.interval(100, () => { clock.textContent = clockText(diagnosticNow() - started); });
    let finishedCount = 0;
    return runDoctor(config, pass, row => { show(row); if (row.state !== 'run') { finishedCount++; fill.style.width = `${String(Math.round(finishedCount / DOCTOR_CHECKS.length * 100))}%`; } }).then(result => {
      pass.cancelTimer(ticking); clock.textContent = clockText(diagnosticNow() - started);
      done = result; delete root.dataset['running'];
      const failing = result.filter(row => row.state === 'fail'), warned = result.filter(row => row.state === 'warn');
      root.dataset['verdict'] = failing.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'pass';
      verdict.textContent = failing.length > 0 ? `${String(failing.length)} failing · first: ${failing[0]?.label ?? ''}` : warned.length > 0 ? `All links up · ${String(warned.length)} to look at` : 'All links good';
      copy.disabled = false; again.disabled = false;
      return result;
    });
  };
  scope.listen(copy, 'click', () => {
    const text = [doctorReport(done, config), ...earlier === null ? [] : ['', 'boot diagnostics (LS4):', earlier]].join('\n');
    void copyText(text).then(ok => { copy.textContent = ok ? 'Copied' : 'Copy failed'; scope.timeout(2500, () => { copy.textContent = 'Copy report'; }); return undefined; });
  });
  scope.listen(again, 'click', () => { void start(); });
  const finished = start();
  copy.focus();
  return { root, finished, close: () => { scope.dispose(); root.remove(); } };
}
