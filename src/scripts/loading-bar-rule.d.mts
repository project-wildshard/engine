export interface ProducerReading {
  readonly kind: string
  readonly done?: number
  readonly total?: number
  readonly bytes?: number
  readonly byteTotal?: number
  readonly complete?: boolean
  readonly configured?: boolean
  readonly adopted?: boolean
  readonly inline?: boolean
  readonly known?: boolean
  readonly rows?: readonly {
    readonly state: string
    readonly fraction?: number
    readonly weight?: number
  }[]
}
export interface BarRow {
  readonly t: number
  readonly bar: string
  readonly pct: number
  readonly step: string
  readonly atomic: number
  readonly bytes: number
  readonly files: number
  readonly work?: string
  readonly source?: ProducerReading
}
export const STALL_MS: number
export const SOFTWARE_GL_STALL_MS: number
export const STEP_PCT: number
export function barStalls(
  log: readonly BarRow[],
  start: number,
  end: number,
  limitMs?: number,
): {
  stalls: { from: number; to: number; ms: number; stages: string[] }[]
  backwards: { t: number; bar: string; from: number; to: number }[]
}
export function untracedChanges(log: readonly BarRow[]): BarRow[]
