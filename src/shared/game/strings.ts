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
  /** the Wildshard main menu (MAIN-SCREEN, J387 / J399: ENTER THE MMO for every player, then ZONE SELECT, the deck) */
  mainMenu: {
    logo: 'WILDSHARD',
    label: 'Main menu',
    /** J387: "a call to action that's like enter the MMO": the one online world, entered at its home cell or the last place */
    enterMmo: 'ENTER THE MMO',
    enterMmoLine: 'ONE WORLD · EVERY ZONE · LIVE',
    /** J387: "Not shard select, zone select" */
    zoneSelect: 'ZONE SELECT',
    /** J399 (Jake: "2 button enter zone"): the zone deck's and the deep link's big button */
    enterZone: 'Enter zone',
    settings: 'SETTINGS',
    back: 'BACK',
    /** ZS10 (J461, J469): Zone Select's lists across its top; ALL is Developer mode's every-zone list */
    tabs: { label: 'Zone lists', featured: 'FEATURED', popular: 'POPULAR', new: 'NEW', all: 'ALL', empty: 'Nothing here yet' },
    /** J468: the carousel's place, "1 / 8" */
    count: (at: number, of: number): string => `${String(at)} / ${String(of)}`,
    /** E483 (E140 again): the compact Developer switch beside SETTINGS, the same switch as Settings ▸ Developer */
    developer: 'DEV',
    developerLabel: 'Developer mode',
    /** SF60 / G214 (art/menu/round-12-whats-new/B-banner*.jpg): the day's WHAT'S NEW banner under the logo */
    whatsNew: {
      label: "What's new",
      title: "WHAT'S NEW",
      buildLine: (build: string, date: string): string => date === '' ? `ENGINE ${build}` : `ENGINE ${build} · ${date}`,
      hide: 'HIDE UNTIL NEXT BUILD',
    },
  },
  /** SA36 (Jake, grill Q14-Q16): the `/slug/<slug>` page, a link an author shares; MAIN-SCREEN MS3 (J399): the one-zone select,
   *  ZONE SELECT with that one zone's card and thumbnail and ENTER ZONE, which enters the grid at its cell as Zone select does */
  slugPage: {
    menu: 'MAIN MENU',
    /** under ENTER ZONE: what a tap loads, as on the zone deck */
    placed: (name: string): string => `Loads ${name}`,
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
   *  Its Shard select card (dimmed, ENTER WORLD off) and the title's line after a tap to it */
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
    ended: 'The MMO ended unexpectedly last time.',
    /** QB6: the same one line for a standalone world that ended unexpectedly (iOS's memory kill), by its name */
    shardEnded: (name: string): string => `${name} ended unexpectedly last time.`,
    waiting: (name: string): string => `${name} · NOT READY FOR GRID`,
    waitingSelect: 'ENTER THROUGH ZONE SELECT',
    reveal: (home: string): string => `Arriving at ${home}`,
    revealSkip: 'Tap to skip',
    /** G78: the chip above ATTACK on the road and in no-man's land (the weapon is stowed there, G68) */
    safeZone: 'SAFE ZONE',
    /** G119: on the border shimmer while a crossing waits for its durable save, and when that save fails (the crossing retries) */
    saving: 'SAVING…',
    saveFailed: 'SAVE FAILED, RETRY',
    /** ZE8: the gate card's line under a walled cell's name, over its count */
    gatePreparing: 'Preparing to enter',
    /** ZE14: in place of the count, offline, at a cell this device never downloaded */
    gateNotDownloaded: 'Not downloaded',
    off: 'Off',
    on: 'On',
  },
  summary: {
    label: 'Wildshard progress',
    selected: (name: string, earned: number | null): string => `${name.toUpperCase()} · ${earned === null ? 'NOT VISITED' : `${earned} FEATS`}`,
    total: (earned: number): string => `WILDSHARD · ${earned} FEATS`,
    /** J468 ("We want to count feats still"): the zone's count on Zone Select's one line under its name */
    feats: (earned: number): string => `${String(earned)} FEATS`,
  },
} as const;
