export interface NumberPathProbe {
  runtime: { node: string; v8: string; platform: string; arch: string };
  json: { bits: string; wire: string; afterBits: string | null; sameValue: boolean }[];
  math: { op: string; args: number[]; argBits: string[]; bits: string }[];
}
export function captureNumberPathProbe(): NumberPathProbe;
export function capturedNumberPathProbe(): NumberPathProbe | undefined;
