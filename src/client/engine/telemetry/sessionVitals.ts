import * as v from 'valibot';
import { mobileDevice } from '../boot/titleArrival';
import { MAX_BOOT_STEPS, isBootStepKey, type BootKind } from './bootSteps';

const duration = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
export type BootStep = 'start' | 'download' | 'load';
export interface SessionSummary {
  readonly bootStep?: BootStep;
  readonly device: 'phone' | 'tablet' | 'desktop';
  readonly tier?: 'phone' | 'desktop';
  readonly firstFrameMs?: number;
  readonly joinedMs?: number;
  readonly fpsHistogram: [number, number, number, number, number];
  /** QA 2026-11-23 row 10: the boot's kind and step times (bootSteps.ts), once it reached control. */
  readonly boot?: BootKind;
  readonly bootSteps?: Readonly<Record<string, number>>;
}
export const vitalsSchema: v.GenericSchema<unknown, SessionSummary> = v.object({
  device: v.picklist(['phone', 'tablet', 'desktop']),
  bootStep: v.exactOptional(v.picklist(['start', 'download', 'load'])),
  tier: v.exactOptional(v.picklist(['phone', 'desktop'])),
  firstFrameMs: v.exactOptional(duration),
  joinedMs: v.exactOptional(duration),
  fpsHistogram: v.tuple([duration, duration, duration, duration, duration]),
  boot: v.exactOptional(v.picklist(['first', 'update', 'normal'])),
  bootSteps: v.exactOptional(v.pipe(v.record(v.pipe(v.string(), v.check(isBootStepKey)), duration),
    v.check(steps => Object.keys(steps).length <= MAX_BOOT_STEPS))),
});
type DeviceClass = SessionSummary['device'];
type Tier = NonNullable<SessionSummary['tier']>;

export function sessionDevice(ua: string, platform: string, touch: number): DeviceClass {
  if (/iPad|Tablet|Android(?!.*Mobile)/iu.test(ua) || (platform === 'MacIntel' && touch > 1)) return 'tablet';
  return mobileDevice(ua, platform, touch) ? 'phone' : 'desktop';
}

/** Time the first world reached on a page. Later zone changes keep the original boot readings. */
export class SessionVitals {
  private bootStep: BootStep | undefined;
  private zone: string | undefined;
  private started: number | undefined;
  private firstFrameMs: number | undefined;
  private joinedMs: number | undefined;
  private tier: Tier | undefined;
  private boot: BootKind | undefined;
  private bootSteps: Readonly<Record<string, number>> | undefined;
  private readonly buckets: SessionSummary['fpsHistogram'] = [0, 0, 0, 0, 0];

  private readonly device: DeviceClass;

  constructor(device: DeviceClass) { this.device = device; }

  begin(at: number, tier: Tier, zone: string): boolean {
    if (this.joinedMs !== undefined || (this.zone === zone && this.bootStep !== undefined)) return false;
    this.started = at;
    this.firstFrameMs = undefined;
    this.tier = tier;
    this.zone = zone;
    this.bootStep = 'start';
    return true;
  }

  step(step: BootStep | undefined): boolean {
    if (this.joinedMs !== undefined || this.zone === undefined || this.bootStep === step) return false;
    this.bootStep = step;
    return true;
  }

  frame(at: number): void {
    if (this.started !== undefined) this.firstFrameMs ??= Math.round(Math.max(0, at - this.started));
  }

  joined(at: number): void {
    if (this.started !== undefined) this.joinedMs ??= Math.round(Math.max(0, at - this.started));
  }

  /** The first boot's kind and step times; later zone changes keep them, as they keep the boot readings. */
  booted(kind: BootKind, steps: Readonly<Record<string, number>>): void {
    if (this.boot !== undefined) return;
    this.boot = kind; this.bootSteps = { ...steps };
  }

  sample(fps: number): void {
    const bucket = fps < 20 ? 0 : fps < 30 ? 1 : fps < 45 ? 2 : fps < 60 ? 3 : 4;
    this.buckets[bucket]++;
  }

  reading(): SessionSummary {
    return { device: this.device, fpsHistogram: [...this.buckets],
      ...(this.bootStep === undefined ? {} : { bootStep: this.bootStep }),
      ...(this.tier === undefined ? {} : { tier: this.tier }),
      ...(this.firstFrameMs === undefined ? {} : { firstFrameMs: this.firstFrameMs }),
      ...(this.joinedMs === undefined ? {} : { joinedMs: this.joinedMs }),
      ...(this.boot === undefined ? {} : { boot: this.boot }),
      ...(this.bootSteps === undefined ? {} : { bootSteps: { ...this.bootSteps } }),
    };
  }
}
