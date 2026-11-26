// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { latestReleaseRef, receiptNeeded, refreshReminderRefs, releaseDue, releaseDueFromRefs, reminderLine, reminderPlist } from '../src/scripts/release-due.mjs';
const cutAt = '2026-11-17T15:00:00.000Z', cut = Date.parse(cutAt), hour = 3_600_000;
const latest = { tag: 'v0.1.36', build: '6'.repeat(40), cutAt, newCommits: 2 };
describe('the release due window', () => {
  it('opens at four hours, becomes overdue at eight, and keeps on-demand available', () => {
    expect(releaseDue(latest, cut + 4 * hour - 1).status).toBe('waiting');
    expect(releaseDue(latest, cut + 4 * hour).status).toBe('due');
    expect(releaseDue(latest, cut + 8 * hour - 1).status).toBe('due');
    expect(releaseDue(latest, cut + 8 * hour).status).toBe('overdue');
    expect(releaseDue(latest, cut).onDemand).toBe(true);
  });
  it('does not demand an empty release even after the deadline', () => {
    expect(releaseDue({ ...latest, newCommits: 0 }, cut + 20 * hour).status).toBe('no-change');
  });
  it('uses Cancún and rejects invalid inputs', () => {
    expect(reminderLine(releaseDue(latest, cut))).toContain('Cancún');
    expect(reminderLine(releaseDue(latest, cut))).not.toContain('UTC');
    expect(() => releaseDue({ ...latest, cutAt: 'bad' }, cut)).toThrow();
    expect(() => releaseDue({ ...latest, newCommits: -1 }, cut)).toThrow();
  });
  it('chooses semantic versions across tags and prepared branches, ignoring unrelated refs', () => {
    expect(latestReleaseRef(['refs/tags/v0.1.9', 'refs/tags/v0.1.36', 'refs/remotes/origin/release/v0.1.37', 'refs/heads/plan/release-v0.1.99', 'refs/tags/v0.1.38-rc.1'])).toBe('refs/remotes/origin/release/v0.1.37');
    expect(latestReleaseRef(['refs/tags/server-staging-a'])).toBeUndefined();
  });
  it('starts the clock from a staging cut even when production still serves an older tag', () => {
    const staged = 'refs/remotes/origin/release/v0.1.69', build = 'b'.repeat(40);
    const output = new Map([
      [`rev-parse ${staged}^{commit}`, build],
      [`show -s --format=%ct ${build}`, String(cut / 1000)],
      [`rev-list --no-merges --count ${build}..refs/remotes/origin/main`, '2'],
    ]);
    const git = (args: string[]) => {
      const value = output.get(args.join(' '));
      if (value === undefined) throw new Error(`Unexpected Git call: ${args.join(' ')}`);
      return value;
    };
    const refs = ['refs/tags/v0.1.64', staged];
    expect(releaseDueFromRefs(refs, git, cut + 4 * hour - 1)).toMatchObject({ tag: 'v0.1.69', build, status: 'waiting', newCommits: 2 });
    expect(releaseDueFromRefs(refs, git, cut + 4 * hour).status).toBe('due');
  });
  it('logs one due and one overdue receipt per cut without another state store', () => {
    const due = releaseDue(latest, cut + 5 * hour), first = receiptNeeded(due, '');
    expect(first.needed).toBe(true);
    const previous = `20:00 UTC codex-ms NOTE ${first.marker} green main cut due\n`;
    expect(receiptNeeded(due, previous).needed).toBe(false);
    expect(receiptNeeded(releaseDue(latest, cut + 8 * hour), previous).needed).toBe(true);
    expect(receiptNeeded(releaseDue(latest, cut), '').needed).toBe(false);
  });
  it('refreshes main, release branches and tags for the scheduled check', () => {
    const calls: { args: string[]; root: string }[] = [];
    expect(refreshReminderRefs('/engine', (args, root) => {
      calls.push({ args, root });
      return '';
    })).toBe(true);
    expect(calls).toEqual([{
      args: [
        'fetch', '--quiet', '--no-write-fetch-head', '--no-recurse-submodules', '--tags', 'origin',
        'refs/heads/main:refs/remotes/origin/main',
        '+refs/heads/release/*:refs/remotes/origin/release/*',
      ],
      root: '/engine',
    }]);
  });
  it('reports a failed fetch as stale', () => {
    expect(refreshReminderRefs('/engine', () => {
      throw new Error('origin is unavailable');
    })).toBe(false);
  });
  it('installs a report-only job using stable nvm and escaped XML paths', () => {
    const plist = reminderPlist('/Users/a&b/engine', '/Users/a&b');
    expect(plist).toContain('/Users/a&amp;b/.nvm/nvm-exec');
    expect(plist).toContain('<string>--receipt</string>');
    expect(plist).toContain('<integer>1800</integer>');
    expect(plist).not.toContain('--prepare');
    expect(plist).not.toContain('--finish');
    expect(plist).not.toContain('TOKEN');
  });
});
