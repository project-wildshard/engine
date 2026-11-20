/**
 * meta DRIFTWOOD-FPS DF13 (mini-df13, 2026-11-20): the steady per-frame update cuts, each behind its own device slot.
 * Driftwood's phone Low update was 3.8 to 4.6 ms p50 at the bench's 3x CPU against a 3.0 ms line; the frame meter names
 * every system (core/frameCost.ts), and these slots take the largest steady ones that a frame can skip or cache without
 * changing what the player sees. Each slot is read once per page: a saved boolean wins; unset, it follows
 * UPDATE_LEAN_PHONE_LOW at phone Low and is off everywhere else. Every default is off until cooled iPhone pairs decide.
 */
import { jsonSlot } from '../saves/slots';
import { TIER } from './tier';
import { graphicsMode } from './graphicsMode';
import { Frustum, Matrix4, Sphere, type Camera, type Vector3 } from 'three';

export const UPDATE_LEAN_SLOTS = {
  /** RowBodies: an animal outside last frame's view poses its bones at the far cadence (one update in 8); its root moves every update */
  offscreenPose: 'debug.leanOffscreenPose',
  /** NearPlaceholders: re-rank the near views only when the eye moved a metre, the cells' state changed, or a second passed */
  nearPlan: 'debug.leanNearPlan',
  /** FirstHints: re-measure the hinted control once a second, not four times (the controls do not move while shown) */
  hintMeasure: 'debug.leanHintMeasure',
  /** kit figures (a quest speaker): outside last frame's view, the pose programs run one update in 8 with the time between */
  offscreenFigure: 'debug.leanOffscreenFigure',
  /** the minimap repaints at most 15 times a second, not 30 (a turn repainted it every frame at the 30 cap) */
  minimapPaint: 'debug.leanMinimapPaint',
} as const;
export type UpdateLean = keyof typeof UPDATE_LEAN_SLOTS;

/** Unset at phone Low: off until cooled iPhone 13 pairs decide (DF13). */
export const UPDATE_LEAN_PHONE_LOW: Readonly<Record<UpdateLean, boolean>> = { offscreenPose: false, nearPlan: false, hintMeasure: false, offscreenFigure: false, minimapPaint: false };

/** The slot's value: a boolean wins; unset, the phone Low default at phone Low, else off. */
export function updateLean(saved: unknown, phoneLow: boolean, lean: UpdateLean): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow && UPDATE_LEAN_PHONE_LOW[lean];
}

const picked = new Map<UpdateLean, boolean>();
/** Whether `lean` is on for this page; read once. */
export function updateLeanOn(lean: UpdateLean): boolean {
  const known = picked.get(lean);
  if (known !== undefined) return known;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(UPDATE_LEAN_SLOTS[lean], 'device').read(); } catch { /* storage blocked: the default */ }
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  const on = updateLean(saved, phoneLow, lean);
  picked.set(lean, on);
  return on;
}

/** An off-screen pose runs one update in this many (staggered by the caller), as the far animal cadence (poseCadence.ts). */
export const OFFSCREEN_POSE_EVERY = 8;
/** The view test's padding per metre of distance: about 8.5 degrees of turn between two frames. */
export const OFFSCREEN_PAD = 0.15;
const view = new Frustum(), viewMatrix = new Matrix4(), sphere = new Sphere();
/** Whether a sphere at `centre` (`radius` m, padded by its distance from `eye`) is inside `camera`'s last drawn view. In the
 *  update phase the camera still holds last frame's pose (the late phase moves it). */
export function inLastView(camera: Camera, centre: Vector3, radius: number, eye: Vector3): boolean {
  view.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  sphere.center.copy(centre);
  sphere.radius = radius + centre.distanceTo(eye) * OFFSCREEN_PAD;
  return view.intersectsSphere(sphere);
}
