import { expect, test } from 'vitest';
import { freshOnRejoin } from '../src/client/game/shardfile/portalRideBinding';

/** A client's rejoin and frame hooks, driven by hand. */
function fakeClient() {
  const rejoins = new Set<() => void>(), frames = new Set<() => void>();
  return {
    onRejoin: (listener: () => void) => { rejoins.add(listener); return () => { rejoins.delete(listener); }; },
    onFrame: (listener: () => void) => { frames.add(listener); return () => { frames.delete(listener); }; },
    rejoin: () => { for (const run of rejoins) run(); },
    frame: () => { for (const run of frames) run(); },
    listeners: () => rejoins.size + frames.size,
  };
}

test("QA-11-24 row 2: a page's ride starts afresh at a new link's first frame, once per link", () => {
  const client = fakeClient();
  let fresh = 0;
  const off = freshOnRejoin(client, () => { fresh++; });
  client.frame(); client.frame();
  expect(fresh).toBe(0); // the first link's frames keep the ride
  client.rejoin();
  expect(fresh).toBe(0); // the dial alone does not: the room starts the seat afresh when the hello lands
  client.frame();
  expect(fresh).toBe(1); // a blip or a kept-seat reload: welcomed again
  client.frame();
  expect(fresh).toBe(1);
  client.rejoin(); client.rejoin(); client.frame();
  expect(fresh).toBe(2); // dials that failed before one was answered still start it once
  off();
  expect(client.listeners()).toBe(0);
});
