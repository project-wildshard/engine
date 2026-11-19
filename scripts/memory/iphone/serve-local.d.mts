/** The tailnet name from `tailscale status --json`; throws when Tailscale is down or the tailnet issues no certificate. */
export function tailnetName(json: string): string;

/** The generated page origin from cloudflared's announced quick tunnel. */
export function quickTunnelOrigin(line: string): string | undefined;
