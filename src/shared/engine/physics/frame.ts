import type { CharacterMotor } from './CharacterMotor';
import type { Physics } from './Physics';
import { withOwner } from '../app/ownership';
/** Frame-local traveller poses are retained by their existing gameplay owner. */
export interface FrameMember { position: { x: number; y: number; z: number }; motor: CharacterMotor }
/** A prepared motor set can be abandoned without changing any source collider or controller. */
export interface PreparedFrameMotors { commit: () => void; cancel: () => void }
/** Prepare rider and optional mount together; source bodies remain authoritative until the synchronous commit. */
export function prepareFrameMotors(members: readonly FrameMember[], physics: Physics, delta: { x: number; z: number }): PreparedFrameMotors {
  if (members.length === 0 || members.length > 2 || new Set(members.map((m) => m.motor)).size !== members.length || ![delta.x, delta.z].every(Number.isFinite)) throw new RangeError('Invalid frame travel unit');
  const pending: CharacterMotor[] = [];
  let closed = false;
  try {
    for (const member of members) {
      // The transfer transaction owns this motor (cancel, commit and later frame retirement).
      // A page callback's ambient scope must not remove its collider before that retirement.
      const replacement = withOwner(null, () => member.motor.transferTo(physics, { x: member.position.x + delta.x, y: member.position.y, z: member.position.z + delta.z }));
      replacement.setEnabled(false); pending.push(replacement);
    }
  } catch (error) { for (const motor of pending) motor.dispose(); throw error; }
  return {
    commit: () => {
      if (closed) throw new Error('Frame motors already retired');
      // Refresh from the moving source at the fixed-step boundary, rather than using the asynchronous prepare pose.
      for (let i = 0; i < members.length; i++) {
        const member = members[i], replacement = pending[i];
        if (member === undefined || replacement === undefined) throw new Error('Missing prepared frame member');
        replacement.syncTransfer(member.motor, { x: member.position.x + delta.x, y: member.position.y, z: member.position.z + delta.z });
      }
      closed = true;
      for (let i = 0; i < members.length; i++) {
        const member = members[i], replacement = pending[i];
        if (member === undefined || replacement === undefined) continue;
        member.motor.dispose(); member.motor = replacement; member.position.x += delta.x; member.position.z += delta.z;
      }
    },
    cancel: () => { if (closed) return; closed = true; for (const motor of pending) motor.dispose(); },
  };
}
