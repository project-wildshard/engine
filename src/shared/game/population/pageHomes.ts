import type { RuntimeSpawns, RuntimeHomeRow } from '@wildshard/format/runtimeSpawns';
import type { ShardContext } from '../../../client/game/plugin/context';
import type { RuntimeHome, RuntimeHomes, RuntimeHomePorts, RuntimeBoss, RuntimeBossOptions, RuntimeActor } from '../plugin/runtimeRows';
import { enteredServices } from '../shard/enteredServices';

type Animals = NonNullable<NonNullable<ShardContext['game']['runtime']>['play']>['animals'];
type Animal = ReturnType<Animals['spawn']>;

/** Who makes this page's runtime bodies: nobody on a server, whose rows are the bodies. */
function bodyOwner(ctx: ShardContext): Animals | undefined {
  const animals = ctx.game.runtime?.play?.animals;
  return animals?.herdless === true ? undefined : animals;
}
/** Existing native body mechanics, shared by guarded runtime adapters and
 * compiled population features. Authored inputs remain admitted spawn rows. */
export function spawnPageHome(animals: Pick<Animals, 'spawn' | 'replace'>, home: RuntimeHome, variant: string | undefined, retained: boolean, decisionActors: readonly string[] = []): Animal {
  const declared = retained || decisionActors.includes(home.id);
  return declared && home.animal !== null ? animals.replace(home.animal, home.x, home.z, home.yaw, variant, {})
    : animals.spawn(home.kind, home.x, home.z, home.yaw, variant, declared ? { entityId: home.id } : undefined);
}
export function bindPageHomes(ctx: ShardContext, declared: RuntimeSpawns, ports: RuntimeHomePorts): RuntimeHomes;
/** Construct the same roster in allocation order, yielding between bodies before publishing the completed keeper. */
export function bindPageHomes(ctx: ShardContext, declared: RuntimeSpawns, ports: RuntimeHomePorts, pause: () => Promise<void>): Promise<RuntimeHomes>;
export function bindPageHomes(ctx: ShardContext, declared: RuntimeSpawns, ports: RuntimeHomePorts, pause?: () => Promise<void>): RuntimeHomes | Promise<RuntimeHomes> {
  const work = pageHomeWork(ctx, declared, ports);
  const advance = (): IteratorResult<void, RuntimeHomes> => work.next();
  if (pause === undefined) { let step = advance(); while (!step.done) step = advance(); return step.value; }
  return (async () => {
    let step = advance();
    while (!step.done) {
      await pause();
      if (ctx.scope.disposed) throw new Error('Runtime home preparation left its owner');
      step = advance();
    }
    return step.value;
  })();
}

function* pageHomeWork(ctx: ShardContext, declared: RuntimeSpawns, ports: RuntimeHomePorts): Generator<void, RuntimeHomes, void> {
  const rows = declared.homes, animals = bodyOwner(ctx), retained = enteredServices.has(ctx);
  const addresses = new Set([...rows, ...(declared.actors ?? []), ...declared.bosses].map(row => row.id));
  const bodyHomes = new Map(ports.bodyHomes?.rows.map(row => [row.id, row.home]));
  if (ports.bodyHomes !== undefined && (ports.bodyHomes.rows.length > 1024 || bodyHomes.size !== ports.bodyHomes.rows.length
    || ports.bodyHomes.rows.some(row => !addresses.has(row.id) || ![row.home.x, row.home.y, row.home.z, row.home.r].every(Number.isFinite) || row.home.r <= 0))) throw new Error('Invalid declared runtime body homes');
  const placements = ports.held?.placements;
  if (placements !== undefined && (ports.held?.late !== undefined || placements.length > 1024 || new Set(placements.map(row => row.id)).size !== placements.length
    || placements.some(row => !ports.held?.order.includes(row.id) || !addresses.has(row.id) || ![row.fromY, row.y].every(Number.isFinite)))) throw new Error('Invalid declared runtime late placements');
  const holds = ports.holds;
  if (holds !== undefined && (holds.rows.length > 1024 || holds.system.length === 0 || holds.rows.some(row => !Number.isInteger(row.home) || row.home < 0 || row.home >= rows.length
    || row.field.length === 0 || row.until.length === 0))) throw new Error('Invalid declared runtime memory holds');
  const dress = (animal: Animal, id: string): void => { const home = bodyHomes.get(id); if (home !== undefined) ports.bodyHomes?.authority?.home(animal.kind, animal, home); };
  const homes: RuntimeHome[] = rows.map((row: RuntimeHomeRow) => ({ id: row.id, kind: row.kind, x: row.at[0], z: row.at[1], yaw: row.yaw, respawn: row.respawn, animal: null, wait: 0 }));
  const look = new Map(rows.map((row) => [row.id, row.look]));
  const spawn = (home: RuntimeHome): void => {
    const variant = look.get(home.id);
    home.animal = animals === undefined ? null : spawnPageHome(animals, home, variant, retained, ports.decisionActors);
    home.wait = 0;
    if (home.animal) { ports.spawned?.(home.animal); dress(home.animal, home.id); }
  };
  const held = new Map<string, NonNullable<Animal>>();
  const cleanup = (): void => { for (const home of homes) if (home.animal) animals?.retire(home.animal); for (const body of held.values()) animals?.retire(body); };
  const forget = ctx.scope.capture('disposers', cleanup);
  const rowBodies = ctx.game.runtime?.play?.animals;
  if (rowBodies?.herdless === true) for (const _model of rowBodies.factory.prepareSteps([...rows, ...declared.actors ?? [], ...declared.bosses].map(row => ({ kind: row.kind, variant: row.look })))) yield;
  for (const home of homes) { spawn(home); yield; }
  // SR12: no death listener. A page's RowBodies is herdless, so no home holds a page body for a death to match: the
  // server's keeper refills homes, and the page draws the rows it sends (flow:creature-returns).
  if (homes.length > 0) {
    ctx.system({ id: ports.system, phase: 'update', run: (dt) => {
      for (const home of homes) {
        if (retained && home.animal?.alive === false && home.wait <= 0) home.wait = home.respawn;
        if (home.wait <= 0) continue;
        home.wait -= dt;
        if (home.wait <= 0) { if (home.animal) animals?.retire(home.animal); spawn(home); }
      }
    } });
  }
  yield* holdBodies(ctx, declared, ports.held, retained, held, dress);
  forget(); ctx.scope.onDispose(cleanup);
  if (holds !== undefined) ctx.system({ id: holds.system, phase: 'update', run: () => {
    for (const row of holds.rows) { const actor = homes[row.home]?.animal; if (actor) actor.mem[row.field] = holds.flags === null || holds.flags.has(row.until) ? 0 : 1; }
  } });

  return { homes, all: () => homes.flatMap((h) => h.animal ? [h.animal] : []), held: (id) => held.get(id) ?? null };
}

