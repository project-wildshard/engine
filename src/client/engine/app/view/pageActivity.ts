import {setScopeTimersActive,type Scope} from '../../../../shared/engine/app/scope';
import {setBrowserFramesActive} from './scopeEnvironment';
import {pagePresentation} from './presentation';

/** Page visibility parks owned work; no global timer or frame API is patched. */
export function installPageActivity(scope: Scope, page: EventTarget & Pick<Document,'visibilityState'>=document): void {
  const update=():void=>{
    const active=page.visibilityState!=='hidden';
    setScopeTimersActive(active);setBrowserFramesActive(active);pagePresentation.setVisible(active);
  };
  scope.listen(page,'visibilitychange',update,{capture:true});update();
}
