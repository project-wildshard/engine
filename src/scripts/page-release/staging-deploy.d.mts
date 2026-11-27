import type {Phase, QaVerdict} from './flow.mjs';

export const toolsRoot: string;

export function finishQaLeg(options: {
  work: string;
  proof: string;
  name: string;
  code: number | null;
  log: (line: string) => void;
}): QaVerdict;

export function deployStaging(options: {
  root: string;
  build: string;
  release: string;
  source: string;
  out: string;
  observerProof?: string;
  zoneEntryResume?: string;
  localQa?: QaVerdict;
  readState: () => {
    build?: {contentBase?: string};
    upload?: unknown;
    check?: {deployment: {url: string}; serial: number};
  };
  get: (url: string) => Promise<unknown>;
  phase: (name: Phase, qa?: QaVerdict) => Promise<unknown>;
  log: (line: string) => void;
  waitPacks?: () => Promise<void>;
}): Promise<void>;
