import { type GrapplePorts, type GrappleCourse, type GrappleTarget, type GrappleView, type Side, GrappleSim, DEFAULT_GRAPPLE_MODE, NONE, hookVisible, landingFor, targetFor } from '../../../shared/game/grapple/sim';
import { Tool } from '@wildshard/engine/combat/Tool';
import type { EquipmentRow, EquipContext } from '@wildshard/engine/combat/Equipment';
import { bindRuntimeLedger, projectRuntimeFacts } from '../../../shared/game/plugin/runtimeRows';
import { grappleCourse } from '../../../shared/game/grapple/course';
import type { GrappleClaw } from '../../../shared/game/grapple/feed';
import type { GrappleRows, GrappleProfile, GrappleCourseRow } from '@wildshard/format/grapple';
import * as v from 'valibot';

import {
  AdditiveBlending, CustomBlending, OneFactor, ZeroFactor, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, SphereGeometry, TorusGeometry, Vector2, Vector3, BufferGeometry,
} from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { inState } from '@wildshard/engine/app/systems';
import type { EquipmentHost } from '@wildshard/engine/combat/view/EquipmentHost';
import type { InputContextDef } from '@wildshard/engine/level/context';
import { playerModes } from '@wildshard/engine/player/modes';
import type { DiscSpot, TouchRelabel } from '@wildshard/engine/ui/hudSlots';
import type { ShardContext } from '@wildshard/engine/game/plugin/context';
import { Filament, Rope } from './ribbon';
import { effectField } from '@wildshard/engine/fx/effectField';
import { lentLook, setLentParam } from '../shardfile/lentLooks';
import { prepareGrappleFonts } from './fontPreparation';

type GrappleAimRow = GrappleRows['aim'];
const hintRow = v.object({ label: v.string(), icon: v.exactOptional(v.string()), tone: v.exactOptional(v.picklist(['rest', 'ready', 'active'])), accent: v.exactOptional(v.string()) });
const hints = v.object({ rest: hintRow, ready: hintRow, locked: hintRow, zip: hintRow, armed: hintRow, fire: hintRow });

/** A grapple tool's presentation as data: its hints, chip, markers, toasts, line, FX, system ids and mesh names. */


function makeTracer(ctx: EquipmentHost, row: GrappleAimRow, profile: GrappleProfile, scope: Scope) {
  // Lab P9's fixed-step rope and screen-width ribbon replace the straight world-space cylinders.
  const rope = new Rope(row.ropePoints);
  const line = new Filament(rope.n, row.ribbon, profile.looks.ribbon, row.filament);
  line.mesh.name = `${row.name}:filament`;
  const claw = new Group();
  const brass = new MeshBasicMaterial({ color: row.claw });
  claw.add(new Mesh(new SphereGeometry(0.10, 8, 6), brass));
  for (let i = 0; i < 3; i++) {
    const phi = i * Math.PI * 2 / 3;
    const talon = new Mesh(new ConeGeometry(0.055, 0.30, 5), brass);
    talon.position.set(Math.cos(phi) * 0.075, Math.sin(phi) * 0.075, 0.15);
    talon.rotation.x = Math.PI / 2;
    claw.add(talon);
  }
  const eyelet = new Mesh(new TorusGeometry(0.06, 0.018, 4, 10), brass);
  eyelet.position.z = -0.12;
  claw.add(eyelet);
  claw.name = `${row.name}:flying-claw`;
  line.mesh.visible = claw.visible = false;
  ctx.game.scene.add(line.mesh, claw);
  scope.onDispose(() => {
    line.mesh.removeFromParent(); line.mesh.geometry.dispose(); claw.removeFromParent();
    claw.traverse(part => { if (part instanceof Mesh && part.geometry instanceof BufferGeometry) part.geometry.dispose(); }); brass.dispose();
  });
  const res = new Vector2(), dir = new Vector3(0, 0, 1), forward = new Vector3(0, 0, 1), turn = new Quaternion();
  return {
    reset(start: Vector3): void { rope.reset(start, start); },
    step(dt: number, start: Vector3, end: Vector3, slack: number): void {
      rope.slack = slack;
      dir.subVectors(end, start);
      if (dir.lengthSq() > 1e-6) turn.setFromUnitVectors(forward, dir.normalize());
      // Two fixed substeps keep the line responsive without the lab's 240 Hz capture cost.
      for (let i = 0; i < 2; i++) rope.step(dt / 2, start, end);
    },
    draw(end: Vector3, flying: boolean, pulse: number, time: number): void {
      if (!rope.active) return;
      line.u.uRes.value.copy(ctx.game.renderer.getDrawingBufferSize(res));
      line.u.uProjection.value.set(ctx.game.camera.projectionMatrix.elements[0], ctx.game.camera.projectionMatrix.elements[5]);
      line.u.uPulse.value = pulse;
      line.u.uTime.value = time;
      line.u.uI.value = 1.1;
      line.update(rope);
      line.mesh.visible = true;
      claw.visible = flying; claw.position.copy(end); claw.quaternion.copy(turn);
      claw.rotateZ(time * 3);
    },
    hide(): void { rope.off(); line.mesh.visible = claw.visible = false; },
  };
}

