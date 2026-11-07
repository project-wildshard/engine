/** Stable client-only graph inputs shared by declared presentation hosts. */
import { Vector4 } from 'three';

const scalars = new Map<string, { value: number }>(), vectors = new Map<string, { value: readonly Vector4[] }>();
const key = (slug: string, id: string): string => JSON.stringify([slug, id]);
/** The shared scalar identity is declared in the scene section. */
export function sceneScalar(slug: string, id: string): { value: number } {
  const name = key(slug, id); let value = scalars.get(name);
  if (value === undefined) { value = { value: 0 }; scalars.set(name, value); }
  return value;
}
/** A bounded vector input retains one uniform object across source consumers. */
export function sceneVectors(slug: string, id: string, count: number): { value: readonly Vector4[] } {
  if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('Invalid scene vector input size');
  const name = key(slug, id); let value = vectors.get(name);
  if (value === undefined) { value = { value: Array.from({ length: count }, () => new Vector4()) }; vectors.set(name, value); }
  if (value.value.length !== count) throw new Error('Scene vector input size differs');
  return value;
}
/** Read an admitted scalar without creating a new input. */
export function sceneScalarValue(slug: string, id: string): number | undefined { return scalars.get(key(slug, id))?.value; }
