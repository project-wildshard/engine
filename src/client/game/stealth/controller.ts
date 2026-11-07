import {parse} from 'valibot';
import {StealthRowsSchema,type StealthRows} from '@wildshard/format/stealth';
import type { Scope } from '@wildshard/engine/app/scope';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { Player } from '@wildshard/engine/player/Player';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import { declarePanel, type PanelView } from '@wildshard/engine/ui/panel';
import { mountUi } from '@wildshard/engine/ui/ownership';
import { sampleStealthSources, StealthCrouch, type StealthObservation, type StealthSampleOwners } from '../../../shared/game/stealth/stealthLaw';
import type { PageWildlifeView } from '../population/wildlifeFeature';
import type { PageRidingView } from '../riding/client';
import type { HeldSlotKit } from '../loadout/claims';
import type { PageAir } from '../population/pageAir';
import './stealth.css';

/** Concrete native sources, with no copied roster or authored callback. */
export interface StealthSourcesOwners extends StealthSampleOwners {
 readonly population: Pick<PageWildlifeView, 'packs' | 'herds'> | null;
 readonly riding: PageRidingView | null;
 readonly kit: HeldSlotKit | null;
 readonly grass: Pick<PageAir, 'grassStandingAt'>;
}
/** Client-only crouch/detection presentation. The guest owns eligibility, concealment and alert-state decisions. */
export class StealthController {
 private readonly scope:Scope;private readonly player:Player;
 /** The renderer-free crouch, detection and shot state (stealthLaw.ts); this controller samples its pose and draws it. */
 readonly core:StealthCrouch;
 get state():string{return this.core.state;}
 get cover():number{return this.core.cover;}
 get threat():number{return this.core.threat;}
 get inLongGrass():boolean{return this.core.inLongGrass;}
 get canCrouch():boolean{return this.core.canCrouch;}
 get latched():boolean{return this.core.latched;}
 private readonly layer:PanelView;private readonly row:PanelView;private readonly grassRow:PanelView;private readonly disc:HTMLElement;
 private shown='';private lastCover=-1;private lastThreat=-1;
 private readonly rows:StealthRows;
 constructor(ctx:LevelContext,player:Player,input:unknown){
  const rows=parse(StealthRowsSchema,input);this.rows=rows;
  this.scope=ctx.scope;this.player=player;this.core=new StealthCrouch(rows,ctx.scope);
  this.layer=declarePanel(rows.panels.layer);mountUi(this.layer.root,this.scope);
  this.disc=ctx.hud.disc({cls:'ws-stealth-crouch',icon:rows.disc,label:rows.discLabel,spot:'up0',press:()=>{this.core.press();}});
  this.row=declarePanel(rows.panels.row);ctx.hud.widget('band.3',this.row.root,3);
  this.grassRow=declarePanel(rows.panels.grass);ctx.hud.widget('band.3',this.grassRow.root,4);
  this.scope.onDispose(hudSlots.onLayer(()=>{this.layer.text('hint',rows.hint);this.layer.flag('hint','touch',true);}));
  this.scope.onDispose(()=>{this.layer.remove();this.row.remove();this.grassRow.remove();this.core.latched=false;});
  ctx.inputContext(rows.input);ctx.app.input.push(rows.input.id,this.scope);
  ctx.answer('player.crouch',request=>this.answerCrouch(request));
  ctx.system({id:rows.system,phase:'input',before:['engine.player.input'],run:dt=>{this.crouchStep(dt);}});
 }
 private crouchStep(dt:number):void{
  const p=this.player;
  const sprint=(p.inputService?.held('sprint')??false)&&((p.inputService?.held('move.forward')??false)||p.touchMove.y>.1),jump=p.touchJump||(p.inputService?.pressed('jump')??false);
  this.core.step(dt,{sprint,jump,hover:p.hover,swimming:p.swimming,practice:practiceRoom.open,crouching:p.crouching,x:p.position.x,z:p.position.z});
 }
 answerCrouch(request:{want:boolean;via:'toggle'|'hold'}):{allowed:boolean;latched:boolean}{return this.core.answer(request);}
 noteShot():void{this.core.noteShot();}
 sneakMultiplier():number{return this.core.sneakMultiplier();}
 private validateSources():void{
  if(this.scope.disposed||this.scope.disposing)throw new Error('Stealth observation owner has ended');
 }
 /** Sample declared native sources at the caller's existing update slot. */
 updateSources(dt:number,t:number,owners:StealthSourcesOwners):void{
  this.validateSources();
  const rows=this.rows.observations;if(rows===undefined)throw new Error('Stealth observation sources are not declared');
  const observation=sampleStealthSources(rows,this.player,owners);
  this.validateSources();
  this.update(dt,t,observation);
  this.validateSources();
  if(owners.kit!==null&&rows.melee!==undefined)owners.kit.polearm(rows.melee).damageScale=this.sneakMultiplier();
 }
 update(_dt:number,t:number,observation:StealthObservation):void{this.core.observe(t,observation);this.render();}
  private render(): void {
    const s = this.state;
    if (s !== this.shown) {
      this.shown = s;
      this.layer.data('', 'state', s);
      const icon = this.rows.icons[s]??this.rows.icons['visible'];if(icon===undefined)throw new Error('Missing stealth icon');
      const label = this.rows.labels[s]??this.rows.labels['visible']??'';
      this.layer.fill('pipIcon', [icon]); this.layer.text('pipLabel', label);
      this.row.data('', 'state', s); this.row.fill('icon', [icon]); this.row.text('label', label);
    }
    // the GRASS meter while crouched
    const crouched = this.player.crouching;
    this.layer.flag('meter', 'on', crouched); this.grassRow.flag('', 'on', crouched);
    const c = Math.round(this.cover * 100) / 100;
    if (c !== this.lastCover) {
      this.lastCover = c;
      this.layer.style('meterFill', 'transform', `scaleY(${c.toFixed(2)})`); this.grassRow.style('fill', 'transform', `scaleX(${c.toFixed(2)})`);
      this.layer.flag('meter', 'good', c >= (this.rows.tuning['hiddenCover']??1)); this.grassRow.flag('', 'good', c >= (this.rows.tuning['hiddenCover']??1));
    }
    const th = Math.round(this.threat * 50) / 50;
    if (th !== this.lastThreat) { this.lastThreat = th; this.layer.style('pip', '--threat', th.toFixed(2)); this.row.style('', '--threat', th.toFixed(2)); }
    // the chevron: round the crosshair, pointing at the most aware creature
    const threatening = this.rows.threatStates.includes(s);
    this.layer.flag('chev', 'on', threatening);
    if (threatening) {
      const p = this.player.position, yaw = this.player.yaw;
      const dx = this.core.threatX - p.x, dz = this.core.threatZ - p.z;
      const ax = dx * Math.cos(yaw) - dz * Math.sin(yaw), ay = -dx * Math.sin(yaw) - dz * Math.cos(yaw); // right / forward
      const a = Math.atan2(ax, ay);
      this.layer.style('chev', 'transform', `translate(${(Math.sin(a) * 64).toFixed(1)}px, ${(-Math.cos(a) * 64).toFixed(1)}px) rotate(${a.toFixed(3)}rad)`);
    }
    // the crouch disc (touch) and the one-time TALL GRASS chip
    const avail = this.canCrouch || this.latched;
    hudSlots.show(this.disc, avail);
    this.disc.classList.toggle('on', this.latched);
    if (this.core.takeHint()) {
      this.disc.classList.add('pulse');
      this.layer.flag('hint', 'on', true);
      const endHint = (): void => { this.layer.flag('hint', 'on', false); this.disc.classList.remove('pulse'); };
      this.scope.timeout(this.rows.hintSeconds*1000, endHint);
    }
  }
}
