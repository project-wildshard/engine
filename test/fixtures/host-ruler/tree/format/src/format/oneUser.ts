// HR4 fixture: a format schema only product a reaches.
import { sharedShape } from './shared';

export const oneUserSchema = { ...sharedShape, kind: 'one-user' };

export function readOneUser(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}
