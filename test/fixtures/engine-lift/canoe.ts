import { parseMovers, type MoverData } from '@wildshard/format/movers';
import input from './canoe.json';

function admittedCanoe(): MoverData[number] {
  const row = parseMovers([input])[0];
  if (row === undefined) throw new Error('Missing admitted canoe');
  return row;
}
export const canoeRow = admittedCanoe();
