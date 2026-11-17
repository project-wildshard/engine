import { MemoryAdmission, type MemoryAdmissionRequest } from '@wildshard/format/memoryAdmission';
import { MEMORY_GATES } from '@wildshard/format/contentBounds';
import { isDev } from '@wildshard/engine/core/devMode';
import { TIER, type Tier } from '@wildshard/engine/core/tier';

/**
 * MEMORY-GATES MG3 (J408, Jake 2026-11-17, after Nine crashed his iPhone 17 Pro at boot): the phone's hard line, engine's
 * MEMORY_AMBER (src/client/game/grid/budgetOverlay.ts; a test holds them equal). Decimal bytes.
 */
export const PHONE_MEMORY_LINE_BYTES = 1.5e9;

/** A phone boot refused for memory: the message is the card the player reads, before any world is built. */
export class ShardMemoryRefusalError extends Error {
  readonly owner: string; readonly playingBytes: number; readonly lineBytes: number;
  constructor(owner: string, playingBytes: number, lineBytes: number) {
    const gb = (bytes: number): string => (bytes / 1e9).toFixed(2);
    super(`This world needs about ${gb(playingBytes)} GB of memory and a phone has ${gb(lineBytes)} GB to give it. Pick another world, or play it on a computer.`);
    this.name = 'ShardMemoryRefusalError'; this.owner = owner; this.playingBytes = playingBytes; this.lineBytes = lineBytes;
  }
}

/**
 * The page's memory admission. On the phone tier a claim whose playing estimate passes the line is refused whatever
 * `memoryGates.json` says: a shard's own admission throws ShardMemoryRefusalError, a grid residency claim is declined; a Developer page keeps its override (G216) so it can still load
 * and measure an over-line shard. Under the line, and on other tiers, admission is unchanged: report-only accepts.
 */
export class PageMemoryAdmission extends MemoryAdmission {
  private readonly tier: Tier; private readonly developerPage: () => boolean;
  constructor(tier: Tier = TIER, developerPage: () => boolean = isDev, reportOnly: boolean = MEMORY_GATES.reportOnly) {
    super(() => reportOnly || developerPage());
    this.tier = tier; this.developerPage = developerPage;
  }
  override accept(request: MemoryAdmissionRequest): boolean {
    if (this.tier === 'phone' && request.playingBytes > PHONE_MEMORY_LINE_BYTES && !this.developerPage()) {
      // A live grid's residency claim is refused the ordinary way (the allocator keeps what it has); a shard's own
      // admission (its runtime home, its declared and actual costs) stops the boot with the card.
      if (request.stage === 'resident') return false;
      throw new ShardMemoryRefusalError(request.owner, request.playingBytes, PHONE_MEMORY_LINE_BYTES);
    }
    return super.accept(request);
  }
}