/** Spawn the runtime's held one-shot bodies (`RuntimeHomePorts.held`): the early ones now, the late ones after them. */
function* holdBodies(ctx: ShardContext, declared: RuntimeSpawns, hold: RuntimeHomePorts['held'], retained: boolean, held: Map<string, NonNullable<Animal>>, dress: (animal: Animal, id: string) => void): Generator<void, Map<string, NonNullable<Animal>>, void> {
  if (hold === undefined) return held;
  const bosses = new Set(declared.bosses.map((row) => row.id)), native = { identity: 'runtime' } as const;
  const land = (id: string, placement?: { readonly y?: number; readonly fromY?: number }): void => {
    const animal = bosses.has(id) ? bindPageBoss(ctx, declared, id, undefined, native).spawn() : bindPageActor(ctx, declared, id, undefined, native).spawn(placement);
    if (animal) { held.set(id, animal); hold.dress?.(animal, id); dress(animal, id); }
  };
  const late = hold.order.flatMap((id) => { const at = hold.placements?.find(row => row.id === id) ?? hold.late?.(id); return at === undefined ? [] : [{ id, at }]; });
  for (const id of hold.order) if (!late.some((row) => row.id === id)) { land(id); yield; }
  let due = !retained;
  ctx.system({ id: hold.settle, phase: 'fixed.post', run: () => { if (!due) return; due = false; for (const row of late) land(row.id, { fromY: row.at.fromY }); } });
  if (retained) for (const row of late) { land(row.id, { y: row.at.y }); yield; }
  return held;
}

export function bindPageBoss(ctx: ShardContext, declared: RuntimeSpawns, id: string, spawned?: (animal: Animal) => void, options: RuntimeBossOptions = {}): RuntimeBoss {
  const row = declared.bosses.find((boss) => boss.id === id); if (row === undefined) throw new Error(`Undeclared runtime boss ${id}`);
  const animals = bodyOwner(ctx), retained = enteredServices.has(ctx) && options.identity !== 'runtime', [x, z] = row.at;
  return { row,
    spawn: (retired) => {
      const a = retained && retired !== undefined ? animals?.replace(retired, x, z, row.yaw, row.look, {}) ?? null
        : animals?.spawn(row.kind, x, z, row.yaw, row.look, retained ? { entityId: row.id } : undefined) ?? null;
      if (a) spawned?.(a); return a;
    },
    retire: (a) => { animals?.retire(a); } };
}

export function bindPageActor(ctx: ShardContext, declared: RuntimeSpawns, id: string,
  spawned?: (animal: Animal) => void, options: RuntimeBossOptions = {}): RuntimeActor {
  const row = declared.actors?.find((actor) => actor.id === id);
  if (row === undefined) throw new Error(`Undeclared runtime actor ${id}`);
  const animals = bodyOwner(ctx), retained = enteredServices.has(ctx) && options.identity !== 'runtime';
  return { row, spawn: (placement) => {
    const animal = animals?.spawn(row.kind, row.at[0], row.at[1], row.yaw, row.look, { ...placement, ...(retained ? { entityId: row.id } : {}) }) ?? null;
    if (animal !== null) spawned?.(animal);
    return animal;
  }, retire: (animal) => { animals?.retire(animal); } };
}
