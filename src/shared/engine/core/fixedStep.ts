/** The fixed step (project/archive/2026-09-23-physics.md P2, ENGINE-FIT E2): physics and the characters' moves run at 60 Hz whatever the
 *  frame rate. Its own module so node-side code (tests, bakes) reads it without importing the renderer. */
export const FIXED_STEP: number = 1 / 60;
/** The most fixed steps one frame or wake-up may run; past it the backlog is dropped, so a stall never replays as a burst. */
export const MAX_FIXED_STEPS = 3;
