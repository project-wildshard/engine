// E7.5 prep: the Connection doctor's own page (`/doctor/`, and `/?doctor` from index.html). It loads none of the game: no worker,
// packs, renderer or title, so it opens when those are what broke. It reads the stamps every document of this build carries.
import { openDoctor } from './doctorView';

/** The handoff key the game page writes (src/client/engine/ui/diagnosticsCopy.ts `DOCTOR_EARLIER_KEY`). */
const DOCTOR_EARLIER_KEY = 'doctor.earlier';

const stamps = globalThis as { __WS_BUILD_ID__?: string; __WS_WORLD__?: { release: string; key: string } };
const chunk = new URLSearchParams(location.search).get('chunk');
/** What the game page left (src/client/engine/ui/errorScreen.ts openDoctorPage): its LS4 report and the way back. A direct link has neither. */
function handoff(): { readonly earlier: string | null; readonly back: string } {
  try {
    // oxlint-disable-next-line wildshard/no-raw-save -- this page loads no save service; it reads the one handoff key errorScreen.ts wrote
    const raw = sessionStorage.getItem(DOCTOR_EARLIER_KEY);
    // oxlint-disable-next-line wildshard/no-raw-save -- the same handoff key, read once
    sessionStorage.removeItem(DOCTOR_EARLIER_KEY);
    const said = JSON.parse(raw ?? '{}') as { earlier?: unknown; back?: unknown };
    // Only a path on this origin: the way back is never another site.
    const back = typeof said.back === 'string' && said.back.startsWith('/') && !said.back.startsWith('//') ? said.back : '/';
    return { earlier: typeof said.earlier === 'string' ? said.earlier : null, back };
  } catch { return { earlier: null, back: '/' }; }
}
const { earlier, back } = handoff();
document.querySelector('[data-doctor-shell]')?.remove();
openDoctor({ build: stamps.__WS_BUILD_ID__ ?? '', origin: location.origin, ...stamps.__WS_WORLD__ === undefined ? {} : { world: stamps.__WS_WORLD__ }, ...chunk === null ? {} : { cell: chunk } },
  { label: back === '/' ? 'Open the game' : 'Back to game', go: () => { location.assign(back); } }, earlier);
