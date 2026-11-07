import { ApproachInputsDeferredError } from './productInputs';

interface Request { complete: Promise<void>; offered: Promise<void>; deferred: boolean; revision: number }
/** Share view preparation, retry optional headroom only after accounting changes,
 * and promote a deferred view exactly once when actual entry requires it. */
export class GridViewAdmissions<Cell extends { readonly instance: string }> {
  private readonly requests = new Map<string, Request>();
  constructor(private readonly start: (cell: Cell, required: boolean, offered: () => void) => Promise<void>, private readonly revision: () => number) {}
  private request(cell: Cell, required: boolean): Request {
    const previous = this.requests.get(cell.instance);
    if (previous !== undefined && (!previous.deferred || !required && previous.revision === this.revision())) return previous;
    let offer = (): void => undefined;
    const offered = new Promise<void>(resolve => { offer = resolve; });
    const state: Request = { complete: Promise.resolve(), offered, deferred: false, revision: this.revision() };
    state.complete = (async () => {
      try { await this.start(cell, required, offer); }
      catch (error) {
        if (error instanceof ApproachInputsDeferredError) { state.deferred = true; state.revision = this.revision(); }
        throw error;
      }
    })();
    this.requests.set(cell.instance, state); return state;
  }
  complete(cell: Cell, required = false): Promise<void> {
    const pending = this.request(cell, required).complete;
    return required ? this.demand(cell, pending) : pending;
  }
  private async demand(cell: Cell, pending: Promise<void>): Promise<void> {
    try { await pending; }
    catch (error) {
      if (!(error instanceof ApproachInputsDeferredError)) throw error;
      await this.request(cell, true).complete;
    }
  }
  async render(cell: Cell): Promise<void> { const pending = this.request(cell, false); await Promise.race([pending.offered, pending.complete]); }
}
