export const RENDER_ROOT: string;
export const SOURCE_ROOTS: readonly string[];
export const SHADER_TEXT: RegExp;
export const RENDERER_PACKAGES: readonly string[];
export const CARRIED_RENDERERS: Readonly<Record<string, string>>;
export function rendererCandidate(path: string): boolean;
export function narrowedRendererHash(paths: readonly string[], read: (path: string) => Buffer): string;
export function publishedRenderer(narrowed: string): string;
export function rendererRevision(root?: string): string;
