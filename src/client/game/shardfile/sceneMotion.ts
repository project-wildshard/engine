import { createClientChannelView } from '../plugin/clientChannelView';
import { Vector3 } from 'three';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { FollowedMovers } from '../plugin/followedMovers';
import type { Scope } from '@wildshard/engine/app/scope';
import { parseSceneMotion, type SceneMotion } from '@wildshard/format/sceneMotion';
import { bindClientChannels } from '../plugin/ui';
import { createClientChannels } from '../../../shared/game/plugin/channels';
import type { ShardContext } from '../plugin/context';
import type { DeclaredPage } from '../quest/declaredPage';
import type { SceneHandles } from './sceneHandles';

type Channels = ReturnType<typeof bindClientChannels>;
const books = new WeakMap<Scope, Map<string, SceneMotionBinding>>();

/** Internal client-only motion owner. Scene refs bind views; the existing native
 * mover owner retains every body, fixed step, command and continuation. */
export class SceneMotionBinding {
  readonly channels: Channels;
  readonly prompts: Map<string, ReturnType<Channels['prompt']>> = new Map<string, ReturnType<Channels['prompt']>>();
  private readonly groups = new Map<string, Channels>();
  private readonly frames: readonly {
    readonly id: string;
    readonly run: (flags: Flags, delta: number, time: number) => void;
  }[];
  private page: DeclaredPage | undefined;
  private nativeMotion: FollowedMovers | undefined;
  get motion(): FollowedMovers | undefined {
    if (this.ctx.scope.disposed) throw new Error('Scene motion owner is disposed'); return this.nativeMotion;
  }
  constructor(private readonly ctx: ShardContext, readonly rows: SceneMotion, handles: SceneHandles) {
    const programs = ctx.product.shardfile.clientChannels ?? [];
    const declared = new Map(programs.map(row => [row.id, row]));
    for (const group of rows.groups) {
      for (const id of group.nativeOwners.concat(group.copiedOwners)) if (!ctx.product.shardfile.movers.some(row => row.id === id))
        throw new Error(`Missing declared motion owner ${id}`);
      for (const id of group.programs) {
        const row = declared.get(id);
        if (row === undefined) throw new Error(`Missing declared channel program ${id}`);
        if (row.numeric !== undefined) throw new Error('Scene motion requires typed transform publications');
      }
      for (const id of Object.values(group.targets)) handles.object(id);
      for (const row of group.initial) {
        if (!group.programs.includes(row.program)) throw new Error('Motion seed requires its group program');
        handles.point(row.at, new Vector3());
      }
      for (const row of group.prompts) {
        const prompt = group.programs.map(id => declared.get(id)?.prompt).find(candidate => candidate?.id === row.id);
        if (prompt?.action.kind !== 'named') throw new Error('Page motion prompt requires a named action');
      }
      for (const row of group.observations) {
        const program = declared.get(row.program);
        if (!group.programs.includes(row.program) || program?.mover === undefined || !group.nativeOwners.includes(program.mover)
          || !program.channels.some(channel => channel.property === row.channel)) throw new Error('Motion observation requires its native channel');
        handles.number(row.value);
      }
    }
    this.frames = rows.frames.filter(frame => frame.cube === undefined || frame.cube === (ctx.cube === null ? 'standalone' : 'cell')).map(frame => {
      const program = declared.get(frame.program);
      if (program === undefined || program.numeric !== undefined || program.mover !== undefined || program.prompt !== undefined)
        throw new Error('Frame motion requires a declared presentation program');
      if (program.reads.length !== Object.keys(frame.inputs).length || program.reads.some(id => !Object.hasOwn(frame.inputs, id)))
        throw new Error('Frame motion requires its exact copied input book');
      const inputs = program.reads.map(id => {
        const source = frame.inputs[id]; if (source === undefined) throw new Error('Missing frame input');
        if ('flag' in source) {
          if (!ctx.product.shardfile.quests.flags.includes(source.flag)) throw new Error('Undeclared frame flag');
          return (flags: Flags): number => Number(flags.has(source.flag));
        }
        if ('mode' in source) return (): number => Number(ctx.app.player?.mode === source.mode);
        const object = handles.object(source.part), property = source.property;
        return (): number => {
          if (property === 'x' || property === 'y' || property === 'z') return object.position[property];
          if (property === 'yaw') return object.rotation.y;
          if (property === 'pitch') return object.rotation.x;
          return object.rotation.z;
        };
      });
      const lane = program.bindings === undefined && program.connectors === undefined && program.geometry === undefined
        ? createClientChannels(program)
        : createClientChannelView(program, new Map(Object.entries(frame.targets).map(([id, part]) => [id, handles.object(part)])));
      const materials = frame.materials.map(row => {
        if (!program.channels.some(channel => channel.property === row.channel)) throw new Error('Missing frame material channel');
        return { ...row, target: handles.standard(row.material) };
      });
      return { id: frame.id, run: (flags: Flags, delta: number, time: number): void => {
        lane.evaluate({ time, delta, values: inputs.map(read => read(flags)) });
        for (const row of materials) {
          const value = lane.frame[row.channel]; if (value === undefined) throw new Error('Missing frame material value');
          row.target[row.property] = value;
        }
      } };
    });
    for (const group of rows.groups) {
      const channels = bindClientChannels(group.programs.map(id => {
        const row = declared.get(id); if (row === undefined) throw new Error('Missing admitted motion program'); return row;
      }), {
        targets: new Map(Object.entries(group.targets).map(([id, part]) => [id, handles.object(part)])),
        nativeOwners: group.nativeOwners, copiedOwners: group.copiedOwners, initialPoses: group.rest,
        bindings: group.bindings.map(id => { const child = this.groups.get(id); if (child === undefined) throw new Error('Missing admitted child motion'); return child; }),
        observed: (id, observation) => {
          for (const row of group.observations) if (declared.get(row.program)?.mover === id) {
            const value = observation[row.channel]; if (value === undefined) throw new Error('Missing native scene observation');
            handles.setNumber(row.value, value);
          }
        },
      });
      this.groups.set(group.id, channels);
      ctx.scope.onDispose(channels.dispose);
      if (group.prompts.length > 0) channels.bindPrompts({ named: new Map(group.prompts.map(row => {
        const prompt = group.programs.map(id => declared.get(id)?.prompt).find(candidate => candidate?.id === row.id);
        if (prompt?.action.kind !== 'named') throw new Error('Page motion prompt requires a named action');
        return [prompt.action.name, () => {
          if (this.page === undefined) throw new Error('Motion prompt requires its entered page'); this.page.run(row.action);
        }] as const;
      })) });
      for (const row of group.initial) {
        const at = handles.point(row.at, new Vector3());
        channels.evaluate(row.program, { time: 0, delta: 0, values: [at.x, at.y, at.z] });
      }
      for (const row of group.prompts) {
        const program = group.programs.find(id => declared.get(id)?.prompt?.id === row.id);
        if (program === undefined || this.prompts.has(row.id)) throw new Error('Duplicate or missing motion prompt');
        this.prompts.set(row.id, channels.prompt(program));
      }
    }
    const owner = this.groups.get(rows.owner); if (owner === undefined) throw new Error('Missing declared motion group');
    this.channels = owner;

  }
  bindPage(page: DeclaredPage): void {
    if (this.page !== undefined) throw new Error('Motion page is already bound'); this.page = page;
  }
  /** Install once at the normal play phase, after the original saved flag book. */
  install(flags: Flags): void {
    if (this.nativeMotion !== undefined) throw new Error('Scene motion is already installed');
    const world = this.ctx.game.runtime?.world;
    if (world === undefined || world === null) throw new Error('Scene motion requires its native world');
    this.nativeMotion = this.channels.installMovers(this.ctx, world, this.ctx.product.shardfile, this.rows.installation, flags);
    const frameSystemId = this.rows.installation.frameSystemId;
    if (frameSystemId !== undefined) this.ctx.system({ id: frameSystemId, phase: 'update', run: (delta, time) => {
      for (const frame of this.frames) frame.run(flags, delta, time);
    } });
  }
}

/** Compiled motion.channels feature; the public input is rows and scene identities. */
export function installSceneMotion(ctx: ShardContext, input: unknown, handles: SceneHandles): SceneMotionBinding {
  if (ctx.scope.disposed || books.get(ctx.scope)?.has(ctx.product.slug) === true) throw new Error('Scene motion requires one living entry');
  const rows = parseSceneMotion(input), value = new SceneMotionBinding(ctx, rows, handles);
  let products = books.get(ctx.scope); if (products === undefined) { products = new Map(); books.set(ctx.scope, products); }
  products.set(ctx.product.slug, value);
  const cache = products;
  ctx.scope.onDispose(() => { cache.delete(ctx.product.slug); });
  return value;
}
/** Framework stages borrow the entered owner without keeping a shard plugin. */
export function sceneMotion(ctx: Pick<ShardContext, 'scope' | 'product'>): SceneMotionBinding {
  const value = books.get(ctx.scope)?.get(ctx.product.slug);
  if (ctx.scope.disposed || value === undefined) throw new Error('Scene motion is not installed'); return value;
}
