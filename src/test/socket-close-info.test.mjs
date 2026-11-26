import { expect, test } from 'vitest';
import { decodeSocketCloseInfo, encodeSocketCloseInfo, SOCKET_CLOSE_REASON_BYTES } from '../shared/engine/net/socketClose.ts';
import { closeCode, closeReason } from '../shared/engine/net/socketFrames.ts';

test('known optional terminal/queue facts preserve existing close codes and unknown numbers', () => {
  for (const [reason, info] of [['full',{code:'queue',position:2}], ['full',{code:'queue',position:1,etaMs:1000}], ['refused',{code:'banned'}], ['refused',{code:'banned',untilMs:4_000_000_000_000}], ['refused',{code:'auth-expired'}]]) {
    const text = encodeSocketCloseInfo(reason,info);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(SOCKET_CLOSE_REASON_BYTES);
    expect(decodeSocketCloseInfo(reason,text)).toEqual(info);
    expect(closeReason(closeCode(reason))).toBe(reason);
  }
  expect(closeCode('full')).toBe(4002); expect(closeCode('refused')).toBe(4001);
  expect(decodeSocketCloseInfo('full',encodeSocketCloseInfo('full',{code:'queue'}))).toEqual({code:'queue'});
});

test('legacy ends and future/malformed metadata always retain generic close behavior', () => {
  for (const text of ['', 'full', '{', '{"v":2,"code":"queue"}', '{"v":1,"code":"future"}', 'x'.repeat(124), '{"v":1,"code":"queue","position":0}', '{"v":1,"code":"queue","etaMs":-1}', '{"v":1,"code":"banned","text":"free form"}']) {
    expect(decodeSocketCloseInfo('full',text)).toBeNull();
  }
  expect(decodeSocketCloseInfo('lost',encodeSocketCloseInfo('refused',{code:'banned'}))).toBeNull();
  expect(encodeSocketCloseInfo('closed',{code:'banned'})).toBe('');
  expect(encodeSocketCloseInfo('full',{code:'queue',etaMs:Infinity})).toBe('');
  expect(encodeSocketCloseInfo('refused')).toBe('');
});
