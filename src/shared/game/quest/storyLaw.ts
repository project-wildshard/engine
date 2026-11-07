import type { QuestStory } from '@wildshard/format/questStory';

/** Forward normalized phase span, including a midnight crossing. */
export function questPhaseSpan(from: number, to: number): number { return ((to - from) % 1 + 1) % 1; }
/** Sample the saved forward clock curve without changing its clock or continuation owner. */
export function questPhaseAt(from: number, span: number, elapsed: number, seconds: number): number {
  const k = Math.min(1, elapsed / seconds);
  return (from + span * (k * k * (3 - 2 * k))) % 1;
}

/** Original seat arithmetic used by rendered and native quests; a terrain seat borrows its real floor query. */
export function questBenchPose(row: QuestStory['bench'], at: { readonly x: number; readonly y: number; readonly z: number }, yaw: number,
  floorAt?: (x: number, z: number) => number): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const x = at.x + Math.sin(yaw) * row.forward, z = at.z + Math.cos(yaw) * row.forward;
  if (row.terrain && floorAt === undefined) throw new Error('Quest seat requires its real terrain floor');
  return { x, y: row.terrain && floorAt !== undefined ? floorAt(x, z) : at.y + row.height, z, yaw: yaw + row.yaw, pitch: row.pitch };
}
