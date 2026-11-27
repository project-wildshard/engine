export function candidateTunnelTarget(authority: string, tlsPort: number): {host: string; port: number} | undefined;

export function openQaCandidate(options: {root: string; out: string; candidate: string; build: string}): Promise<{
  server: string;
  preview: string;
  chromiumSPKI: string;
  stats: {pageReads: number; roomTunnels: number};
  deploymentId: string;
  deploymentUrl: string;
  aliasBuild: string;
  serial: number;
  close: () => Promise<void>;
  verify: () => Promise<void>;
}>;