/** Content owns visibility and labels; the engine owns screen projection. */
class Pin {
  readonly el = document.createElement('div');
  point: Vector3 | null = null;
  private shown = false; private text = ''; private tone = '';
  constructor(style: Readonly<Record<string, string>>, className: string) {
    this.el.className = className; Object.assign(this.el.style, style);
  }
  show(on: boolean): void { this.shown = on; }
  at(point: Vector3): void { this.point = point; }
  position(): Vector3 | null { return this.shown ? this.point : null; }
  label(text: string, tone: string, color: string): void {
    if (text !== this.text) { this.text = text; this.el.textContent = text; }
    if (tone !== this.tone) { this.tone = tone; this.el.style.borderColor = color; this.el.style.color = color; }
  }
}

/** Client-only presentation; all rules below are native platform traversal. */
function installGrappleAim(ctx: EquipmentHost, shard: ShardContext, scope: Scope, row: GrappleAimRow, burstData: GrappleRows['bursts'], profile: GrappleProfile, tool: GrappleTool): (course: GrappleCourseRow | null) => void {
  const ports: GrapplePorts = { get physics() { return ctx.physics; }, get body() { return ctx.player; } };
  const fragment = grappleCourse({ ...profile.course, hooks: tool.hooks });
  const modeRow = fragment.mode ?? DEFAULT_GRAPPLE_MODE;
  const facts = profile.fact === undefined ? undefined : projectRuntimeFacts(
    bindRuntimeLedger(shard, shard.product.shardfile, shard.product.slug), shard.game.runtime?.play?.progress);
  const rules = {
    fragment, context: { id: 'grapple', actions: ['lock', 'jump'], blocks: [], touch: { relabel: {} } } satisfies InputContextDef,
    reach: { min: modeRow.minRange, max: modeRow.maxRange, winX: modeRow.windowX, winY: modeRow.windowY },
    timing: { fire: modeRow.fireTime, reel: modeRow.reelTime }, none: NONE,
    enabled: (): boolean => tool.enabled,
    visible: (course: GrappleCourse, eye: Vector3, hook: Vector3): boolean => hookVisible(ports, course, eye, hook),
    landing: (from: Vector3, hook: Vector3, out: Vector3): Side => landingFor(ports, from, hook, out),
    target: (course: GrappleCourse, hook: Vector3, landing: Vector3, side: Side): GrappleTarget => targetFor(ports, course, hook, landing, side),
    traverse: (sim: GrappleClaw, dt: number): boolean => {
      const settling = sim.phase === 'settle' && sim.target?.lifts === true;
      const owned = sim.traverse(dt);
      if (settling && sim.phase === 'idle' && profile.fact !== undefined && facts !== undefined) facts(profile.fact.name, profile.fact.entity);
      return owned;
    },
    cue: (cue: keyof GrappleProfile['cues']): void => { shard.app.audio?.cue(profile.cues[cue]); },
  };
  const { min: MIN_RANGE, max: MAX_RANGE, winX: WIN_X, winY: WIN_Y } = rules.reach;
  const { fire: FIRE_TIME, reel: REEL_TIME } = rules.timing;
  const MARKS = row.marks, H = v.parse(hints, row.hints);
  prepareGrappleFonts(row);
  let hooks = fragment.hooks;
  // the camera as the aim (read live, as the Tool always did)
  const view: GrappleView = {
    get eye() { return ctx.game.camera.position; },
    update: () => { ctx.game.camera.updateMatrixWorld(true); },
    project: (point, out) => out.copy(point).project(ctx.game.camera),
    forward: (out) => ctx.game.camera.getWorldDirection(out),
  };
  const tracer = makeTracer(ctx, row, profile, scope);
  const touchUi = document.getElementById('hud')?.classList.contains('touch') === true;
  const chip = new Pin(row.chip.style, row.chip.className);
  const marks: Pin[] = [];
  for (let i = 0; i < MARKS; i++) {
    const m = new Pin(row.mark.style, row.mark.className);
    m.label(row.mark.glyph, 'mark', row.mark.color); marks.push(m);
    shard.hud.pin(() => m.position(), m.el);
  }
  shard.hud.pin(() => chip.position(), chip.el);
  const input = shard.app.input;
  const context: InputContextDef & { touch: { relabel: Partial<Record<DiscSpot, TouchRelabel>> } } = { ...rules.context, touch: { relabel: {} } };
  // SF34: the tool is the platform's grapple mode: its context, its LOCK disc and its zip (the fixed step's traversal)
  const mode = playerModes(ctx.player).register({ id: 'grapple', hud: 'lock', context, traverse: zip }, scope, { events: shard.app.events, input });
  let restLabel: (() => void) | undefined;
  const enabled = (): boolean => rules.enabled() && ctx.enabled() && inState('play', 'practice', 'playground')(shard.app);
  // ── the reach cache: per hook, its screen spot this frame (cheap), and its sight + landing from the round robin ──
  let n = hooks.length;
  let ndcX = new Float32Array(n), ndcY = new Float32Array(n), dist = new Float32Array(n);
  let inView = new Uint8Array(n), reach = new Uint8Array(n), hasLanding = new Uint8Array(n);
  let landings = hooks.map(() => new Vector3()), landedFrom = hooks.map(() => new Vector3(Infinity, 0, 0));
  let cursor = 0;
  let candidate = -1;
  const ndc = new Vector3();

  let time = 0;
  let biteAge = Infinity;
  let hintShown: TouchRelabel | null | undefined; // the LOCK hint last handed to the touch layer (undefined: none yet)
  const up = new Vector3();
  const muzzle = new Vector3(), tip = new Vector3(), screen = new Vector2();
  const fields = Object.fromEntries(Object.entries(burstData).map(([id, data]) => {
    const material = lentLook(profile.looks[id as keyof GrappleRows['bursts']]);
    material.blending = CustomBlending; material.blendSrc = OneFactor; material.blendDst = OneFactor;
    material.blendSrcAlpha = ZeroFactor; material.blendDstAlpha = OneFactor; material.depthTest = id === 'sparks';
    const field = effectField(data, material); field.object.renderOrder = id === 'sparks' ? 11 : 12;
    scope.own(field.geometry);
    return [id, field];
  }));
  const muzzleFlash = fields['muzzle'], biteFlash = fields['bite'], dockFlash = fields['dock'], sparks = fields['sparks'];
  if (muzzleFlash === undefined || biteFlash === undefined || dockFlash === undefined || sparks === undefined) throw new Error('Missing grapple burst rows');
  const bursts = [muzzleFlash, biteFlash, dockFlash, sparks];
  const lockHalo = new Mesh(new RingGeometry(0.18, 0.25, 24), new MeshBasicMaterial({
    color: row.halo, transparent: true, opacity: 0.72, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
  }));
  lockHalo.name = `${row.name}:lock-halo`;
  scope.own(lockHalo.geometry); scope.own(lockHalo.material);
  scope.onDispose(() => { lockHalo.removeFromParent(); });
  lockHalo.visible = false;
  ctx.game.scene.add(lockHalo);
  ctx.game.scene.add(...bursts.map(field => field.object));
  const hideCues = (): void => { chip.show(false); for (const m of marks) m.show(false); };
  // the law (the caller's); the view draws, sounds and animates what it does
  // G946: the browser keeps its existing rise-to-ring zip; no player variant.
  let sim: GrappleClaw = tool.claw?.(fragment) ?? new GrappleSim(ports, fragment, { rise: () => true }); tool.sim = sim;
  const callbacks = {
    fire: () => { muzzleFlash.burst(muzzle, up.set(0, 1, 0), 0); rules.cue('fire'); ctx.arms?.playLeft?.('grapple_fire'); ctx.arms?.setClawVisible?.(false); },
    miss: () => { ctx.toast(row.toasts.miss); },
    bite: () => { biteAge = 0; biteFlash.burst(sim.target?.hook ?? sim.missEnd, up.set(0, 1, 0), 0); sparks.burst(sim.target?.hook ?? sim.missEnd, up, 0); rules.cue('bite'); ctx.arms?.playLeft?.('grapple_hold'); },
    zip: () => { rules.cue('zip'); },
    reel: () => { rules.cue('reel'); },
    dock: () => { dockFlash.burst(muzzle, up.set(0, 1, 0), 0); rules.cue('dock'); },
    release: (active: boolean) => {
      if (active) rules.cue('dock');
      tracer.hide(); hideCues();
      lockHalo.visible = false; for (let i = 0; i < 4; i++) { const field = bursts[i]; if (field !== undefined) field.object.visible = false; }
      ctx.arms?.playLeft?.('idle'); ctx.arms?.setClawVisible?.(true);
    },
  };
  const flushEvents = (): void => {
    for (const event of sim.drainEvents()) {
      if (event.kind === 'release') callbacks.release(event.active); else callbacks[event.kind]();
    }
  };
  // the course's hooks and the grapple's phase, for captures and native bakes
  shard.debug.expose(row.debug, { hooks: () => sim.course.hooks.map(({ x, y, z }) => ({ x, y, z })), phase: () => sim.phase });
  const tipAt = (): void => {
    muzzle.fromArray(row.muzzle).applyQuaternion(ctx.game.camera.quaternion).add(ctx.game.camera.position);
    const goal = sim.target?.hook ?? sim.missEnd;
    if (sim.phase === 'fire') tip.copy(muzzle).lerp(goal, Math.min(1, sim.clock / FIRE_TIME) ** 0.8);
    else if (sim.phase === 'reel') {
      const u = Math.min(1, sim.clock / REEL_TIME);
      const ease = u * u * (3 - 2 * u);
      tip.copy(sim.missEnd).lerp(muzzle, ease);
      tip.y -= Math.sin(Math.PI * u) * 1.2;
    } else if (sim.phase === 'dock') tip.copy(muzzle);
    else tip.copy(goal);
  };
  const setCourse = (value: GrappleCourseRow | null): void => {
    const next = value === null ? fragment : grappleCourse({ ...value,
      ...(value.mode === undefined && profile.course.mode !== undefined ? { mode: profile.course.mode } : {}) });
    if (next === sim.course) return;
    if (sim.phase !== 'idle' || sim.holding()) { sim.release(); flushEvents(); }
    sim.course = next; hooks = next.hooks; n = hooks.length;
    ndcX = new Float32Array(n); ndcY = new Float32Array(n); dist = new Float32Array(n);
    inView = new Uint8Array(n); reach = new Uint8Array(n); hasLanding = new Uint8Array(n);
    landings = hooks.map(() => new Vector3()); landedFrom = hooks.map(() => new Vector3(Infinity, 0, 0));
    cursor = 0; candidate = -1;
  };
  /** the touch discs follow the verb: LOCK / READY / LOCKED (+ ZIP on JUMP) / ARMED (+ FIRE) */
  const hint = (lock: TouchRelabel | null): void => {
    if (lock === hintShown) return;
    hintShown = lock;
    if (typeof restLabel === 'function') restLabel();
    restLabel = undefined;
    const active = lock !== null && lock !== H.rest;
    mode.context(active);
    const jump = lock === H.locked ? H.zip : lock === H.armed ? H.fire : null;
    context.touch.relabel = { ...(lock === null ? {} : { lock }), ...(jump === null ? {} : { jump }) }; // the HUD reads it next frame (MF14)
    if (lock === H.rest) restLabel = shard.hud.relabel('lock', lock.label, '', lock);

  };

  /** the cached candidate, checked afresh (its sight and landing) at the moment LOCK is pressed */
  const pickCandidate = (): GrappleTarget | null => {
    if (candidate < 0) return null;
    const hook = hooks[candidate];
    if (hook === undefined || !rules.visible(sim.course, ctx.game.camera.position, hook)) return null;
    const landing = new Vector3();
    const side = rules.landing(ctx.player.position, hook, landing);
    return side === rules.none ? null : rules.target(sim.course, hook, landing, side);
  };

  // below would otherwise take the tap, and a zip would leave the room). A playground's room is a practice room too, but
  // it brings its own course (E307): the claw works there
  let inPractice = false;
  shard.app.events.on('practice.active', (on) => { inPractice = on; }, scope);
  const lockPress = (): boolean => {
    if (!enabled() || (inPractice && sim.course === fragment)) return false;
    // Once a crossing starts the law keeps it until a safe landing or bailout (lock: 'busy').
    const result = sim.lock(view, pickCandidate(), ctx.lock.hasTarget()); flushEvents();
    if (result === 'pass') return false;
    if (result === 'armed') {
      ctx.arms?.playLeft?.('grapple_aim');
      ctx.toast(touchUi ? row.toasts.armedTouch : row.toasts.armedDesk);
    } else if (result === 'locked') {
      ctx.lock.unlock();
      ctx.arms?.playLeft?.('grapple_aim');
      ctx.toast(touchUi ? row.toasts.lockedTouch : row.toasts.lockedDesk);
    }
    return true;
  };

  const jumpPress = (): boolean => {
    if (!enabled()) return false;
    const idle = sim.phase === 'idle';
    if (!sim.fire(view)) return false;
    flushEvents();
    // the claw leaves the muzzle: the line is laid out from there
    if (idle) { tipAt(); tracer.reset(muzzle); }
    return true;
  };

  shard.app.addSystem({ id: row.systems.input, phase: 'input', before: ['engine.lockon.input', 'engine.player.input'], after: ['engine.input.collect'], when: () => enabled(), run: () => {
    if (input.pressed('lock') && lockPress()) input.consume('lock');
    if (input.pressed('jump') && jumpPress()) input.consume('jump');
  } }, scope);
  /** The grapple mode's traversal: while the claw flies, reels or docks, it moves the capsule on the fixed step. */
  function zip(dt: number): boolean {
    if (!enabled() || sim.phase === 'idle') return false;
    const owned = rules.traverse(sim, dt); flushEvents(); return owned;
  }

  shard.app.addSystem({ id: row.systems.rope, phase: 'fixed.post', run: (dt) => {
    flushEvents(); // a wire claw's phases arrive with its frames
    for (let i = 0; i < 4; i++) { const field = bursts[i]; if (field !== undefined) field.update(dt); }
    if (sim.phase === 'idle') return;
    time += dt; biteAge += dt;
    tipAt();
    const slack = sim.phase === 'fire' ? row.slack.fire : sim.phase === 'reel' ? row.slack.reel : row.slack.hold;
    tracer.step(dt, muzzle, tip, slack);
  } }, scope);

  /**
   * The reach scan, once a frame while idle: every hook's range and screen spot (a projection each, no ray), then a
   * round robin of `scanPerFrame` hooks in view whose sight is re-tested and whose landing is re-found (one a frame at
   * most) only once the player has moved `landingStale` from where it was found. Returns the candidate (the reachable
   * hook nearest the centre, inside the window) or -1.
   */
  const scan = (): number => {
    const camera = ctx.game.camera;
    camera.updateMatrixWorld(true);
    const eye = camera.position;
    for (let i = 0; i < n; i++) {
      const hook = hooks[i];
      if (hook === undefined) continue;
      const d = eye.distanceTo(hook);
      dist[i] = d;
      let on = 0;
      if (d >= MIN_RANGE && d <= MAX_RANGE) {
        ndc.copy(hook).project(camera);
        if (ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1.05 && Math.abs(ndc.y) <= 1.05) { on = 1; ndcX[i] = ndc.x; ndcY[i] = ndc.y; }
      }
      inView[i] = on;
      if (on === 0) reach[i] = 0; // out of reach now; re-tested when it comes back
    }
    let landed = 0; // landings re-found this frame (≤ 1: the floor probes are the scan's costly part)
    for (let tried = 0, done = 0; tried < n && done < row.scanPerFrame; tried++) {
      const i = cursor;
      cursor = (cursor + 1) % n;
      const hook = hooks[i];
      const landing = landings[i], from = landedFrom[i];
      if (hook === undefined || landing === undefined || from === undefined || inView[i] === 0) continue;
      done++;
      if (!rules.visible(sim.course, eye, hook)) { reach[i] = 0; continue; }
      if (landed === 0 && from.distanceToSquared(ctx.player.position) > row.landingStale * row.landingStale) {
        landed++;
        hasLanding[i] = rules.landing(ctx.player.position, hook, landing) === rules.none ? 0 : 1;
        from.copy(ctx.player.position);
      }
      reach[i] = hasLanding[i] ?? 0;
    }
    let best = -1, score = Infinity;
    for (let i = 0; i < n; i++) {
      if (reach[i] === 0) continue;
      const x = ndcX[i] ?? 0, y = ndcY[i] ?? 0;
      if (Math.abs(x) > WIN_X || Math.abs(y) > WIN_Y) continue;
      const s = x * x + y * y * 0.55 + (dist[i] ?? 0) * 0.0008;
      if (s < score) { score = s; best = i; }
    }
    return best;
  };

  shard.app.addSystem({ id: row.systems.update, phase: 'update', after: ['training-arena'], before: ['hud.perf', 'engine.world.bounds', 'main.6', 'hud.combat', 'first hints', 'main.frame', 'engine.player.hud'], run: () => {
    if (!enabled()) {
      if (sim.holding() || sim.phase !== 'idle') { sim.release(); flushEvents(); }
      hideCues(); hint(null); candidate = -1;
      return;
    }
    const target = sim.target;
    if (!sim.holding() && sim.phase === 'idle') {
      candidate = scan();
      // the small markers: every reachable hook on screen but the candidate (it wears the chip)
      let used = 0;
      for (let i = 0; i < n && used < MARKS; i++) {
        if (reach[i] === 0 || i === candidate) continue;
        const x = ndcX[i] ?? 0, y = ndcY[i] ?? 0;
        if (Math.abs(x) > 0.96 || Math.abs(y) > 0.96) continue;
        const m = marks[used++];
        if (m === undefined) break;
        const markHook = hooks[i]; if (markHook !== undefined) m.at(markHook);
        m.show(true);
      }
      for (let k = used; k < MARKS; k++) marks[k]?.show(false);
      const hook = candidate >= 0 ? hooks[candidate] : undefined;
      if (hook === undefined) chip.show(false);
      else {
        chip.label(row.chip.candidate, 'cand', row.chip.color);
        chip.at(hook);
        chip.show(true);
      }
      hint(hook === undefined ? H.rest : H.ready);
    } else {
      candidate = -1;
      for (const m of marks) m.show(false);
      if (target === null) chip.show(false);
      else {
        ndc.copy(target.hook).project(ctx.game.camera);
        chip.show(ndc.z >= -1 && ndc.z <= 1);
        chip.label(touchUi ? row.chip.lockedTouch : row.chip.lockedDesk, 'locked', row.chip.lockedColor);
        chip.at(target.hook);
      }
      hint(target !== null ? H.locked : H.armed);
    }
    lockHalo.visible = target !== null;
    if (target !== null) {
      lockHalo.position.copy(target.hook);
      lockHalo.lookAt(ctx.game.camera.position);
      const flare = biteAge < 0.22 ? 0.5 * (1 - biteAge / 0.22) : 0;
      lockHalo.scale.setScalar(1 + Math.sin(time * 10) * 0.08 + flare);
    }
    if (sim.phase === 'idle') return;
    tipAt();
    tracer.draw(tip, sim.phase === 'fire' || sim.phase === 'miss' || sim.phase === 'reel', biteAge < 0.4 ? 1 - biteAge / 0.4 : -1, time);
    ctx.game.renderer.getDrawingBufferSize(screen);
    setLentParam(profile.looks.sparks, 'pixelScale', 3 / Math.max(screen.y * ctx.game.camera.projectionMatrix.elements[5], 1));
    muzzleFlash.object.position.copy(muzzle);
    dockFlash.object.position.copy(muzzle);
  } }, scope);
  tool.swapClaw = make => { sim.release(); flushEvents(); sim = make?.(sim.course) ?? new GrappleSim(ports, sim.course, { rise: () => true }); tool.sim = sim; };
  scope.onDispose(() => { tool.swapClaw = null; sim.release(); flushEvents(); input.pop('grapple'); for (let i = 0; i < 4; i++) bursts[i]?.object.removeFromParent(); });
  return setCourse;
}

