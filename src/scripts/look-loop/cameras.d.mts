export const SHOTS: readonly string[];
export interface XZ { x: number; z: number }
export interface LookCamera { n: number; id: string; mode: 'fp' | 'god'; x?: number; z?: number; yaw?: number; pitch?: number; pos?: number[]; look?: number[]; up?: number[]; fovV?: number }
export interface LookAnchor { id: string; name?: string; P: XZ; faceTo: XZ; groundY?: number; cameras?: LookCamera[] }
export interface LookCameraFile {
  about?: string; query: string; settings: Record<string, string | number | boolean>;
  fp: { viewport: [number, number]; dpr: number; pitch: number; query: string; tier: string };
  god: { viewport: [number, number]; query: string; tier: string; fovV: number; topUp: number; diagUp: number; diagOut: number; lookAhead: number };
  anchors: LookAnchor[];
}
export function parseCameraFile(value: unknown): LookCameraFile;
export function facing(yaw: number): [number, number];
export function yawTo(from: XZ, to: XZ): number;
export function resolveCameras(def: LookCameraFile, a: { P: XZ; faceTo: XZ }, groundY: number): LookCamera[];
export function resolveMissing(def: LookCameraFile, groundAt: (a: LookAnchor) => number): string[];
export function contextOptions(def: LookCameraFile, mode: 'fp' | 'god', phone: { userAgent: string; isMobile: boolean; hasTouch: boolean }): { deviceScaleFactor: number; viewport: { width: number; height: number }; userAgent?: string; isMobile?: boolean; hasTouch?: boolean };
export function captureName(tag: string, c: { n: number; id: string }): string;
export function parseFlags(argv: string[], known: readonly string[]): Record<string, string | true>;
