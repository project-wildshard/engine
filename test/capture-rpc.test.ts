import { expect, test } from 'vitest';
import { captureRpcObserver, type CaptureRpcStage } from '../scripts/parity/capture-rpc.mjs';

test('native screenshot stages retain durations while discarding image and page payloads', () => {
  const rows: CaptureRpcStage[] = []; let now = 10;
  const observer = captureRpcObserver(row => { rows.push(row); }, () => now);
  expect(observer.line('ordinary browser warning')).toBe(false);
  observer.line('pw:protocol SEND ► {"id":1,"method":"Page.getLayoutMetrics","sessionId":"a"}');
  now = 12;
  observer.line('\u001B[32mpw:protocol RECV ◀ {"id":1,"sessionId":"a","result":{"privatePageValue":"redact"}}\u001B[39m');
  observer.line('pw:protocol SEND ► {"id":2,"method":"Page.captureScreenshot","sessionId":"a","params":{"format":"png"}}');
  now = 32;
  observer.line('pw:protocol RECV ◀ {"id":2,"sessionId":"a","result":{"data":"private-image-bytes"}}');
  observer.finish();
  expect(rows).toEqual([
    { stage: 'Page.getLayoutMetrics', state: 'sent', sequence: 1, ms: 0 },
    { stage: 'Page.getLayoutMetrics', state: 'received', sequence: 1, ms: 2 },
    { stage: 'Page.captureScreenshot', state: 'sent', sequence: 2, ms: 0 },
    { stage: 'Page.captureScreenshot', state: 'received', sequence: 2, ms: 20 },
  ]);
  expect(JSON.stringify(rows)).not.toContain('private');
});

test('a stalled RPC stays unfinished and session identities cannot complete each other', () => {
  const rows: CaptureRpcStage[] = []; let now = 0;
  const observer = captureRpcObserver(row => { rows.push(row); }, () => now);
  observer.line('pw:protocol SEND ► {"id":2,"method":"Page.captureScreenshot","sessionId":"a"}');
  observer.line('pw:protocol RECV ◀ {"id":2,"sessionId":"b","result":{}}');
  now = 10000; observer.finish(); observer.finish();
  expect(rows.at(-1)).toEqual({ stage: 'Page.captureScreenshot', state: 'unfinished', sequence: 1, ms: 10000 });
  expect(rows).toHaveLength(2);
});

test('the retained CI overrun belongs to native capture rather than layout', () => {
  const rows: CaptureRpcStage[] = []; let now = 0;
  const observer = captureRpcObserver(row => { rows.push(row); }, () => now);
  observer.line('pw:protocol SEND ► {"id":1,"method":"Page.getLayoutMetrics","sessionId":"nine"}');
  now = 499.401708;
  observer.line('pw:protocol RECV ◀ {"id":1,"sessionId":"nine","result":{}}');
  observer.line('pw:protocol SEND ► {"id":2,"method":"Page.captureScreenshot","sessionId":"nine"}');
  now += 10689.834125;
  observer.line('pw:protocol RECV ◀ {"id":2,"sessionId":"nine","result":{"data":"redacted"}}');
  observer.finish();
  expect(rows[1]?.stage).toBe('Page.getLayoutMetrics');
  expect(rows[1]?.ms).toBeCloseTo(499.401708, 6);
  expect(rows[3]?.stage).toBe('Page.captureScreenshot');
  expect(rows[3]?.ms).toBeCloseTo(10689.834125, 6);
  expect(rows[3]?.ms).toBeGreaterThan(10000);
});

test('malformed, unrelated and explicit error records cannot imply a successful capture', () => {
  const rows: CaptureRpcStage[] = [];
  const observer = captureRpcObserver(row => { rows.push(row); }, () => 0);
  for (const line of ['pw:protocol malformed', 'pw:protocol RECV ◀ null', 'pw:protocol SEND ► {"id":3,"method":"Runtime.evaluate","params":{"expression":"private"}}']) expect(observer.line(line)).toBe(true);
  expect(rows).toEqual([]);
  observer.line('pw:protocol SEND ► {"id":4,"method":"Page.getLayoutMetrics"}');
  observer.line('pw:protocol RECV ◀ {"id":4,"error":{"message":"refused"}}');
  expect(rows.at(-1)?.state).toBe('refused');
});
