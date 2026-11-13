/** Wildshard-owned labels; title summary never imports a shard plugin for its strings. */
export const GAME_STRINGS = {
  developer: {
    ribbon: 'DEVELOPER ONLY',
    banner: (label: string): string => `DEVELOPER ONLY · ${label.toUpperCase()}`,
  },
  /** a draft's COMING SOON card on the title deck (WORLDCLAW-TOOLS W9, J38) */
  drafts: {
    comingSoon: 'Coming soon',
    ribbon: (stage: string): string => `Draft · ${stage}`,
    notPlayable: 'Not yet playable',
    followBuild: 'Follow the build',
    draftMode: 'Draft mode',
  },
  /** the Wildshard main menu (SF21a, G79 / G88: Jake's board B; the grid entry is "Infinite Wildshard" everywhere players see it) */
  mainMenu: {
    logo: 'WILDSHARD',
    label: 'Main menu',
    shardSelect: 'SHARD SELECT',
    infinite: 'INFINITE WILDSHARD',
    /** G61 E1: the amber tag on the Infinite Wildshard card's corner */
    experimental: 'EXPERIMENTAL',
    settings: 'SETTINGS',
    back: 'BACK',
    /** E483 (E140 again): the compact Developer switch beside SETTINGS, the same switch as Settings ▸ Developer */
    developer: 'DEV',
    developerLabel: 'Developer mode',
    /** E7.5 prep: an online build's way into the Connection doctor */
    checkConnection: 'CHECK CONNECTION',
    /** SF60 / G214 (art/menu/round-12-whats-new/B-banner*.jpg): the day's WHAT'S NEW banner under the logo */
    whatsNew: {
      label: "What's new",
      title: "WHAT'S NEW",
      buildLine: (build: string, date: string): string => date === '' ? `ENGINE ${build}` : `ENGINE ${build} · ${date}`,
      hide: 'HIDE UNTIL NEXT BUILD',
    },
  },
  /** SA36 (Jake, grill Q14-Q16): the `/slug/<slug>` page, one shard's card and hero and PLAY, a link an author shares */
  slugPage: {
    menu: 'MAIN MENU',
    play: 'Play',
    /** under PLAY: it enters Infinite Wildshard at the shard's cell, the way Shard select does */
    placed: 'Spawns you on the grid',
    /** Q16: a slug with no grid cell (not placed yet, `--no-place`, an off-grid shard) */
    unplaced: 'Not on the grid yet',
  },
  /** a shard card whose shardfile needs a newer client (G86, temporary): dimmed, a badge and the save promise */
  upgrade: {
    badge: 'NEEDS UPGRADE',
    built: (version: number): string => `BUILT FOR SHARDFILE V${version}`,
    saveKept: 'YOUR SAVE IS KEPT',
  },
  /** G167 (art/grid/round-18-refused-cell): a shard that can't load. Its cell in the grid (B: the frozen grey far view under a
   *  static dome; A: the void and the holo sign) and its SHARD SELECT card (dimmed, an amber UNAVAILABLE badge and the reason) */
  unavailable: {
    sign: 'SHARD UNAVAILABLE',
    badge: 'UNAVAILABLE',
    line: (name: string, reason: string): string => `${name.toUpperCase()} · ${reason}`,
    upgrade: 'NEEDS UPGRADE',
    tooBig: 'TOO BIG FOR THIS DEVICE',
    safety: 'FAILED SAFETY CHECK',
    load: "COULDN'T LOAD",
  },
  /** OFFLINE OF3 (J298): on a world build, a shard the world doesn't open (the grid doesn't place it, or the world's word leaves it out).
   *  Its Shard select card (dimmed, ENTER WORLD off) and the title's line after a `?chunk=` link to it */
  notInWorld: {
    badge: 'Not in this world yet',
    line: (name: string): string => `${name}: Not in this world yet`,
  },
  /** G168 (art/hud/round-22-script-error): a shard script switched off after its strikes. The player's toast, once; with
   *  Developer on, the red strip names the module and its cause */
  script: {
    stopped: 'SOMETHING IN THIS SHARD STOPPED WORKING',
    disabled: (module: string, cause: string, strikes: number): string => `SCRIPT DISABLED · ${module} · ${cause} ×${strikes}`,
    outOfFuel: 'out of fuel',
    callDepth: 'call depth',
    queries: 'too many queries',
    effects: 'too many effects',
    trap: 'trapped',
  },
  /** Infinite Wildshard, the 3 × 3 grid (SHARD-PLATFORM §3.3, G58, G79; SF21a) */
  grid: {
    ended: 'Infinite Wildshard ended unexpectedly last time.',
    /** QB6: the same one line for a standalone world that ended unexpectedly (iOS's memory kill), by its name */
    shardEnded: (name: string): string => `${name} ended unexpectedly last time.`,
    waiting: (name: string): string => `${name} · NOT READY FOR GRID`,
    waitingSelect: 'ENTER THROUGH SHARD SELECT',
    reveal: (home: string): string => `Arriving at ${home}`,
    revealSkip: 'Tap to skip',
    /** G78: the chip above ATTACK on the road and in no-man's land (the weapon is stowed there, G68) */
    safeZone: 'SAFE ZONE',
    /** G119: on the border shimmer while a crossing waits for its durable save, and when that save fails (the crossing retries) */
    saving: 'SAVING…',
    saveFailed: 'SAVE FAILED, RETRY',
    off: 'Off',
    on: 'On',
  },
  summary: {
    label: 'Wildshard progress',
    selected: (name: string, earned: number | null): string => `${name.toUpperCase()} · ${earned === null ? 'NOT VISITED' : `${earned} FEATS`}`,
    total: (earned: number): string => `WILDSHARD · ${earned} FEATS`,
  },
} as const;
