// The page globals the Template 2 smoke reads inside `page.evaluate`: the game's probe
// (src/client/engine/debug/probe.ts) and the worker client's hooks (src/client/game/shardfile/clientWorker.ts), as
// far as the smoke uses them. The kit tsconfig has no DOM; `document` and `Event` are the two DOM names it touches.

import type { BarRow } from '../../scripts/loading-bar-rule.mjs'

type SmokeVec3 = Readonly<Record<'x' | 'y' | 'z', number>>

interface SmokeProbe {
  /** The area the player is in: on a grid page the current cell (T2E-1b), null between cells. */
  readonly area: () => {
    readonly slug: string
    readonly instance: string | null
    readonly targets: readonly {
      readonly panel: string
      readonly solid: boolean
    }[]
    readonly flags: readonly string[]
  } | null
  readonly app: { readonly state: string }
  readonly world?: {
    readonly game: {
      readonly frameCount: number
      readonly camera: { readonly position: SmokeVec3 }
    }
    readonly player: { readonly hover: boolean; readonly hoverBlend: number }
    readonly weapons: {
      readonly tools: readonly {
        readonly id: string
        readonly enabled: boolean
        readonly model?: { readonly visible: boolean }
      }[]
    }
  }
  readonly state: () => {
    readonly player: { readonly pos: SmokeVec3; readonly health: number }
  }
  readonly pose: (pose: {
    readonly x: number
    readonly z: number
    readonly yaw?: number
  }) => Promise<void>
}

declare global {
  var __onlinePlayers:
    | (() => readonly { readonly name: string; readonly modelled: boolean }[])
    | undefined
  var __barLog: readonly BarRow[] | undefined
  var __countLog: readonly { readonly serverFiles: number }[] | undefined
  // ENGINE-MEMORY EM26: src/scripts/memory/uploadRecorder.mjs, shard textures uploaded as decoded RGBA over 1 MB
  var __imageUploads:
    | readonly {
        readonly width: number
        readonly height: number
        readonly bytes: number
        readonly src: string
      }[]
    | undefined
  var __wildshard: SmokeProbe | undefined
  var __workerClientRow: ((name: string) => number | undefined) | undefined
  var __workerClient:
    | (() => {
        readonly savedTick: number
        readonly savedOk: boolean
        readonly frames: number
        readonly framesPerSecond: number
        readonly mainMsP95: number
      })
    | undefined
  var document: {
    readonly visibilityState: string
    dispatchEvent: (event: unknown) => boolean
  }
  var Event: new (type: string) => unknown
  var history: {
    readonly state: unknown
    replaceState: (data: unknown, title: string, url: string) => void
  }
}

export type { SmokeVec3 }
