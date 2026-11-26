export function certificateSpki(certificate: Buffer | string): string;
export function chromiumCandidateArgs(args: readonly string[], spki: string | undefined): string[];
export function bindCandidateBrowser(transport: {
  server: string;
  preview: string;
  chromiumSPKI: string | undefined;
}): () => void;