/** The original grapple tool's guard, closed before binding and while its entered owner retires. */
export interface GrappleGuard {
  readonly open: () => boolean;
  readonly bind: (tool: GrappleTool) => void;
}
const guardTools = new WeakMap<GrappleTool, Scope>();
const guards = new WeakMap<Scope, GrappleGuard>();
/** One entered-scope reference; collision readers never throw while that scope or an ancestor retires. */
export function grappleGuard(scope: Scope): GrappleGuard {
  if (scope.disposed || scope.disposing) throw new Error('Grapple guard owner has ended');
  const ready = guards.get(scope); if (ready !== undefined) return ready;
  let current: GrappleTool | null = null;
  const guard: GrappleGuard = {
    open: () => !scope.disposed && !scope.disposing && current?.guardOpen === true,
    bind: tool => {
      if (scope.disposed || scope.disposing) throw new Error('Grapple guard owner has ended');
      if (guardTools.get(tool) !== scope) throw new Error('Grapple guard requires its entered scope');
      if (current !== null) throw new Error('Grapple guard is already bound');
      current = tool;
    },
  };
  guards.set(scope, guard);
  scope.onDispose(() => { current = null; guards.delete(scope); });
  return guard;
}

/** Client-only data-driven grapple tool. Context supplies standard services, never shard laws. */
export class GrappleTool extends Tool {
  readonly id: Tool['id'];
  readonly slot = 'offhand' as const;
  readonly actions = ['lock', 'jump'] as const;
  enabled = true;
  holster = 0;
  sim: GrappleClaw | null = null;
  /** The claw this tool draws, in place of the page's own law: a wire's `netClaw`. Its client may start after this tool installs. */
  claw: ((course: GrappleCourse) => GrappleClaw) | null = null;
  /** Set while installed: where `useClaw` lands. */
  swapClaw: ((make: GrappleTool['claw']) => void) | null = null;
  /** Draw this claw from now on, installed or not; null gives the page's law back. */
  useClaw(make: GrappleTool['claw']): void { this.claw = make; this.swapClaw?.(make); }
  private setter: ((course: GrappleCourseRow | null) => void) | undefined;
  constructor(private readonly shard: ShardContext, private readonly data: { readonly equipment: EquipmentRow; readonly profile: GrappleProfile; readonly presentation: GrappleRows; readonly hooks: GrappleCourseRow['hooks'] }) {
    super(data.equipment);
    const id: string = data.equipment.id;
    const toolId = (value: string): value is `tool.${string}` => value.startsWith('tool.');
    if (!toolId(id)) throw new Error('Grapple requires a tool item identity');
    this.id = id;
    if (data.profile.id !== this.id) throw new Error('Grapple profile and equipped item differ');
    guardTools.set(this, shard.scope);
  }
  get hooks(): GrappleCourseRow['hooks'] { return this.data.hooks; }
  get guardOpen(): boolean { return this.sim?.guardOpen() === true; }
  override install(equip: EquipContext): void {
    super.install(equip);
    const host = this.shard.app.equipmentHost;
    if (host === null) throw new Error('Grapple needs the actual equipment host');
    this.setter = installGrappleAim(host, this.shard, equip.scope, this.data.presentation.aim, this.data.presentation.bursts, this.data.profile, this);
  }
  setGrappleCourse(course: GrappleCourseRow | null): void { this.setter?.(course); }
  override update(_dt: number, _t: number): void { /* Native fixed/update systems own this tool. */ }
}
