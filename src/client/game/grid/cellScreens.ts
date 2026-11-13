/**
 * QA 2026-11-13 (Jake: "This loading screen here, I have no idea why this loading screen in the 3D world is completely
 * different from the new one ... make it look the same as the one for Shard Select"): a waiting cell's steps on SHARD
 * SELECT's own loading card (`Loading`, scoped, in its `inset` mode), a crisp screen-space card over the live world. It
 * replaced G578's blurry canvas panel standing in 3D beyond the cell's wall (`CellScreen`, removed). The card opens when
 * a cell's preparation shows, steps with it, completes and fades when the cell is entered, and goes at once when the
 * traveller leaves or the session ends. Presentation only: `CellLoading` decides what it shows.
 */
import { Loading } from '@wildshard/engine/ui/Loading';
import { loadingPath } from '../boot/loadingPaths';
import type { CellLoadingScreen, CellLoadingView } from './cellLoading';

export class CellLoadingCard implements CellLoadingScreen {
  private card: { readonly instance: string; readonly loading: Loading; failed: string | null } | null = null;
  /** an entered cell's card while it completes and fades: a new card or a leave ends it at once */
  private fading: Loading | null = null;

  show(view: CellLoadingView): void {
    // a cleared refusal starts a fresh card: a failed card keeps its reason until it is disposed
    if (this.card !== null && (this.card.instance !== view.instance || this.card.failed !== null && view.failed === null)) this.hide(false);
    let card = this.card;
    if (card === null) {
      this.fading?.scope.dispose(); this.fading = null;
      const loading = new Loading({ id: view.instance, name: view.name }, { scoped: true, inset: true });
      loading.setPath(loadingPath('cell'));
      card = this.card = { instance: view.instance, loading, failed: null };
    }
    if (view.failed !== null) {
      if (card.failed !== view.failed) { card.failed = view.failed; card.loading.scopedFail(view.failed); }
      return;
    }
    card.loading.scopedStep(view.step, view.detail);
  }

  hide(entered: boolean): void {
    const card = this.card;
    if (!entered) { this.fading?.scope.dispose(); this.fading = null; }
    if (card === null) return;
    this.card = null;
    if (entered && card.failed === null) {
      const fading = this.fading = card.loading;
      void fading.done().then(() => { if (this.fading === fading) this.fading = null; return undefined; }, () => undefined);
    } else card.loading.scope.dispose();
  }

  /** The card's root while one is up (tests and proofs read it). */
  get root(): HTMLElement | null { return this.card?.loading.root ?? null; }
}
