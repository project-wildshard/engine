import { expect, test } from 'vitest';
import { deviceLines, deviceTable } from '../scripts/devices.mjs';

// DEVICE-TELEMETRY DT5: the journal reader Jake runs against a door's journal.
test('the reader finds client.device lines behind journal prefixes and prints them as a table', () => {
  const journal = [
    'Nov 13 19:01:02 box node[1]: {"at":"server.listening","port":8080}',
    'Nov 13 19:02:03 box node[1]: {"at":"client.device","name":"Friend","body":"p.111","model":"SM-S918B","platform":"Android","gpu":"Adreno (TM) 740","screen":"384x832"}',
    '{"at":"client.device","name":"Jake","body":"p.222","platform":"iOS","browser":"Safari 18"}',
    '{"at":"client.device", cut',
  ].join('\n');
  const lines = deviceLines(journal);
  expect(lines.map(line => line['name'])).toEqual(['Friend', 'Jake']);
  const table = deviceTable(lines).split('\n');
  expect(table).toHaveLength(3);
  expect(table[0]).toMatch(/^name\s+body\s+model\s+platform/u);
  expect(table[1]).toContain('SM-S918B');
  expect(table[1]).toContain('Adreno (TM) 740');
});
