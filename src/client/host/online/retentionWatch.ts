// FM5b1 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md, mode 24): does the page's own code still exist? The page publisher signs
// `/code-retention.json` (FM7, src/scripts/code-retention.mjs) with the builds it still carries. This reads it against a fresh verified
// release, at boot and again on each update poll (the shell calls `check` on `ws-live-build`), and says kept, retired or unknown.
// Only a verified file that matches the release's channel and build can say retired; a missing legacy file, a failed read or a bad
// signature is unknown, and never undoes a retirement already verified. Kept code is not a promise of server wire compatibility.
import type { Scope } from '@wildshard/engine/app/scope';
import { codeAvailability, retirementDeadline, type CodeRetention } from '../../../shared/host/codeRetention';

/** What the page knows about its own code. `retireAt` is a signed deadline, never one made up from when the file was signed. */
export interface RetentionView { readonly availability: 'unknown' | 'kept' | 'retired'; readonly retireAt: number | null }
export interface RetentionPorts {
  /** This page's build. */
  readonly build: string;
  /** A fresh, verified read of the release file (its channel and the build the world runs). */
  readonly release: () => Promise<{ readonly channel: CodeRetention['channel']; readonly engineBuild: string }>;
  /** The signed retention file for that release, or null for a legacy page with none (`fetchCodeRetention`). */
  readonly retention: (expected: { readonly channel: CodeRetention['channel']; readonly engineBuild: string }) => Promise<CodeRetention | null>;
  /** The view changed. */
  readonly changed: (view: RetentionView) => void;
}
export interface RetentionWatch {
  /** Read now; a read under way answers instead of starting another. */
  readonly check: () => Promise<RetentionView>;
  readonly view: () => RetentionView;
}

const UNKNOWN: RetentionView = { availability: 'unknown', retireAt: null };

export function retentionWatch(scope: Scope, ports: RetentionPorts): RetentionWatch {
  let view = UNKNOWN, reading: Promise<RetentionView> | null = null;
  const read = async (): Promise<RetentionView> => {
    try {
      const release = await ports.release();
      const metadata = await ports.retention({ channel: release.channel, engineBuild: release.engineBuild });
      const availability = codeAvailability(metadata, ports.build);
      // a legacy file's silence never undoes a verified retirement; only a verified keep does
      if (availability === 'unknown') return view;
      return { availability, retireAt: availability === 'retired' ? retirementDeadline(metadata) : null };
    } catch { return view; }
  };
  return {
    view: () => view,
    check: () => {
      if (reading !== null) return reading;
      const started = read().then(next => {
        reading = null;
        if (scope.disposed || (next.availability === view.availability && next.retireAt === view.retireAt)) return view;
        view = next; ports.changed(view);
        return view;
      });
      reading = started;
      return started;
    },
  };
}
