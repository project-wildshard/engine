import { uiScope, mountUi } from '@wildshard/engine/ui/ownership';
import type { Scope } from '@wildshard/engine/app/scope';
import { loadModuleWithProgress } from '@wildshard/engine/ui/loadProgress';
import type { CompendiumState } from '../../../shared/game/compendium/state';
import type { EntryDef, Plate } from '../../../shared/game/compendium/types';
import type { JournalView } from './journalView';

export interface JournalCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  readonly onViewModel: ((model: NonNullable<Plate['model']>, entry: EntryDef) => void) | undefined;
}

/** the silhouette of a sketch (an unknown / discovered page, a ??? neighbour): `<id>-sil.webp` beside it */
export const silhouetteOf = (sketch: string): string => sketch.replace(/\.webp$/, '-sil.webp');

/** the hand-lettered face for names and notes (public/fonts/caveat-600-latin.woff2, SIL OFL), loaded on first open */
let handFont: Promise<void> | null = null;
export function loadHandFont(): Promise<void> {
  handFont ??= (async () => {
    try {
      if (typeof FontFace === 'undefined') return;
      const f = new FontFace('WS Hand', 'url(/fonts/caveat-600-latin.woff2) format("woff2")', { weight: '600', display: 'swap' });
      document.fonts.add(await f.load());
    } catch { /* the fallback cursive face */ }
  })();
  return handFont;
}

type Dir = 1 | -1;

/** Discovery state and host pause callbacks stay synchronous; the book DOM and
 * image requests are constructed only on the first actual open. */
export class Journal {
  readonly scope: Scope = uiScope('journal');
  readonly root: HTMLElement;
  onOpen?: () => void;
  onClose?: () => void;
  onViewModel?: (model: NonNullable<Plate['model']>, entry: EntryDef) => void;
  private view: JournalView | null = null;
  private ready: Promise<void> | null = null;
  private loading: Scope | null = null;
  private wanted = false;
  private readonly commands: ((view: JournalView) => void)[] = [];
  private readonly state: CompendiumState;
  constructor(state: CompendiumState) {
    this.state=state;
    this.root=document.createElement('div');this.root.className=`ws-cmp ${state.def.skin.className}`;
    this.root.setAttribute('role','dialog');this.root.setAttribute('aria-label',state.def.skin.title);this.root.inert=true;
    mountUi(this.root,this.scope,document.body);
    this.scope.onDispose(()=>{this.view=null;this.loading=null;this.wanted=false;this.commands.length=0;});
  }
  get isOpen(): boolean { return this.wanted; }
  open(entryId?: string): void {
    if(entryId!==undefined)this.goTo(entryId);
    if(!this.wanted){this.wanted=true;this.onOpen?.();}
    if(this.view!==null){this.view.open();return;}
    this.loading?.dispose();this.loading=this.scope.child('prepare');
    void this.prepare(this.loading);
  }
  close(): void {
    if(!this.wanted)return;
    this.wanted=false;this.loading?.dispose();this.loading=null;
    this.view?.close();this.onClose?.();
  }
  toggle(): void { if(this.isOpen)this.close();else this.open(); }
  goTo(entryId: string): void { this.command(view=>{view.goTo(entryId);}); }
  select(tab: string): void { this.command(view=>{view.select(tab);}); }
  turn(dir: Dir): void { this.command(view=>{view.turn(dir);}); }
  private command(run: (view: JournalView)=>void): void { if(this.view===null)this.commands.push(run);else run(this.view); }
  private async readView(): Promise<void> {
    const {JournalView}=await import('./journalView');
    if(this.scope.disposed)return;
    const readModel=(): JournalCallbacks['onViewModel']=>this.onViewModel;
    this.view=new JournalView(this.state,this.root,this.scope,{onClose:()=>{this.close();},
      get onViewModel(){return readModel();}});
    for(const run of this.commands)run(this.view);this.commands.length=0;
  }
  private async prepare(owner: Scope): Promise<void> {
    try{
      await loadModuleWithProgress('Journal',()=> (this.ready??=this.readView()),owner);
      if(!this.scope.disposed&&this.wanted)this.view?.open();
    }catch(error){this.ready=null;this.close();console.warn('Journal unavailable',error);}
  }
}
