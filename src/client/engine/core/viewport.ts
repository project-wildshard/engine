import { pageScope } from '../../../shared/engine/app/resources';
/**
 * viewport — the page's drawable height.
 *
 *   installViewport();            // once (Game's constructor); keeps `--ws-vh` on <html> current on every resize
 *   const h = viewportHeight();   // use instead of window.innerHeight for the canvas and anything projected onto it
 *
 * History (E46 → E58): an iOS home-screen web app laid out UNDER the status bar (`viewport-fit=cover` + black-translucent)
 * had WebKit shrink the viewport a status bar short (~62 px) about a second after load, and keep it short; the black strip
 * sat under the control bar and the title. E46 papered over it here by sizing to `screen.height`, but WebKit clips fixed
 * content to the shrunk viewport, so the strip stayed (and the bar was cut). Bisected in the iOS 26.5 simulator's
 * home-screen app (E58): `overflow: hidden` on html / body and the boot loader's relayout both trigger the shrink, and only
 * dropping `viewport-fit=cover` (the page starts below the status bar and runs to the bottom edge) cures it for good. So
 * this is plain innerHeight again; the module stays as the one place to change should WebKit need another workaround.
 */
export function viewportHeight(): number {
  return window.innerHeight;
}

let installed = false;
/** publish the height as `--ws-vh` (base.css sizes #game and #hud with it) and keep it current */
export function installViewport(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  const sync = (): void => {
    root.style.setProperty('--ws-vh', `${viewportHeight()}px`);
    // below the status bar WebKit reports safe-area-inset-bottom 0, yet the home indicator still sits over the page's bottom
    // edge on Face ID phones (portrait screen ≥ 812 px tall): --ws-home stands in for it (touch.css lifts the bar's content)
    const standalone = root.classList.contains('standalone'), tall = Math.max(screen.width, screen.height) >= 812;
    root.style.setProperty('--ws-home', standalone && tall ? '34px' : '0px');
  };
  sync();
  pageScope.listen(window, 'resize', sync);
}
