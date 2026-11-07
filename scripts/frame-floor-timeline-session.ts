import { startWebKitTimeline, TimelineRecordingError, type TimelinePort, type WebKitTimeline } from './frame-floor-webkit-timeline.mjs';

type Evaluate = (expression: string) => Promise<unknown>;
interface Segment {
  readonly controller: AbortController;
  ready: Promise<void>;
  stop?: () => Promise<WebKitTimeline>;
  partial?: WebKitTimeline;
  failure?: unknown;
}

/** Follow concrete Inspector connections and page targets, never replaying game
 * evaluations. Each target owns separate clocks and a retained raw segment. */
export function createWebKitTimelineSession(): {
  attach: (port: TimelinePort, evaluate: Evaluate) => void;
  start: () => Promise<() => Promise<WebKitTimeline>>;
  close: () => void;
} {
  let port: TimelinePort | undefined, evaluate: Evaluate | undefined;
  let offTarget: (() => void) | undefined, running = false, current: Segment | undefined;
  let segments: Segment[] = [];
  const abandon = (reason: string): void => { current?.controller.abort(new Error(reason)); };
  const begin = (): void => {
    if (port === undefined || evaluate === undefined) throw new Error('Timeline has no Inspector connection');
    const controller = new AbortController();
    const next: Segment = { controller, ready: Promise.resolve() };
    next.ready = (async () => {
      try { next.stop = await startWebKitTimeline(port, evaluate, controller.signal); }
      catch (error) {
        next.failure = error;
        if (error instanceof TimelineRecordingError) next.partial = error.timeline;
      }
    })();
    current = next; segments.push(next);
  };
  return {
    attach(nextPort, nextEvaluate) {
      abandon('Inspector connection replaced'); offTarget?.();
      port = nextPort; evaluate = nextEvaluate;
      offTarget = port.on('Target.changed', () => {
        abandon('Inspector target changed');
        if (running) begin();
      });
      if (running) begin();
    },
    async start() {
      if (running) throw new Error('Timeline recording already active');
      running = true; segments = []; begin();
      // Advance only for an actual target/connection transition, never a retry
      // of a failed command or of the measured page evaluation.
      for (;;) {
        const observed = current;
        if (observed === undefined) throw new Error('Timeline segment missing');
        await observed.ready;
        if (current !== observed) continue;
        if (observed.failure !== undefined) { running = false; throw observed.failure instanceof Error ? observed.failure : new Error('Timeline startup failed', { cause: observed.failure }); }
        break;
      }
      return async () => {
        running = false;
        const captures: WebKitTimeline[] = [];
        for (const segment of segments) {
          await segment.ready;
          const capture = segment.stop === undefined ? segment.partial : await segment.stop();
          if (capture !== undefined) captures.push(capture);
        }
        current = undefined;
        const first = captures[0];
        if (captures.length === 1 && first !== undefined) return first;
        return { records: captures.flatMap(capture => capture.records), anchors: [],
          segments: captures, incomplete: ['Inspector target changed; clock segments kept separately'] };
      };
    },
    close() { running = false; abandon('Inspector session closed'); offTarget?.(); offTarget = undefined; },
  };
}
