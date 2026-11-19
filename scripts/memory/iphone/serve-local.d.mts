/** The tailnet name from `tailscale status --json`; throws when Tailscale is down or the tailnet issues no certificate. */
export function tailnetName(json: string): string;
