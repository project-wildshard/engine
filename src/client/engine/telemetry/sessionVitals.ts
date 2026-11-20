import * as v from 'valibot';
import { mobileDevice } from '../boot/titleArrival';

const duration = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
export interface SessionSummary {
  readonly device: 'phone' | 'tablet' | 'desktop';
  readonly tier?: 'phone' | 'desktop';
  readonly firstFrameMs?: number;
  readonly joinedMs?: number;
  readonly fpsHistogram: [number, number, number, number, number];
}
export const vitalsSchema: v.GenericSchema<unknown, SessionSummary> = v.object({
  device: v.picklist(['phone', 'tablet', 'desktop']),
  tier: v.exactOptional(v.picklist(['phone', 'desktop'])),
  firstFrameMs: v.exactOptional(duration),
  joinedMs: v.exactOptional(duration),
  fpsHistogram: v.tuple([duration, duration, duration, duration, duration]),
});
type DeviceClass = SessionSummary['device'];
type Tier = NonNullable<SessionSummary['tier']>;

export function sessionDevice(ua: string, platform: string, touch: number): DeviceClass {
  if (/iPad|Tablet|Android(?!.*Mobile)/iu.test(ua) || (platform === 'MacIntel' && touch > 1)) return 'tablet';
  return mobileDevice(ua, platform, touch) ? 'phone' : 'desktop';
}

/** Time the first world reached on a page. Later zone changes keep the original boot readings. */
export class SessionVitals {
  private started: number | undefined;
  private firstFrameMs: number | undefined;
  private joinedMs: number | undefined;
  private tier: Tier | undefined;
  private readonly buckets: SessionSummary['fpsHistogram'] = [0, 0, 0, 0, 0];

  private readonly device: DeviceClass;

  constructor(device: DeviceClass) { this.device = device; }

  begin(at: number, tier: Tier): void {
    if (this.joinedMs !== undefined) return;
    this.started = at;
    this.firstFrameMs = undefined;
    this.tier = tier;
  }

  frame(at: number): void {
    if (this.started !== undefined) this.firstFrameMs ??= Math.round(Math.max(0, at - this.started));
  }

  joined(at: number): void {
    if (this.started !== undefined) this.joinedMs ??= Math.round(Math.max(0, at - this.started));
  }

  sample(fps: number): void {
    const bucket = fps < 20 ? 0 : fps < 30 ? 1 : fps < 45 ? 2 : fps < 60 ? 3 : 4;
    this.buckets[bucket]++;
  }

  reading(): SessionSummary {
    return { device: this.device, fpsHistogram: [...this.buckets],
      ...(this.tier === undefined ? {} : { tier: this.tier }),
      ...(this.firstFrameMs === undefined ? {} : { firstFrameMs: this.firstFrameMs }),
      ...(this.joinedMs === undefined ? {} : { joinedMs: this.joinedMs }),
    };
  }
}
