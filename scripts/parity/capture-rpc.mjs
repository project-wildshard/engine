import { stripVTControlCharacters } from 'node:util';

/** @typedef {{stage:string,state:'sent'|'received'|'refused'|'unfinished',sequence:number,ms:number}} CaptureRpcStage */

/** Retain only screenshot RPC timing from Playwright's supported protocol debug stream.
 * Never forward protocol payloads, screenshot bytes, page values or unrelated messages.
 * @param {(row:CaptureRpcStage)=>void} emit @param {()=>number} [now] */
export function captureRpcObserver(emit, now = () => performance.now()) {
  /** @type {Map<string,{stage:string,sequence:number,start:number}>} */
  const pending = new Map();
  let sequence = 0;
  return {
    /** Return true for every protocol line, including discarded payloads.
     * @param {string} line */
    line(line) {
      if (!line.includes('pw:protocol')) return false;
      const text = stripVTControlCharacters(line), start = text.indexOf('{');
      if (start === -1) return true;
      /** @type {unknown} */ let row;
      try { row = JSON.parse(text.slice(start)); } catch { return true; }
      if (row === null || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) return true;
      const session = 'sessionId' in row && typeof row.sessionId === 'string' ? row.sessionId : '';
      const key = `${session}:${row.id}`;
      if (line.includes('SEND') && 'method' in row && (row.method === 'Page.getLayoutMetrics' || row.method === 'Page.captureScreenshot')) {
        const record = { stage: row.method, sequence: ++sequence, start: now() };
        pending.set(key, record);
        emit({ stage: record.stage, state: 'sent', sequence: record.sequence, ms: 0 });
      } else if (line.includes('RECV')) {
        const record = pending.get(key);
        if (record === undefined) return true;
        pending.delete(key);
        emit({ stage: record.stage, state: 'error' in row ? 'refused' : 'received', sequence: record.sequence, ms: now() - record.start });
      }
      return true;
    },
    finish() {
      for (const record of pending.values()) emit({ stage: record.stage, state: 'unfinished', sequence: record.sequence, ms: now() - record.start });
      pending.clear();
    },
  };
}
