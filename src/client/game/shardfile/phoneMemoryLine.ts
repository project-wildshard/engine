import { MemoryAdmission, type MemoryAdmissionRequest } from '@wildshard/format/memoryAdmission';
import { MEMORY_GATES } from '@wildshard/format/contentBounds';
import { isDev } from '@wildshard/engine/core/devMode';
import { TIER, type Tier } from '@wildshard/engine/core/tier';
import { PHONE_MEMORY_LOADING_CAP_BYTES } from '@wildshard/engine/core/phoneMemoryCap';

/** MG3 / J431: estimates over the phone line show a phone warning. Decimal bytes (BC12: budgets/caps.json). */
export const PHONE_MEMORY_LINE_BYTES: number = PHONE_MEMORY_LOADING_CAP_BYTES;

interface PhoneMemoryEstimate { playing: number; loading: number }

/** Read the cook estimate stamped into the page for its selected catalogue pin. */
export function cookedPhoneEstimate(slug: string): PhoneMemoryEstimate | undefined {
  const verdicts: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__');
  if (!Array.isArray(verdicts)) return undefined;
  const path = `/shardfiles/${slug}/shard.json`;
  const row: unknown = verdicts.find((candidate: unknown) =>
    typeof candidate === 'object' && candidate !== null && 'path' in candidate && candidate.path === path);
  const cost = typeof row === 'object' && row !== null && 'worst' in row ? row.worst : undefined;
  return typeof cost === 'object' && cost !== null && 'playing' in cost && 'loading' in cost
    && typeof cost.playing === 'number' && typeof cost.loading === 'number'
    ? { playing: cost.playing, loading: cost.loading } : undefined;
}

export class PageMemoryAdmission extends MemoryAdmission {
  private estimate = 0;
  private acknowledgement: Promise<void> | undefined;

  private readonly tier: Tier;
  private readonly developerPage: () => boolean;
  constructor(tier: Tier = TIER, developerPage: () => boolean = isDev, reportOnly: boolean = MEMORY_GATES.reportOnly) {
    super(() => tier === 'phone' || reportOnly || developerPage());
    this.tier = tier; this.developerPage = developerPage;
  }

  override accept(request: MemoryAdmissionRequest): boolean {
    const accepted = super.accept(request);
    if (request.stage !== 'resident') this.estimate = Math.max(this.estimate, request.playingBytes, request.loadingBytes);
    return accepted;
  }

  /** One warning per entry, even when both its declared and actual estimates cross. */
  waitForWarning(show: () => Promise<void>, entry?: string): Promise<void> | undefined {
    const cooked = entry === undefined ? undefined : cookedPhoneEstimate(entry);
    if (this.tier === 'phone' && Math.max(this.estimate, cooked?.playing ?? 0, cooked?.loading ?? 0) > PHONE_MEMORY_LINE_BYTES
      && !this.developerPage()) this.acknowledgement ??= show();
    return this.acknowledgement;
  }
}
