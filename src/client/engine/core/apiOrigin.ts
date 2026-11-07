/** Where the game's `/api/*` calls go, set once at build time by `VITE_API_ORIGIN` (api-server's docs/switch.md). */
export type ApiRoute = 'errors' | 'telemetry' | 'inbox';

/** The build value with no trailing slash, '' when it is unset: read on call, since Node hosts have no `import.meta.env`. */
export function apiOrigin(value: unknown = import.meta.env['VITE_API_ORIGIN']): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/u, '') : '';
}

/** The URL of `route`. With no build value the web game stays same-origin. */
export function apiUrl(route: ApiRoute, origin: string = apiOrigin()): string {
  return `${origin}/api/${route}`;
}
