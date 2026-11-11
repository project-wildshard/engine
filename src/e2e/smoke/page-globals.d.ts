// The page globals the Template 2 smoke reads inside `page.evaluate`: the game's probe
// (src/client/engine/debug/probe.ts) and the worker client's hooks (src/client/game/shardfile/clientWorker.ts), as
// far as the smoke uses them. The kit tsconfig has no DOM; `document` and `Event` are the two DOM names it touches.

type SmokeVec3 = Readonly<Record<'x' | 'y' | 'z', number>>

interface SmokeProbe {
  readonly shard: {
    readonly slug: string
    readonly shardfile?: {
      readonly targets: () => readonly { readonly solid: boolean }[]
    }
  }
  readonly app: { readonly state: string }
  readonly world?: { readonly game: { readonly frameCount: number } }
  readonly state: () => {
    readonly player: { readonly pos: SmokeVec3; readonly health: number }
    readonly quest: {
      readonly adventure?: { readonly quest?: readonly string[] }
    }
  }
}

declare global {
  var __wildshard: SmokeProbe | undefined
  var __workerClientRow: ((name: string) => number | undefined) | undefined
  var __workerClient:
    | (() => { readonly savedTick: number; readonly savedOk: boolean })
    | undefined
  var document: {
    readonly visibilityState: string
    dispatchEvent: (event: unknown) => boolean
  }
  var Event: new (type: string) => unknown
}

export type { SmokeVec3 }
